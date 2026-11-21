#!/usr/bin/env python3
"""Serve the local preview with background seat and daily ratings refreshes."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from availability_cache import AvailabilityCache
from film_ratings import RatingsRefresher
from public_build import PUBLIC, build
from public_http import serve_public
from public_refresh import PublicRefresher
from optimize_images import optimize_logo, refresh_programme_images
from crawler_health import read_health
from programme_store import file_lock
from http_assets import serve_bytes, serve_file
from preview_search import PreviewSearch

STATIC = Path(__file__).resolve().parents[1] / "static"


class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        self.response_status = code
        super().send_response(code, message)

    def end_headers(self):
        path = urlsplit(self.path).path
        cache = 'no-store' if path in ('/api/search', '/api/geocode') else 'public, max-age=31536000, immutable' if self.response_status in (200, 304) and re.fullmatch(r'/preview-data/images/[a-f0-9]{64}-\d+\.webp', path) else 'no-cache'
        self.send_header("Cache-Control", cache)
        super().end_headers()

    def json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        serve_bytes(self, body, 'application/json; charset=utf-8', status=status)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if getattr(self.server, 'public_site', False) and parsed.path not in ('/api/preview/availability', '/availability.json', '/api/preview/health'):
            if serve_public(self, PUBLIC):
                return
        if parsed.path == "/":
            self.send_response(302)
            self.send_header("Location", "/cinemas.html")
            self.end_headers()
            return
        if parsed.path == '/api/preview/health':
            self.json_response(read_health(STATIC / 'preview-data'))
            return
        if parsed.path in ("/api/preview/availability", "/availability.json"):
            sid = parse_qs(parsed.query).get("session", [""])[0]
            snapshot = self.server.availability.snapshot()
            if getattr(self.server, 'no_background', False):
                # A separate managed process may have refreshed this file.
                try:
                    saved = json.loads((STATIC / 'preview-data/availability.json').read_text())
                    if isinstance(saved.get('sessions'), dict):
                        snapshot = saved
                except (OSError, ValueError):
                    pass
            if not sid:
                self.json_response(snapshot)
            elif sid in snapshot["sessions"]:
                self.json_response(snapshot["sessions"][sid])
            else:
                self.json_response({"error": "Availability is not cached for this screening"}, 404)
            return
        if parsed.path.startswith("/api/"):
            self.json_response({"error": "Unknown local endpoint"}, 404)
            return
        # Avoid directory listings and any linked files outside the static root.
        requested = Path(self.translate_path(parsed.path)).resolve()
        if (not requested.is_relative_to(STATIC.resolve()) or not requested.is_file()
                or requested.is_relative_to((STATIC / 'preview-data/history').resolve())):
            self.send_error(404)
            return
        serve_file(self, requested)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ('/api/search', '/api/geocode'):
            self.json_response({'error': 'method_not_allowed'}, 405)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                self.json_response({'error': 'invalid_input'}, 400)
                return
            headers = {key: self.headers[key] for key in ('Content-Type', 'Origin', 'Host') if key in self.headers}
            status, result = self.server.search.request(self.rfile.read(length), headers, path=path)
            self.json_response(result, status)
        except (ValueError, OSError, AttributeError):
            self.json_response({'error': 'search_unavailable'}, 503)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--seat-refresh-minutes", type=int, default=15)
    parser.add_argument("--programme-refresh-minutes", type=int, default=60)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--public-site", dest="public_site", action="store_true", default=True,
                      help="Serve the generated vobarna.com pages and URL policy (default)")
    mode.add_argument("--legacy-preview", dest="public_site", action="store_false",
                      help="Serve the old ungenerated development shell for isolated debugging")
    parser.add_argument("--no-background", action="store_true", help="Serve cached data without collecting from cinemas")
    args = parser.parse_args()
    if args.seat_refresh_minutes < 1:
        parser.error("--seat-refresh-minutes must be positive")
    if args.programme_refresh_minutes < 1:
        parser.error("--programme-refresh-minutes must be positive")
    if not args.no_background:
        try:
            with file_lock(STATIC / 'preview-data/crawler-service.lock', blocking=False):
                pass
        except BlockingIOError:
            args.no_background = True
            print('Managed crawler is running; serving its cached updates.', flush=True)
    if args.public_site:
        print(json.dumps(build()), flush=True)
    else:
        optimize_logo()
        refresh_programme_images(STATIC / 'preview-data/screenings.json')
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(STATIC)))
    server.public_site = args.public_site
    server.no_background = args.no_background
    server.search = PreviewSearch(args.port, public_site=args.public_site, publication=PUBLIC)
    server.availability = AvailabilityCache(STATIC / "preview-data" / "screenings.json",
                                            STATIC / "preview-data" / "availability.json",
                                            interval=args.seat_refresh_minutes * 60)
    if not args.no_background:
        server.availability.start()
    server.ratings = RatingsRefresher(STATIC / "preview-data" / "screenings.json")
    if not args.no_background:
        server.ratings.start()
    server.publication = PublicRefresher(collect_minutes=args.programme_refresh_minutes)
    if args.public_site and not args.no_background:
        server.publication.start()
    print(f"Local: http://127.0.0.1:{args.port}/" + ('en/' if args.public_site else 'cinemas.html'), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.availability.stop()
        server.ratings.stop()
        server.publication.stop()
        server.search.stop()
        server.server_close()


if __name__ == "__main__":
    main()
