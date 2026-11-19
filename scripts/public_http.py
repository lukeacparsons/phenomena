"""Serve an atomically published site locally, with the production URL policy."""
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, unquote
from http_assets import serve_file


def resolve_url(raw, manifest):
    url = urlsplit(raw)
    path = unquote(url.path)
    query = parse_qs(url.query, keep_blank_values=True)
    lang = path.strip('/').split('/')[0].lower()
    lang = lang if lang in ('en', 'es', 'ca') else 'en'
    normalized = '/' + '/'.join(x for x in path.lower().split('/') if x)
    if path.endswith('/') and normalized != '/':
        normalized += '/'
    if normalized.endswith('/index.html'):
        normalized = normalized[:-10]
    if normalized in ('/', '/index.html'):
        normalized = '/en/'
    if normalized == '/webmcp.html':
        normalized = '/webmcp/'
    selection = any(query.get(key, [''])[0] for key in ('film', 'screening', 'cinema'))
    listing = normalized.rstrip('/') in ('/en', '/es', '/ca')
    if normalized == '/cinemas.html' or (listing and selection):
        film, session, cinema = (query.get(k, [None])[0] for k in ('film', 'screening', 'cinema'))
        if session:
            target = manifest['screenings'].get(session, {}).get(lang)
            if not target or (film and manifest['films'].get(film, {}).get(lang) != target.split('#')[0]):
                return 404, None
            return 308, target
        for kind, key in [('films', film), ('cinemas', cinema)]:
            if key:
                target = manifest[kind].get(key, {}).get(lang)
                return (308, target) if target else (404, None)
        return 308, '/en/' + ('?' + url.query if url.query else '')
    if not normalized.endswith('/') and '.' not in normalized.split('/')[-1]:
        normalized += '/'
    target = manifest['redirects'].get(normalized, normalized)
    if target not in manifest['pages']:
        return 404, None
    if target != url.path:
        return 308, target + ('?' + url.query if url.query else '')
    return 200, target


def serve_public(handler, publication):
    current = (Path(publication) / 'current').resolve()
    if not (current / 'manifest.json').exists():
        return False
    url = urlsplit(handler.path)
    root = current / 'public'
    manifest = json.loads((current / 'manifest.json').read_text())
    page_like = '.' not in url.path.rsplit('/', 1)[-1] or url.path.lower().endswith(('/cinemas.html', '/index.html', '/webmcp.html'))
    status, target = resolve_url(handler.path, manifest) if page_like else (200, url.path)
    if status == 308:
        handler.send_response(308)
        handler.send_header('Location', target)
        handler.end_headers()
        return True
    file = root / ((target or '/404.html').lstrip('/') + ('index.html' if target and target.endswith('/') else ''))
    file = file.resolve()
    if not file.is_relative_to(root.resolve()) or not file.is_file():
        status, file = 404, root / '404.html'
    filtered = any(not key.startswith('utm_') and key not in ('gclid', 'fbclid')
                   for key in parse_qs(url.query, keep_blank_values=True))
    headers = {'X-Robots-Tag': 'noindex, follow'} if filtered or status == 404 or file.suffix == '.json' else {}
    serve_file(handler, file, status=status, headers=headers)
    return True
