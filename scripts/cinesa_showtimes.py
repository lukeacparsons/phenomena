#!/usr/bin/env python3
"""Collect premium Cinesa VOSE screenings using fresh anonymous site config.

Python 3.10+; install scripts/requirements-cinesa.txt. No stored credentials,
personal browser session, or token file. See docs/premium-cinema-sources.md.
"""

import argparse
import base64
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import quote, urlencode, urlsplit
from zoneinfo import ZoneInfo
from original_audio import original_audio as qualify_original

BOOTSTRAP = "https://www.cinesa.es/api/omnia/v1/initialData"
API_BASE = "https://vwc.cinesa.es/WSVistaWebClient"
POSTER_BASE = "https://vwc.cinesa.es/CDN"
SOURCE_URL = "https://www.cinesa.es/Cines/diagonal-mar/"
SITE_ID = "032"
VENUES = {
    "diagonal-mar": {"site_id": SITE_ID, "cinema_id": "cinesa-diagonal-mar",
                     "name": "Cinesa Diagonal Mar", "source_url": SOURCE_URL,
                     "requires_premium_format": True, "venue_experience": None},
    "la-farga": {"site_id": "010", "cinema_id": "cinesa-la-farga",
                 "name": "Cinesa LUXE La Farga", "source_url": "https://www.cinesa.es/cines/la-farga/",
                 "requires_premium_format": False, "venue_experience": "LUXE"},
}
for _slug, _site, _name in [('diagonal', '012', 'Cinesa Diagonal'), ('som-multiespai', '017', 'Cinesa SOM Multiespai')]:
    VENUES[_slug] = {'site_id': _site, 'cinema_id': 'cinesa-' + _slug, 'name': _name,
                     'source_url': 'https://www.cinesa.es/cines/' + _slug + '/',
                     'requires_premium_format': True, 'venue_experience': None}
VENUES['barnasud'] = {'site_id': '040', 'cinema_id': 'cinesa-barnasud', 'name': 'Cinesa LUXE Barnasud',
                     'source_url': 'https://www.cinesa.es/cines/barnasud/',
                     'requires_premium_format': True, 'venue_experience': 'LUXE'}


def venue_for_cinema(cinema_id):
    return next(key for key, value in VENUES.items() if value['cinema_id'] == cinema_id)


MADRID = ZoneInfo("Europe/Madrid")


class SourceError(RuntimeError):
    """Safe diagnostic: never include response bodies or request headers."""


class ChromeTransport:
    def __init__(self):
        from curl_cffi import requests
        self.requests = requests
        # Scope the tunnel to this provider. Never configure process-wide proxies:
        # other cinemas, health delivery and publication keep their normal route.
        self.proxy = os.environ.get('VOBARNA_CINESA_PROXY') or None
        if self.proxy:
            parsed = urlsplit(self.proxy)
            if parsed.scheme != 'http' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
                raise SourceError('Invalid Cinesa proxy configuration')
        self.session = requests.Session(impersonate="chrome", trust_env=False)

    def get(self, url, headers):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in ('www.cinesa.es', 'vwc.cinesa.es') or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise SourceError('Cinesa request origin not allowed')
        try:
            # Do not forward the bearer token to a redirect destination.
            # A configured tunnel must succeed: never retry its failures directly.
            return self.session.get(url, headers=headers, timeout=30,
                                    allow_redirects=False, proxy=self.proxy)
        except self.requests.RequestsError:
            raise SourceError("Cinesa network request failed") from None

    def close(self):
        self.session.close()


def json_object(response, stage):
    if response.status_code != 200:
        detail = " (access challenge; retry on a later run)" if response.status_code == 403 else ""
        raise SourceError(f"Cinesa {stage}: HTTP {response.status_code}{detail}")
    if "application/json" not in response.headers.get("content-type", "").lower():
        raise SourceError(f"Cinesa {stage}: expected JSON, possibly an access challenge")
    try:
        value = response.json()
    except ValueError:
        raise SourceError(f"Cinesa {stage}: invalid JSON") from None
    if not isinstance(value, dict):
        raise SourceError(f"Cinesa {stage}: expected a JSON object")
    return value


def token_expiry(token):
    # Read exp only to schedule refresh; this is not JWT signature validation.
    try:
        part = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        expiry = claims.get("exp")
        return expiry if type(expiry) in (int, float) else None
    except (ValueError, IndexError, AttributeError):
        return None  # An opaque token still gets per-run bootstrap + 401 refresh.


