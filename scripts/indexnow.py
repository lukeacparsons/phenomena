"""Notify IndexNow about changes observed in the live canonical page manifest.

Run only on the deployed origin, with INDEXNOW_KEY and INDEXNOW_STATE_DIR set.
The durable outbox and lock are shared by rolling containers. No credentials or
URLs containing keys are logged. Acceptance does not establish indexing.
"""
from datetime import datetime
from email.utils import parsedate_to_datetime
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

ENDPOINT = 'https://api.indexnow.org/indexnow'
LIMIT = 16 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(url, payload=None):
    req = Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                  headers={'User-Agent': 'VOBarna-IndexNow/1.0', 'Content-Type': 'application/json; charset=utf-8'})
    try:
        response = build_opener(NoRedirect).open(req, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError('Response exceeds size limit')
        return response.status, body, dict(response.headers)


def publication_urls(publication, origin):
    if publication.get('origin') != origin or not isinstance(publication.get('pages'), dict):
        raise ValueError('Publication does not match this site')
    urls = {}
    for path, info in publication['pages'].items():
        parsed = urlsplit(path)
        if (not re.fullmatch(r'/[a-z0-9/-]+/', path) or '//' in path or parsed.query or parsed.fragment
                or not info.get('index') or not re.fullmatch(r'[a-f0-9]{64}', info.get('hash', ''))):
            raise ValueError('Invalid canonical publication page')
        datetime.fromisoformat(info['lastmod'].replace('Z', '+00:00'))
        urls[origin + path] = info['hash']
    if not urls or len(urls) > 50000:
        raise ValueError('Unexpected publication size')
    return urls


def save(path, state):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(state, stream, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def retry_delay(headers, attempts, now):
    delay = min(3600, 60 * 2 ** min(attempts - 1, 6))
    value = next((v for k, v in headers.items() if k.lower() == 'retry-after'), '')
    try:
        requested = float(value) if str(value).isdigit() else parsedate_to_datetime(value).timestamp() - now
        delay = max(delay, requested)
    except (TypeError, ValueError, OverflowError):
        pass
    return min(max(60, delay), 86400)


class Notifier:
    def __init__(self, origin, key, directory, *, fetch=request, clock=time.time):
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' or parsed.netloc != parsed.hostname or parsed.path or parsed.query or parsed.fragment:
            raise ValueError('Expected a canonical HTTPS origin')
        if not re.fullmatch(r'[A-Za-z0-9-]{8,128}', key):
            raise ValueError('Invalid IndexNow key')
        self.origin, self.key, self.directory = origin, key, Path(directory)
        self.fetch, self.clock = fetch, clock
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'state.json'

    def tick(self):
        with (self.directory / 'state.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {'event': 'indexnow_busy'}
            return self._tick()

    def _tick(self):
        now = self.clock()
        status, body, _ = self.fetch(self.origin + '/indexnow.json')
        if status != 200:
            raise ValueError('Live publication manifest unavailable')
        publication = json.loads(body)
        current = publication_urls(publication, self.origin)
        save(self.directory / 'published-pages.json', publication)
        if not self.path.exists():
            save(self.path, {'version': 1, 'origin': self.origin, 'observed': current,
                             'pending': {}, 'attempts': 0, 'next_attempt': 0,
                             'seeded_at': now, 'accepted_urls': 0})
            return {'event': 'indexnow_baseline_saved', 'urls': len(current)}
        state = json.loads(self.path.read_text())
        if state['version'] != 1 or state['origin'] != self.origin:
            raise ValueError('IndexNow state does not match this site')
        for url in state['observed'].keys() | current.keys():
            if state['observed'].get(url) != current.get(url):
                state['pending'][url] = current.get(url)  # null means removed/noindexed/redirected
        state['observed'] = current
        state['checked_at'] = now
        save(self.path, state)  # Persist changes before any network submission.
        if not state['pending'] or now < state['next_attempt']:
            return {'event': 'indexnow_waiting', 'pending': len(state['pending'])}
        urls = sorted(state['pending'])[:1000]
        status, headers = None, {}
        try:
            key_location = self.origin + '/' + self.key + '.txt'
            key_status, key_body, _ = self.fetch(key_location)
            if key_status != 200 or key_body.decode().strip() != self.key:
                raise ValueError('Key not publicly available yet')
            status, _, headers = self.fetch(ENDPOINT, {
                'host': urlsplit(self.origin).hostname, 'key': self.key,
                'keyLocation': key_location, 'urlList': urls})
            if status not in (200, 202):
                raise ValueError('Submission was not accepted')
        except Exception as error:
            state['attempts'] += 1
            state['next_attempt'] = now + retry_delay(headers, state['attempts'], now)
            state['last_result'] = {'at': now, 'status': status, 'error': type(error).__name__}
            save(self.path, state)
            return {'event': 'indexnow_retry_scheduled', 'status': status,
                    'pending': len(state['pending']), 'next_attempt': state['next_attempt']}
        for url in urls:
            del state['pending'][url]
        state['attempts'], state['next_attempt'] = 0, 0
        state['accepted_urls'] += len(urls)
        state['last_result'] = {'at': now, 'status': status, 'urls': len(urls),
                                'key_validation_pending': status == 202}
        save(self.path, state)
        return {'event': 'indexnow_accepted', **state['last_result'], 'pending': len(state['pending'])}


def start_notifier(stopped):
    key, directory = os.environ.get('INDEXNOW_KEY'), os.environ.get('INDEXNOW_STATE_DIR')
    if not key or not directory:
        print(json.dumps({'event': 'indexnow_disabled'}), flush=True)
        return None
    def run():
        while not stopped.is_set():
            try:
                notifier = Notifier(os.environ.get('PUBLIC_ORIGIN', 'https://vobarna.com'), key, directory)
                result = notifier.tick()
                if result['event'] not in ('indexnow_waiting', 'indexnow_busy'):
                    print(json.dumps(result), flush=True)
            except Exception as error:
                print(json.dumps({'event': 'indexnow_poll_failed', 'error': type(error).__name__}), flush=True)
            stopped.wait(60)
    thread = threading.Thread(target=run, name='indexnow', daemon=True)
    thread.start()
    return thread
