"""Compressed, revalidatable local responses matching the public asset behavior."""
from functools import lru_cache
import gzip
import hashlib

COMPRESSIBLE = {'.json', '.html', '.js', '.mjs', '.css', '.svg', '.txt', '.xml', '.ttf'}


def accepts_gzip(header):
    qualities = {}
    for entry in header.lower().split(','):
        parts = [part.strip() for part in entry.split(';')]
        quality = 1
        for param in parts[1:]:
            if param.startswith('q='):
                try:
                    quality = float(param[2:])
                except ValueError:
                    quality = 0
        qualities[parts[0]] = quality
    return qualities.get('gzip', qualities.get('*', 0)) > 0


def representations(body):
    compressed = gzip.compress(body, compresslevel=6, mtime=0) if len(body) >= 1024 else body
    if len(compressed) >= len(body):
        compressed = None
    return body, compressed


@lru_cache(maxsize=64)
def file_representations(path, modified, size):
    # The metadata arguments invalidate this bounded cache after atomic rewrites.
    return representations(path.read_bytes())


def serve_bytes(handler, body, content_type, *, status=200, headers=None, encoded=None):
    identity, compressed = encoded or representations(body)
    zipped = compressed is not None and accepts_gzip(handler.headers.get('Accept-Encoding', ''))
    output = compressed if zipped else identity
    etag = '"' + hashlib.sha256(output).hexdigest() + '"'
    matches = [value.strip().removeprefix('W/') for value in handler.headers.get('If-None-Match', '').split(',')]
    not_modified = status == 200 and (etag in matches or '*' in matches)
    handler.send_response(304 if not_modified else status)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Vary', 'Accept-Encoding')
    handler.send_header('ETag', etag)
    if zipped:
        handler.send_header('Content-Encoding', 'gzip')
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    if not not_modified:
        handler.send_header('Content-Length', str(len(output)))
    handler.end_headers()
    if handler.command != 'HEAD' and not not_modified:
        handler.wfile.write(output)


def serve_file(handler, file, *, status=200, headers=None):
    content_type = handler.guess_type(str(file))
    stat = file.stat()
    if file.suffix in COMPRESSIBLE:
        encoded = file_representations(file, stat.st_mtime_ns, stat.st_size)
        serve_bytes(handler, None, content_type, status=status, headers=headers, encoded=encoded)
        return
    # Encoded images stay streamed, without spending CPU recompressing them.
    handler.send_response(status)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(stat.st_size))
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    if handler.command != 'HEAD':
        with file.open('rb') as source:
            handler.copyfile(source, handler.wfile)