class CinesaClient:
    def __init__(self, transport, clock=time.time, sleep=time.sleep, venue="diagonal-mar"):
        self.transport, self.clock, self.sleep = transport, clock, sleep
        self.venue_key = venue
        self.venue = VENUES[venue]
        self._token = None
        self.expires_at = None
        self.bootstrap_count = 0
        self.poster_base = POSTER_BASE

    def _get(self, url, headers):
        for attempt in range(3):
            response = self.transport.get(url, headers=headers)
            if response.status_code not in (429, 500, 502, 503, 504) or attempt == 2:
                return response
            retry_after = response.headers.get("retry-after")
            if retry_after is not None:
                try:
                    delay = max(0, float(retry_after))
                except ValueError:
                    return response  # Leave date-form Retry-After to a later run.
                if not 0 <= delay <= 30:
                    return response
            else:
                delay = (1, 3)[attempt]
            self.sleep(delay)

    def bootstrap(self):
        data = json_object(self._get(BOOTSTRAP, {"Accept": "application/json"}), "bootstrap")
        api = data.get("api")
        if not isinstance(api, dict) or api.get("apiUrl") != API_BASE:
            raise SourceError("Cinesa bootstrap: unexpected API address")
        token = api.get("authToken")
        if not isinstance(token, str) or not token.strip() or "\n" in token or "\r" in token:
            raise SourceError("Cinesa bootstrap: missing or invalid anonymous token")
        expiry = token_expiry(token)
        if expiry is not None and expiry <= self.clock():
            raise SourceError("Cinesa bootstrap returned an expired token")
        self._token, self.expires_at = token, expiry
        # This public CDN needs no bearer token. A changed/absent image service
        # must not prevent schedule collection; leave artwork unknown instead.
        self.poster_base = api.get("vistaCdn") if api.get("vistaCdn") == POSTER_BASE else None
        self.bootstrap_count += 1

    def get(self, route):
        if not route.startswith("/") or "?" in route or "#" in route:
            raise ValueError("Expected an API path without query parameters")
        if self._token is None or (self.expires_at is not None and self.expires_at <= self.clock() + 60):
            self.bootstrap()
        url = API_BASE + "/ocapi/v1" + route + "?" + urlencode({"siteIds": self.venue["site_id"]})
        for attempt in range(2):
            response = self._get(url, {"Accept": "application/json", "Authorization": "Bearer " + self._token})
            if response.status_code == 401 and attempt == 0:
                self.bootstrap()
                continue
            return json_object(response, "schedule API")


def published_dates(payload, site_id=SITE_ID):
    result = set()
    # These attributes are aggregated per film/date: never use them to qualify
    # individual sessions. Fetch the date and check each showtime instead.
    for day in payload["filmScreeningDates"]:
        if any(site["siteId"] == site_id for film in day["filmScreenings"] for site in film["sites"]):
            result.add(date.fromisoformat(day["businessDate"]))
    return sorted(result)


def localized_text(value):
    text = value["text"]
    if not isinstance(text, str) or not text.strip():
        raise SourceError("Cinesa schedule: missing label")
    return text


def cinesa_sessions(payload, business_date, venue="diagonal-mar", poster_base=POSTER_BASE, *, premium_only=True, original_only=False):
    cinema = VENUES[venue]
    if payload["businessDate"] != business_date.isoformat():
        raise SourceError("Cinesa returned the wrong business date")
    related = payload["relatedData"]
    films = {item["id"]: item for item in related["films"]}
    screens = {item["id"]: item for item in related["screens"]}
    attributes = {item["id"]: localized_text(item["name"]) for item in related["attributes"]}
    result = []
    for session in payload["showtimes"]:
        if session["siteId"] != cinema["site_id"]:
            raise SourceError("Cinesa returned a different cinema")
        labels = [attributes[key] for key in session["attributeIds"]]
        normalized = {label.strip().casefold().rstrip(".") for label in labels}
        formats = [name for name in ("IMAX", "iSense") if name.casefold() in normalized]
        big_screen = not cinema["requires_premium_format"] or bool(formats)
        qualification = qualify_original(' '.join(labels))
        if (original_only and not qualification) or (not original_only and 'vose' not in normalized) or (premium_only and not big_screen):
            continue
        film = films[session["filmId"]]
        screen = screens[session["screenId"]]
        session_id = session["id"]
        if not isinstance(session_id, str) or not re.fullmatch(re.escape(cinema["site_id"]) + r"-\d+", session_id):
            raise SourceError("Cinesa returned an unexpected session ID")
        schedule = session["schedule"]
        if schedule["businessDate"] != business_date.isoformat():
            raise SourceError("Cinesa session business date mismatch")
        starts = datetime.fromisoformat(schedule["startsAt"].replace("Z", "+00:00"))
        if starts.tzinfo is None:
            raise SourceError("Cinesa session has no time-zone offset")
        local = starts.astimezone(MADRID)
        sold_out = session["isSoldOut"]
        if type(sold_out) is not bool:
            raise SourceError("Cinesa returned an invalid sold-out flag")
        room_name = localized_text(screen["name"])
        room = re.match(r"Sala\s+(\d+)\b", room_name, re.I)
        result.append({
            "id": "cinesa:" + session_id, "provider": "cinesa",
            "provider_session_id": session_id, "cinema_id": cinema["cinema_id"],
            "cinema": cinema["name"], "film_id": film["id"],
            "title": localized_text(film["title"]), "runtime_minutes": film.get("runtimeInMinutes"),
            "poster_url": (poster_base + "/media/entity/get/FilmPosterGraphic/" + quote(film["id"], safe=""))
                          if poster_base else None,
            "business_date": business_date.isoformat(), "starts_at": starts.isoformat(),
            "film_starts_at": schedule.get("filmStartsAt"), "timezone": "Europe/Madrid",
            "date": local.date().isoformat(), "time": local.strftime("%H:%M"),
            # Screen ID suffix is NOT necessarily the public room number.
            "screen_id": screen["id"], "room": room.group(1) if room else room_name,
            "room_name": room_name, "version": "VOSE", "language": None,
            "big_screen": big_screen,
            "subtitles": "Español", "format": " + ".join(formats) or None,
            "venue_experience": cinema["venue_experience"],
            "attributes": labels, "is_sold_out": sold_out,
            "availability": "sold_out" if sold_out else "not_marked_sold_out",
            "booking_url": "https://www.cinesa.es/compra/butacas/?" + urlencode({"showtimeId": session_id}),
            "booking_scope": "session", "source_url": cinema["source_url"],
            **(qualification or {}),
        })
    return result


