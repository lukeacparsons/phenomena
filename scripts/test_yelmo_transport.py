"""Proxy affinity, bounded failover, restart-safe backoff and basket recovery."""
from email.utils import formatdate
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch

from yelmo_availability import BASE
from yelmo_transport import (YelmoRoutePool, RotatingYelmoAvailabilityFetcher, YelmoBackoff,
                            YelmoRouteError, configured_proxies, retry_after_seconds)

FIXTURE = Path(__file__).parent / 'fixtures/availability/yelmo-1350-48642.json'


class Response:
    def __init__(self, payload=None, status=200, headers=None):
        self.payload, self.status_code, self.headers = payload, status, headers or {}
        self.text = json.dumps(payload) if payload is not None else ''

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code != 200:
            raise ValueError('HTTP ' + str(self.status_code))


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(FIXTURE.read_text())
        self.row = self.data['row']
        self.now = 1000000
        self.sleeps, self.calls, self.created = [], [], []
        self.proxies = ['http://cinema-route-a:8888', 'http://cinema-route-b:8888']
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'routes.json'

    def sleep(self, delay):
        self.sleeps.append(delay)
        self.now += delay

    def success(self):
        return [Response(self.data[k]) for k in ['schedule', 'tickets', 'seats']] + [Response()]

    def pool(self, responses, *, proxies=None, persistent=False, interval=0, jitter=0):
        queues = [list(r) for r in responses]
        def factory():
            queue = queues.pop(0)
            session = Mock()
            def post(url, **kwargs):
                self.calls.append((url.removeprefix(BASE), kwargs))
                result = queue.pop(0)
                if isinstance(result, Exception):
                    raise result
                return result
            session.post.side_effect = post
            self.created.append(session)
            return session
        return YelmoRoutePool(proxies or self.proxies, state_path=self.path if persistent else None,
                              clock=lambda: self.now, sleep=self.sleep, jitter=lambda: jitter,
                              min_interval=interval, session_factory=factory)

    def test_round_robin_keeps_the_entire_basket_and_cleanup_on_one_route(self):
        pool = self.pool([self.success() * 2, self.success()])
        fetcher = RotatingYelmoAvailabilityFetcher(pool)
        for _ in range(3):
            self.assertEqual(fetcher.fetch(self.row)['available'], 472)
        self.assertEqual([c[1]['proxy'] for c in self.calls],
                         [self.proxies[0]] * 4 + [self.proxies[1]] * 4 + [self.proxies[0]] * 4)
        self.assertTrue(all(c[1]['allow_redirects'] is False and c[1]['verify'] is True for c in self.calls))
        self.assertIsNone(pool.state['pending'])
        fetcher.close()
        self.assertTrue(all(s.close.call_count == 1 for s in self.created))

    def test_failed_route_cools_while_other_route_serves_the_screening(self):
        pool = self.pool([[Response(self.data['schedule']), Response(status=405, headers={'Retry-After': '3600'})],
                          self.success()], persistent=True)
        self.assertEqual(RotatingYelmoAvailabilityFetcher(pool).fetch(self.row)['available'], 472)
        first = next(iter(pool.routes))
        self.assertEqual(pool.state['routes'][first]['retry_at'], self.now + 3600)
        self.assertEqual([c[0] for c in self.calls], ['schedule', 'tickets', 'schedule', 'tickets', 'seats', 'order/cancel'])
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertNotIn('cinema-route', self.path.read_text())

    def test_map_failure_cancels_before_rotating(self):
        pool = self.pool([[Response(self.data['schedule']), Response(self.data['tickets']), Response(status=429), Response()],
                          self.success()])
        self.assertEqual(RotatingYelmoAvailabilityFetcher(pool).fetch(self.row)['available'], 472)
        self.assertEqual([c[0] for c in self.calls], ['schedule', 'tickets', 'seats', 'order/cancel'] * 2)
        self.assertEqual([c[1]['proxy'] for c in self.calls[:4]], [self.proxies[0]] * 4)

    def test_failed_cleanup_prevents_rotation_and_is_recovered_after_restart(self):
        pool = self.pool([self.success()[:3] + [Response(status=503), Response(status=503, headers={'Retry-After': '1800'})]], persistent=True)
        fetcher = RotatingYelmoAvailabilityFetcher(pool)
        with self.assertRaisesRegex(RuntimeError, 'cancellation failed'):
            fetcher.fetch(self.row)
        self.assertEqual(len(self.created), 1, 'no request on a new route before cleanup')
        pending = json.loads(self.path.read_text())['pending']
        self.assertEqual(pending['route'], next(iter(pool.routes)))
        self.assertEqual(pending['session_id'], 'anonymous-fixture')
        recovered = RotatingYelmoAvailabilityFetcher(self.pool([[Response()], self.success()], persistent=True))
        for collector in [fetcher, recovered]:
            with self.assertRaises(YelmoBackoff):
                collector.fetch(self.row)
        self.assertEqual(len(self.calls), 5, 'failed cleanup must not retry for every screening or on restart')
        self.now += 1801
        self.assertEqual(recovered.fetch(self.row)['available'], 472)
        self.assertEqual(self.calls[5][0], 'order/cancel')
        self.assertEqual(self.calls[5][1]['proxy'], self.proxies[0])
        self.assertEqual(self.calls[6][1]['proxy'], self.proxies[1])
        self.assertIsNone(json.loads(self.path.read_text())['pending'])

    def test_cooldowns_survive_new_fetchers_and_grow_exponentially(self):
        pool = self.pool([[Response(status=405)], [TimeoutError('private connection details')]], persistent=True)
        with self.assertRaises(YelmoBackoff):
            RotatingYelmoAvailabilityFetcher(pool).fetch(self.row)
        self.assertEqual(len(self.calls), 2)
        self.now += 100
        restarted = self.pool([], persistent=True)
        with self.assertRaises(YelmoBackoff):
            RotatingYelmoAvailabilityFetcher(restarted).fetch(self.row)
        self.assertEqual(len(self.calls), 2)
        self.now += 801
        again = self.pool([[Response(status=503)], [Response(status=503)]], persistent=True)
        with self.assertRaises(YelmoBackoff):
            RotatingYelmoAvailabilityFetcher(again).fetch(self.row)
        self.assertTrue(all(v == {'failures': 2, 'retry_at': self.now + 1800} for v in again.state['routes'].values()))

    def test_failover_is_bounded_to_two_routes_per_screening(self):
        pool = self.pool([[Response(status=405)], [Response(status=405)]],
                         proxies=self.proxies + ['http://cinema-route-c:8888'])
        with self.assertRaises(YelmoBackoff):
            RotatingYelmoAvailabilityFetcher(pool).fetch(self.row)
        self.assertEqual(len(self.created), 2)

    def test_request_pacing_is_global_across_routes_with_short_jitter(self):
        pool = self.pool([self.success(), self.success()], interval=2, jitter=.5)
        fetcher = RotatingYelmoAvailabilityFetcher(pool)
        fetcher.fetch(self.row)
        fetcher.fetch(self.row)
        self.assertEqual(self.sleeps, [2.25] * 7)

    def test_redirects_and_checkout_routes_are_never_followed(self):
        pool = self.pool([[Response(status=307)]])
        with self.assertRaises(YelmoRouteError):
            RotatingYelmoAvailabilityFetcher(pool).fetch(self.row)
        self.assertEqual(len(self.created), 1)
        with self.assertRaises(ValueError):
            pool.transport(next(iter(pool.routes))).post(BASE + 'seats/set')
        self.assertEqual(len(self.calls), 1)

    def test_corrupt_recovery_state_and_concurrent_collectors_open_no_baskets(self):
        self.path.write_text('{broken')
        pool = self.pool([], persistent=True)
        with self.assertRaisesRegex(RuntimeError, 'recovery state'):
            RotatingYelmoAvailabilityFetcher(pool).fetch(self.row)
        self.assertEqual(self.calls, [])
        self.path.write_text(json.dumps(pool.state))
        with pool.transaction():
            with self.assertRaises(YelmoBackoff):
                RotatingYelmoAvailabilityFetcher(self.pool([], persistent=True)).fetch(self.row)
        self.assertEqual(self.calls, [])

    def test_retry_after_numeric_and_http_dates_and_invalid_values(self):
        self.assertEqual(retry_after_seconds('1800', self.now), 1800)
        self.assertEqual(retry_after_seconds(formatdate(self.now + 2400, usegmt=True), self.now), 2400)
        for value in ['not a date', 'NaN', 'Infinity', '-1', None]:
            self.assertEqual(retry_after_seconds(value, self.now), 0)

    def test_explicit_proxy_pool_never_adds_a_direct_fallback(self):
        with patch.dict(os.environ, {'VOBARNA_YELMO_PROXIES': json.dumps(self.proxies)}):
            self.assertEqual(configured_proxies(), self.proxies)
        for value in [[], [None, self.proxies[0]], ['http://user:secret@proxy:8888'],
                      ['file:///tmp/socket'], ['http://proxy:8888/checkout'], self.proxies * 2,
                      ['http://proxy:8888', 'http://PROXY:8888/']]:
            with self.subTest(value=value), patch.dict(os.environ, {'VOBARNA_YELMO_PROXIES': json.dumps(value)}), self.assertRaises(ValueError):
                configured_proxies()

    def test_default_sessions_ignore_global_proxy_environment(self):
        with patch('curl_cffi.requests.Session') as session:
            pool = YelmoRoutePool([None], state_path=None)
            pool.transport(next(iter(pool.routes)))
            session.assert_called_once_with(impersonate='chrome', trust_env=False)


if __name__ == '__main__':
    unittest.main()
