"""Own one private Node search companion for the local Python preview."""
import http.client
import json
import os
from pathlib import Path
import selectors
import subprocess

ROOT = Path(__file__).resolve().parents[1]


class PreviewSearch:
    def __init__(self, port, *, public_site=True, publication=None):
        env = {**os.environ, 'PUBLIC_ORIGIN': f'http://127.0.0.1:{port}',
               'PUBLICATION_ROOT': str(publication or ROOT / '.site')}
        if not public_site:
            env['SEARCH_PROGRAMME_PATH'] = str(ROOT / 'static/preview-data/screenings.json')
        self.process = subprocess.Popen(['node', '--env-file-if-exists=' + str(ROOT / '.env.local'),
                                         str(ROOT / 'src/preview-search.mjs')], cwd=ROOT, env=env,
                                        stdout=subprocess.PIPE, text=True)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=10):
                    raise RuntimeError('Search companion did not start')
                ready = json.loads(self.process.stdout.readline())
            if ready.get('event') != 'preview_search_ready' or not isinstance(ready.get('port'), int):
                raise RuntimeError('Invalid search companion response')
            self.port = ready['port']
            print('Smart search: ' + ('ready' if ready['enabled'] else 'set OPENAI_API_KEY in .env.local to enable AI'), flush=True)
        except Exception:
            self.stop()
            raise

    def request(self, body, headers, *, path='/api/search', method='POST'):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=20)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        self.process.stdout.close()
