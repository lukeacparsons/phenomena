"""Pinned Yelmo proxy routes, bounded failover and persistent cooldowns.

Anonymous basket cleanup stays on its original route and backs off on failure.
No seat-selection or payment endpoint is allowed. Recovery state is private.
"""
from contextlib import contextmanager
from datetime import timezone
from email.utils import parsedate_to_datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import random
import time
from urllib.parse import urlsplit

from cinesa_showtimes import atomic_write
from expanded_availability import ScreeningAvailabilityUnavailable
from yelmo_availability import BASE, YelmoAvailabilityFetcher, YelmoCancellationError

STATE = Path(__file__).resolve().parents[1] / 'static/preview-data/history/yelmo-routes.json'
ROUTES = {BASE + route for route in ['schedule', 'tickets', 'seats', 'order/cancel']}


class YelmoRouteError(RuntimeError):
    def __init__(self, status=None, retry_after=0, *, retryable=True):
        self.status, self.retry_after, self.retryable = status, retry_after, retryable
        super().__init__('Yelmo route unavailable' + (f' (HTTP {status})' if status else ''))


class YelmoBackoff(RuntimeError):
    def __init__(self, retry_at=None):
        self.retry_at = retry_at
        super().__init__('Yelmo routes cooling down; retry on a later collection pass')


def configured_proxies():
    raw = os.environ.get('VOBARNA_YELMO_PROXIES')
    if raw:
        try:
            proxies = json.loads(raw)
        except ValueError:
            raise ValueError('Invalid Yelmo proxy pool configuration') from None
    else:
        proxies = [os.environ['VOBARNA_YELMO_PROXY']] if os.environ.get('VOBARNA_YELMO_PROXY') else [None]
    return validate_proxies(proxies)


