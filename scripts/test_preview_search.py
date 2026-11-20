import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from preview_search import PreviewSearch
from serve_preview import Handler


class PreviewSearchTests(unittest.TestCase):
    def test_normal_preview_forwards_search_to_the_production_engine(self):
        class QuietHandler(Handler):
            def log_message(self, *args):
                pass
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            root = Path(directory)
            (root / 'current/public').mkdir(parents=True)
            (root / 'current/public/programme.json').write_text(json.dumps({'cinemas': [], 'films': []}))
            server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
            server.search = PreviewSearch(server.server_port, publication=root)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f'http://127.0.0.1:{server.server_port}'
                def search(query):
                    request = urllib.request.Request(base + '/api/search', data=json.dumps({'query': query}).encode(),
                        headers={'Content-Type': 'application/json', 'Origin': base})
                    return urllib.request.urlopen(request, timeout=10)
                with search('rt > 80%') as response:
                    result = json.load(response)
                    self.assertEqual(result['mode'], 'local')
                    self.assertEqual(result['intent']['conditions'], [{'field': 'rating_rt', 'op': 'gt', 'value': '80'}])
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                with search('something uplifting') as response:
                    self.assertEqual(json.load(response)['mode'], 'unavailable')
                with self.assertRaises(urllib.error.HTTPError) as error:
                    search('x' * 5000)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
            finally:
                server.shutdown()
                server.search.stop()
                server.server_close()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
