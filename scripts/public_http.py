"""Serve an atomically published site locally, with the production URL policy."""
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, unquote
from http_assets import serve_file, serve_bytes
from date_listings import MADRID, DAY_PATHS, date_view, valid_date, render_date_view


def resolve_url(raw, manifest, now=None):
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
    listing = normalized.rstrip('/') in ('/en', '/es', '/ca') or normalized.rstrip('/') + '/' in {p for paths in DAY_PATHS.values() for p in paths.values()}
    if normalized == '/cinemas.html' or (listing and selection):
        film, session, cinema = (query.get(k, [None])[0] for k in ('film', 'screening', 'cinema'))
        if session:
            target = manifest['screenings'].get(session, {}).get(lang)
            if not target or (film and manifest['films'].get(film, {}).get(lang) != target.split('#')[0]):
                return 404, None
            return 301, target
        for kind, key in [('films', film), ('cinemas', cinema)]:
            if key:
                target = manifest[kind].get(key, {}).get(lang)
                return (301, target) if target else (404, None)
        return 301, '/en/' + ('?' + url.query if url.query else '')
    if not normalized.endswith('/') and '.' not in normalized.split('/')[-1]:
        normalized += '/'
    target = manifest['redirects'].get(normalized, normalized)
    if target not in manifest['pages']:
        return 404, None
    if target != url.path:
        return 301, target + ('?' + url.query if url.query else '')
    if listing and 'date' in query and (len(query['date']) != 1 or not valid_date(query['date'][0])):
        return 404, None
    view = date_view(target, query, now) if manifest.get('date_views', {}).get('version') == 1 else None
    filtered = any(not k.startswith('utm_') and k not in ('gclid', 'fbclid') for k in query)
    if view and view['kind'] != 'date' and filtered:
        return 302, f'/{lang}/?' + ('' if 'date' in query else f'date={view["date"]}&') + url.query
    return 200, target


def serve_public(handler, publication):
    current = (Path(publication) / 'current').resolve()
    if not (current / 'manifest.json').exists():
        return False
    url = urlsplit(handler.path)
    root = current / 'public'
    manifest = json.loads((current / 'manifest.json').read_text())
    page_like = '.' not in url.path.rsplit('/', 1)[-1] or url.path.lower().endswith(('/cinemas.html', '/index.html', '/webmcp.html'))
    now = datetime.now(MADRID)
    status, target = resolve_url(handler.path, manifest, now=now) if page_like else (200, url.path)
    if url.path.startswith('/date-views/'):
        status, target = 404, None
    if status in (302, 301):
        handler.send_response(status)
        handler.send_header('Location', target)
        if status == 302:
            handler.send_header('Cache-Control', 'no-store')
        handler.end_headers()
        return True
    file = root / ((target or '/404.html').lstrip('/') + ('index.html' if target and target.endswith('/') else ''))
    file = file.resolve()
    if not file.is_relative_to(root.resolve()) or not file.is_file():
        status, file = 404, root / '404.html'
    filtered = any(not key.startswith('utm_') and key not in ('gclid', 'fbclid')
                   for key in parse_qs(url.query, keep_blank_values=True))
    headers = {'X-Robots-Tag': 'noindex, follow'} if filtered or status == 404 or file.suffix == '.json' else {}
    view = date_view(target, parse_qs(url.query, keep_blank_values=True), now) if status == 200 and manifest.get('date_views', {}).get('version') == 1 else None
    if view:
        body = render_date_view(root, manifest, view).encode()
        remaining = 86400 - now.hour * 3600 - now.minute * 60 - now.second
        headers['Cache-Control'] = f'public, max-age={min(60, remaining)}'
        serve_bytes(handler, body, 'text/html; charset=utf-8', headers=headers)
    else:
        serve_file(handler, file, status=status, headers=headers)
    return True
