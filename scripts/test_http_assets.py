import gzip
from io import BytesIO
from pathlib import Path
import tempfile
import unittest

from http_assets import accepts_gzip, serve_bytes, serve_file


class Handler:
    def __init__(self, headers=None, command='GET'):
        self.headers, self.command = headers or {}, command
        self.output, self.wfile = {}, BytesIO()
    def send_response(self, status): self.status = status
    def send_header(self, name, value): self.output[name] = value
    def end_headers(self): pass
    def guess_type(self, path): return 'application/json'


class CompressionTests(unittest.TestCase):
    def test_negotiation_roundtrip_conditional_get_and_head(self):
        body = b'{"title":"Dune","credits":"David Lynch"}' * 1000
        get = Handler({'Accept-Encoding': 'br, gzip'})
        serve_bytes(get, body, 'application/json')
        self.assertEqual(gzip.decompress(get.wfile.getvalue()), body)
        self.assertLess(len(get.wfile.getvalue()), len(body) / 10)
        self.assertEqual(get.output['Vary'], 'Accept-Encoding')
        head = Handler({'Accept-Encoding': 'gzip'}, command='HEAD')
        serve_bytes(head, body, 'application/json')
        self.assertEqual(head.output['Content-Length'], get.output['Content-Length'])
        self.assertEqual(head.wfile.getvalue(), b'')
        cached = Handler({'Accept-Encoding': 'gzip', 'If-None-Match': 'W/' + get.output['ETag']})
        serve_bytes(cached, body, 'application/json')
        self.assertEqual(cached.status, 304)
        self.assertEqual(cached.wfile.getvalue(), b'')
        plain = Handler({'Accept-Encoding': 'gzip;q=0, *;q=1', 'If-None-Match': get.output['ETag']})
        serve_bytes(plain, body, 'application/json')
        self.assertEqual(plain.status, 200)
        self.assertNotIn('Content-Encoding', plain.output)
        self.assertEqual(plain.wfile.getvalue(), body)

    def test_error_response_is_never_changed_to_not_modified(self):
        handler = Handler({'If-None-Match': '*'})
        serve_bytes(handler, b'Not found', 'text/plain', status=404)
        self.assertEqual(handler.status, 404)
        self.assertEqual(handler.wfile.getvalue(), b'Not found')

    def test_file_change_invalidates_cached_compression(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'programme.json'
            path.write_bytes(b'abc' * 1000)
            first = Handler({'Accept-Encoding': 'gzip'})
            serve_file(first, path)
            path.write_bytes(b'defg' * 1000)
            second = Handler({'Accept-Encoding': 'gzip'})
            serve_file(second, path)
            self.assertNotEqual(first.output['ETag'], second.output['ETag'])
            self.assertEqual(gzip.decompress(second.wfile.getvalue()), b'defg' * 1000)

    def test_encoding_quality(self):
        for value in ('', 'br', 'gzip;q=0', '*;q=0', 'gzip;q=invalid'):
            self.assertFalse(accepts_gzip(value))
        for value in ('gzip', 'br, gzip;q=0.5', '*', 'GZip'):
            self.assertTrue(accepts_gzip(value))
