import fcntl
import json
from pathlib import Path
import tempfile
import unittest

from indexnow import ENDPOINT, Notifier, publication_urls

ORIGIN = 'https://vobarna.com'
KEY = 'test-indexnow-key'


def page(version='a'):
    return {'index': True, 'hash': version * 64, 'lastmod': '2026-11-19T12:00:00+00:00'}


class IndexNowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.publication = {'origin': ORIGIN, 'pages': {'/en/': page(), '/en/films/old/': page()}}
        self.now, self.status, self.key_available = 1000, 200, True
        self.headers, self.posts = {}, []
        def fetch(url, payload=None):
            if url.endswith('/indexnow.json'):
                return 200, json.dumps(self.publication).encode(), {}
            if url.endswith('/' + KEY + '.txt'):
                return (200, KEY.encode(), {}) if self.key_available else (404, b'', {})
            self.assertEqual(url, ENDPOINT)
            self.posts.append(payload)
            return self.status, b'', self.headers
        self.fetch = fetch
        self.notifier = self.restart()

    def restart(self):
        return Notifier(ORIGIN, KEY, self.temp.name, fetch=self.fetch, clock=lambda: self.now)

    def state(self):
        return json.loads((Path(self.temp.name) / 'state.json').read_text())

    def test_baseline_then_only_additions_changes_and_removals(self):
        self.assertEqual(self.notifier.tick()['event'], 'indexnow_baseline_saved')
        self.assertFalse(self.posts)
        self.publication['pages']['/en/']['lastmod'] = '2026-11-19T13:00:00Z'
        self.notifier.tick()
        self.assertFalse(self.posts, 'Timestamp-only changes must not notify')
        self.publication['pages']['/en/'] = page('b')
        del self.publication['pages']['/en/films/old/']
        self.publication['pages']['/en/films/new/'] = page('c')
        self.assertEqual(self.notifier.tick()['event'], 'indexnow_accepted')
        self.assertEqual(set(self.posts[0]['urlList']), {ORIGIN + p for p in ['/en/', '/en/films/old/', '/en/films/new/']})
        self.assertEqual(self.posts[0]['keyLocation'], ORIGIN + '/' + KEY + '.txt')
        self.restart().tick()
        self.assertEqual(len(self.posts), 1)

    def test_retries_survive_restart_and_coalesce_latest_changes(self):
        self.notifier.tick()
        self.publication['pages']['/en/'] = page('b')
        self.status, self.headers = 429, {'Retry-After': '120'}
        result = self.notifier.tick()
        self.assertEqual(result['next_attempt'], 1120)
        self.assertEqual(len(self.state()['pending']), 1)
        self.notifier = self.restart()
        self.now = 1060
        self.publication['pages']['/en/'] = page('c')
        self.notifier.tick()
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.state()['pending'][ORIGIN + '/en/'], 'c' * 64)
        self.now, self.status = 1120, 202
        self.assertTrue(self.notifier.tick()['key_validation_pending'])
        self.assertFalse(self.state()['pending'])
        self.assertEqual(self.state()['accepted_urls'], 1)

    def test_missing_key_does_not_send_or_lose_changes(self):
        self.notifier.tick()
        self.publication['pages']['/en/'] = page('b')
        self.key_available = False
        self.assertEqual(self.notifier.tick()['event'], 'indexnow_retry_scheduled')
        self.assertFalse(self.posts)
        self.assertTrue(self.state()['pending'])

    def test_bad_live_publication_preserves_baseline_and_pending(self):
        self.notifier.tick()
        before = self.state()
        for bad in [{'origin': ORIGIN, 'pages': {}},
                    {'origin': ORIGIN, 'pages': {'//evil.example/en/': page()}},
                    {'origin': 'https://evil.example', 'pages': {'/en/': page()}},
                    {'origin': ORIGIN, 'pages': {'/en/?q=foo': page()}},
                    {'origin': ORIGIN, 'pages': {'/en/': {**page(), 'index': False}}}]:
            self.publication = bad
            with self.assertRaises(ValueError): self.notifier.tick()
            self.assertEqual(self.state(), before)

    def test_rolling_containers_share_lock_and_submission_batches_are_bounded(self):
        with (Path(self.temp.name) / 'state.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.notifier.tick()['event'], 'indexnow_busy')
        self.notifier.tick()
        self.publication['pages'].update({f'/en/films/new-{i}/': page('b') for i in range(1005)})
        self.assertEqual(self.notifier.tick()['pending'], 5)
        self.assertEqual(len(self.posts[0]['urlList']), 1000)
        self.assertEqual(self.notifier.tick()['pending'], 0)
        self.assertEqual(len(self.posts[1]['urlList']), 5)


if __name__ == '__main__':
    unittest.main()