def validate_proxies(proxies):
    if not isinstance(proxies, list) or not 1 <= len(proxies) <= 8:
        raise ValueError('Invalid Yelmo proxy pool configuration')
    normalized = []
    for proxy in proxies:
        if proxy is None and proxies == [None]:
            normalized.append(None)
            continue
        try:
            url = urlsplit(proxy)
            valid = (isinstance(proxy, str) and url.scheme in {'http', 'https'} and url.hostname
                     and url.port and not url.username and not url.password
                     and url.path in {'', '/'} and not url.query and not url.fragment)
        except (ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            raise ValueError('Invalid Yelmo proxy route; use a private CONNECT endpoint')
        normalized.append(url.scheme + '://' + url.netloc.lower())
    if len(set(normalized)) != len(normalized):
        raise ValueError('Duplicate Yelmo proxy routes')
    return normalized


def retry_after_seconds(value, now):
    if not isinstance(value, str):
        return 0
    try:
        seconds = float(value)
    except ValueError:
        try:
            stamp = parsedate_to_datetime(value)
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            seconds = stamp.timestamp() - now
        except (TypeError, ValueError, OverflowError):
            return 0
    return max(0, seconds) if math.isfinite(seconds) else 0


class PinnedTransport:
    def __init__(self, pool, key):
        self.pool, self.key = pool, key
        self.session = pool.session_factory()

    def post(self, url, **kwargs):
        if url not in ROUTES:
            raise ValueError('Yelmo request endpoint not allowed')
        pool = self.pool
        delay = pool.state['next_request_at'] - pool.clock()
        if delay > 0:
            # Pacing is short; provider cooldowns never sleep inside the collector.
            if delay > 60:
                if url != BASE + 'order/cancel':
                    raise YelmoBackoff(pool.state['next_request_at'])
                delay = 0  # Clock skew must not prevent releasing a basket.
            pool.sleep(delay)
        pool.state['next_request_at'] = pool.clock() + pool.min_interval + pool.jitter() * .5
        pool.save()
        try:
            response = self.session.post(url, **kwargs, proxy=pool.routes[self.key],
                                         allow_redirects=False, verify=True, timeout=25)
        except Exception:
            # Never expose proxy connection details or credentials in diagnostics.
            raise YelmoRouteError() from None
        status = response.status_code
        if status in {403, 405, 429} or 500 <= status <= 599:
            raise YelmoRouteError(status, retry_after_seconds(response.headers.get('Retry-After'), pool.clock()))
        if 300 <= status <= 399:
            raise YelmoRouteError(status, retryable=False)
        return response

    def close(self):
        self.session.close()


class YelmoRoutePool:
    def __init__(self, proxies=None, *, state_path=STATE, clock=time.time, sleep=time.sleep,
                 jitter=random.random, min_interval=2, session_factory=None):
        proxies = configured_proxies() if proxies is None else validate_proxies(proxies)
        self.routes = {hashlib.sha256((p or 'direct').encode()).hexdigest()[:20]: p for p in proxies}
        self.path = Path(state_path) if state_path is not None else None
        self.clock, self.sleep, self.jitter, self.min_interval = clock, sleep, jitter, min_interval
        self.sessions = {}
        self.state = {'version': 1, 'cursor': 0, 'next_request_at': 0, 'routes': {}, 'pending': None}
        if session_factory is None:
            from curl_cffi import requests
            session_factory = lambda: requests.Session(impersonate='chrome', trust_env=False)
        self.session_factory = session_factory

    def load(self):
        if self.path is None or not self.path.exists():
            return
        try:
            raw = self.path.read_text()
            if len(raw) > 65536:
                raise ValueError()
            state = json.loads(raw)
            def require(condition):
                if not condition:
                    raise ValueError()
            require(state['version'] == 1 and type(state['cursor']) is int and state['cursor'] >= 0)
            require(isinstance(state['routes'], dict) and len(state['routes']) <= 8)
            require(math.isfinite(state['next_request_at']) and state['next_request_at'] >= 0)
            for value in state['routes'].values():
                require(type(value['failures']) is int and 0 <= value['failures'] <= 32)
                require(math.isfinite(value['retry_at']) and value['retry_at'] >= 0)
            if state['pending'] is not None:
                require(state['pending']['route'] in self.routes)
                require(isinstance(state['pending']['session_id'], str) and 0 < len(state['pending']['session_id']) <= 256)
            state['routes'] = {k: v for k, v in state['routes'].items() if k in self.routes}
            self.state = state
        except (ValueError, KeyError, TypeError):
            raise RuntimeError('Invalid Yelmo recovery state; refusing to open another basket') from None

    def save(self):
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(self.path, self.state)

    @contextmanager
    def transaction(self):
        if self.path is None:
            yield
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(self.path) + '.lock', os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise YelmoBackoff() from None
            self.load()
            yield
        finally:
            os.close(fd)

    def transport(self, key):
        if key not in self.sessions:
            self.sessions[key] = PinnedTransport(self, key)
        return self.sessions[key]

    def acquire(self, excluded=()):
        keys = list(self.routes)
        for offset in range(len(keys)):
            index = (self.state['cursor'] + offset) % len(keys)
            key = keys[index]
            if key not in excluded and self.state['routes'].get(key, {}).get('retry_at', 0) <= self.clock():
                self.state['cursor'] = (index + 1) % len(keys)
                self.save()
                return key
        raise YelmoBackoff(min((self.state['routes'].get(k, {}).get('retry_at', 0) for k in keys), default=0))

    def failed(self, key, error):
        failures = min(32, self.state['routes'].get(key, {}).get('failures', 0) + 1)
        delay = min(21600, 900 * 2 ** min(failures - 1, 5)) * (1 + .2 * self.jitter())
        self.state['routes'][key] = {'failures': failures,
                                    'retry_at': self.clock() + max(delay, error.retry_after)}
        self.save()

    def succeeded(self, key):
        self.state['routes'][key] = {'failures': 0, 'retry_at': 0}
        self.save()

    def pending(self, key, sid):
        self.state['pending'] = {'route': key, 'session_id': sid} if sid else None
        self.save()

    def close(self):
        for session in self.sessions.values():
            session.close()
        self.sessions.clear()


class RotatingYelmoAvailabilityFetcher:
    def __init__(self, pool=None):
        self.pool = pool or YelmoRoutePool()
        self.active = None

    def client(self, key):
        self.active = YelmoAvailabilityFetcher(self.pool.transport(key),
                                               on_pending=lambda sid: self.pool.pending(key, sid))
        return self.active

    def recover(self):
        pending = self.pool.state['pending']
        if pending is not None:
            retry_at = self.pool.state['routes'].get(pending['route'], {}).get('retry_at', 0)
            if retry_at > self.pool.clock():
                raise YelmoBackoff(retry_at)
            client = self.client(pending['route'])
            client.pending = pending['session_id']
            try:
                client.close()  # Same route; no new basket before confirmed cleanup.
            except YelmoCancellationError as error:
                self.cleanup_failed(pending['route'], error)
                raise
        self.active = None

    def cleanup_failed(self, key, error):
        cause = error.last_error
        self.pool.failed(key, cause if isinstance(cause, YelmoRouteError) else YelmoRouteError())

    def fetch(self, row):
        with self.pool.transaction():
            self.recover()
            attempted = set()
            for _ in range(min(2, len(self.pool.routes))):
                key = self.pool.acquire(attempted)
                attempted.add(key)
                client = self.client(key)
                try:
                    value = client.fetch(row)
                except YelmoCancellationError as error:
                    self.cleanup_failed(key, error)
                    raise
                except YelmoRouteError as error:
                    self.pool.failed(key, error)
                    if not error.retryable or client.pending is not None:
                        raise
                    # The finally block in client.fetch has cancelled any known
                    # basket. Only now can another route start a fresh session.
                    continue
                except ScreeningAvailabilityUnavailable:
                    self.pool.succeeded(key)
                    raise
                else:
                    self.pool.succeeded(key)
                    return value
                finally:
                    if client.pending is None:
                        self.active = None
            raise YelmoBackoff(min(self.pool.state['routes'][k]['retry_at'] for k in attempted))

    def close(self):
        try:
            with self.pool.transaction():
                self.recover()
        finally:
            self.pool.close()