def collect(client, start, days, as_of, *, premium_only=True, original_only=False):
    end = start + timedelta(days=days - 1) if days is not None else None
    published = published_dates(client.get("/film-screening-dates"), client.venue["site_id"])
    requested = [day for day in published if day >= start and (end is None or day <= end)]
    beyond_window = [day.isoformat() for day in published if end is not None and day > end]
    sessions, total, past = [], 0, 0
    for day in requested:
        payload = client.get("/showtimes/by-business-date/" + day.isoformat())
        rows = cinesa_sessions(payload, day, client.venue_key, client.poster_base, premium_only=premium_only, original_only=original_only)
        total += len(payload["showtimes"])
        for row in rows:
            if datetime.fromisoformat(row["starts_at"]) < as_of:
                past += 1
            else:
                sessions.append(row)
    if len({row["id"] for row in sessions}) != len(sessions):
        raise SourceError("Cinesa returned duplicate session IDs across dates")
    return {
        "provider": "cinesa", "cinema_id": client.venue["cinema_id"], "status": "ok",
        "fetched_at": as_of.isoformat(), "timezone": "Europe/Madrid",
        "coverage": {"mode": "all_published" if end is None else "date_window",
                     "requested_start": start.isoformat(), "requested_end": end.isoformat() if end else None,
                     "published_dates": [day.isoformat() for day in published],
                     "fetched_dates": [day.isoformat() for day in requested],
                     "latest_published_date": published[-1].isoformat() if published else None,
                     "latest_qualifying_date": max((row["date"] for row in sessions), default=None),
                     "truncated_by_window": bool(beyond_window),
                     "published_dates_beyond_window": beyond_window},
        "sessions_examined": total, "past_matches_excluded": past,
        "count": len(sessions), "counts_by_format": dict(Counter(row["format"] or "unspecified" for row in sessions)),
        "sessions": sorted(sessions, key=lambda row: (row["starts_at"], row["id"])),
    }


def atomic_write(path, report, *, compact=False):
    # A failed or partial fetch must leave the previous good snapshot untouched.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temp_path = Path(stream.name)
            json.dump(report, stream, ensure_ascii=False, indent=None if compact else 2,
                      separators=(',', ':') if compact else None, allow_nan=False)
            stream.write("\n")
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cinema", choices=VENUES, default="diagonal-mar", help="Venue and qualification rule")
    parser.add_argument("--start-date", type=date.fromisoformat, help="Madrid date; default today")
    parser.add_argument("--days", type=int, help="Optional calendar window, 1–60 days; default: all published future dates")
    parser.add_argument("--output", type=Path, required=True, help="Atomically replaced only on complete success")
    args = parser.parse_args()
    if args.days is not None and not 1 <= args.days <= 60:
        parser.error("--days must be between 1 and 60")
    as_of = datetime.now(timezone.utc)
    transport = None
    try:
        transport = ChromeTransport()
        client = CinesaClient(transport, venue=args.cinema)
        report = collect(client, args.start_date or as_of.astimezone(MADRID).date(), args.days, as_of)
        atomic_write(args.output, report)
    except ImportError:
        print("Install scripts/requirements-cinesa.txt in a Python 3.10+ environment", file=sys.stderr)
        return 1
    except SourceError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (KeyError, TypeError, ValueError, AttributeError):
        print("Cinesa response schema changed; previous output preserved", file=sys.stderr)
        return 1
    except OSError:
        print("Could not write snapshot; check the output directory", file=sys.stderr)
        return 1
    finally:
        if transport is not None:
            transport.close()
    print(json.dumps({key: report[key] for key in ("fetched_at", "count", "counts_by_format", "sessions_examined")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
