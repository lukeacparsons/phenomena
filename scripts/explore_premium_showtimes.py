#!/usr/bin/env python3
"""Offline, standard-library probe for captured Barcelona cinema schedules.

This does not alter the Worker, refresh KV, or initiate ticket purchases.
See docs/premium-cinema-sources.md for capture commands and known limitations.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo
from original_audio import original_audio as qualify_original
from screening_prices import a1_prices

MADRID = ZoneInfo("Europe/Madrid")
MOOBY_URL = "https://www.moobycinemas.com/aribau"
YELMO_URL = "https://yelmocines.es/cartelera/barcelona/westfield-la-maquinista"
MALL_URL = "https://www.diagonalmarcentre.es/cine/"
CINESA_URL = "https://www.cinesa.es/cines/diagonal-mar/"


def has_vose(value):
    return bool(re.search(r"\bVOSE\b", str(value), re.I))


def mooby_poster_urls(pages):
    posters = {}
    for html in pages:
        root = Document(html).root
        for card in root.find(lambda e: e.tag == "a" and "event" in e.classes()):
            film_id = card.attrs.get("x-ref", "")
            if not re.fullmatch(r"tt\d+", film_id):
                continue
            poster = next(card.find(lambda e: e.tag == "img" and e.attrs.get("src")), None)
            if poster is not None:
                posters.setdefault(film_id, poster.attrs["src"])
    return posters


def mooby_sessions(html, poster_pages=(), *, premium_only=True, original_only=False, all_cinemas=False, original_languages=None):
    match = re.search(r"\bwindow\.shops\s*=\s*", html)
    if not match:
        raise ValueError("Mooby window.shops missing; do not interpret as zero sessions")
    # Decode JSON only: never execute a remote script.
    shops, _ = json.JSONDecoder().raw_decode(html[match.end():])
    by_code = {shop["code"]: shop for shop in shops.values()}
    # Schedule JSON spans all venues, but each page's poster cards do not.
    # Additional captured venue pages fill missing artwork by exact IMDb ID.
    posters = mooby_poster_urls([html, *poster_pages])
    result = []
    venues = [
        ("BAL-BALMES", "mooby-balmes", {"08", "09"}, True),
        ("BAL-ARIBAU", "mooby-aribau", {"05"}, False),
        ("BAL-BOSQUE", "mooby-bosque", {"01"}, True),
    ]
    if all_cinemas:
        venues += [('BAL-ARENAS', 'mooby-arenas', set(), False),
                   ('BAL-GLORIAS', 'mooby-glories', set(), False),
                   ('BAL-SARRIA', 'mooby-sarria', set(), False)]
    for code, cinema_id, rooms, requires_atmos in venues:
        shop = by_code[code]  # Missing venue is a source error.
        for event in shop["events"]:
            qualification = qualify_original(event['version'], audio=event.get('language'),
                original=(original_languages or {}).get(event.get('imdbid')), subtitles=event.get('subtitles_lang'))
            if (original_only and not qualification) or (not original_only and not has_vose(event['version'])):
                continue
            atmos = str(event["audio"]).upper() == "DOLBY ATMOS"
            for performance in event["performances"]:
                room = str(performance["hall_code"]).zfill(2)
                big_screen = room in rooms and (not requires_atmos or atmos)
                if premium_only and not big_screen:
                    continue
                starts = datetime.strptime(performance["time"], "%Y%m%d%H%M%S")
                booking = shop["shop_url"]
                for value in (performance["performance_code"], "esp", shop["id"]):
                    booking = booking.replace("%s", str(value), 1)
                result.append({
                    "id": f"mooby:{shop['id']}:{performance['performance_code']}",
                    "cinema_id": cinema_id, "cinema": shop["name"],
                    "film_id": event["imdbid"], "title": event["name"],
                    "poster_url": posters.get(event["imdbid"]),
                    "localized_title": event["locale_title"],
                    "date": starts.strftime("%Y-%m-%d"),
                    "time": starts.strftime("%H:%M"),
                    "schedule_date_raw": performance["schedule_date"],
                    "room": room, "version": event["version"],
                    "big_screen": big_screen,
                    "language": event["language"], "subtitles": event["subtitles_lang"],
                    "format": event["audio"], "availability": "unknown",
                    "booking_url": booking, "booking_scope": "session",
                    "source_url": MOOBY_URL,
                    **a1_prices(performance, MOOBY_URL),
                    **(qualification or {}),
                })
    return result


YELMO_VENUES = {
    'westfield-la-maquinista': ('1350', 'yelmo-maquinista'),
    'premium-castelldefels': ('814', 'yelmo-castelldefels'),
    'premium-sant-cugat': ('784', 'yelmo-sant-cugat'),
}


def yelmo_sessions(payload, *, premium_only=True, original_only=False, venue='westfield-la-maquinista'):
    data = payload["d"]
    if isinstance(data, str):
        data = json.loads(data)
    vista_id, cinema_id = YELMO_VENUES[venue]
    cinema = next(c for c in data["Cinemas"] if c["Key"] == venue)
    if str(cinema["VistaId"]) != vista_id:
        raise ValueError("Yelmo cinema identity changed")
    result, warnings = [], []
    for day in cinema["Dates"]:
        match = re.fullmatch(r"/Date\((\d+)\)/", day["FilterDate"])
        if not match:
            raise ValueError("Unknown Yelmo date format")
        # This is a calendar-date bucket, NOT a session UTC timestamp.
        date = datetime.fromtimestamp(int(match[1]) / 1000, timezone.utc).date()
        for movie in day["Movies"]:
            for variant in movie["Formats"]:
                tokens = set(variant["Name"].upper().split())
                big_screen = bool(tokens.intersection({"PREMIUM", "XE", "ATMOS"}))
                audio_match = re.match(r'^(.+?)\s+SUBTITULAD[OA]\s+EN\s+', variant['Language'], re.I)
                qualification = qualify_original(variant['Language'], audio=audio_match[1].strip() if audio_match else None)
                if (original_only and not qualification) or (not original_only and not has_vose(variant['Language'])) or (premium_only and not big_screen):
                    continue
                for session in variant["Showtimes"]:
                    if str(session["VistaCinemaId"]) != str(cinema["VistaId"]):
                        raise ValueError("Yelmo session belongs to a different cinema")
                    time = session["Time"]
                    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time):
                        raise ValueError("Unknown Yelmo display time")
                    # The provider has special DST display handling; its midnight
                    # rollover convention has not been verified in a live example.
                    if session.get("IsSpecialDate") or time < "06:00":
                        warnings.append(f"Unverified date boundary: Yelmo {session['ShowtimeId']}")
                        continue
                    result.append({
                        "id": f"yelmo:{cinema['VistaId']}:{session['ShowtimeId']}",
                        "cinema_id": cinema_id, "cinema": cinema["Name"],
                        "film_id": str(movie["Id"]), "title": movie["Title"],
                        "poster_url": movie.get("Poster") or None,
                        "date": date.isoformat(), "time": time,
                        "room": str(session["Screen"]), "version": "VOSE",
                        "big_screen": big_screen,
                        "language": variant["Language"], "subtitles": "Español",
                        "format": variant["Name"], "availability": "unknown",
                        "booking_url": f"https://compra.yelmocines.es/?cinemaVistaId={cinema['VistaId']}&showtimeVistaId={session['ShowtimeId']}",
                        "booking_scope": "session", "source_url": 'https://yelmocines.es/cartelera/barcelona/' + venue,
                        **(qualification or {}),
                    })
    return result, warnings


class Element:
    def __init__(self, tag, attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def text(self):
        return "".join(c.text() if isinstance(c, Element) else c for c in self.children)

    def classes(self):
        return set(self.attrs.get("class", "").split())

    def find(self, predicate):
        for child in self.children:
            if isinstance(child, Element):
                if predicate(child):
                    yield child
                yield from child.find(predicate)


class Document(HTMLParser):
    VOID = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs)
        self.stack[-1].children.append(element)
        if tag not in self.VOID:
            self.stack.append(element)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def diagonal_mar_sessions(html, as_of):
    root = Document(html).root
    date_select = next(root.find(lambda e: e.attrs.get("id") == "DiasCine"), None)
    if date_select is None:
        raise ValueError("Diagonal Mar date selector missing")
    today = next((e.attrs["data-group"] for e in date_select.find(lambda e: e.tag == "option")
                  if e.text().strip().lower() == "hoy"), None)
    if not today:
        raise ValueError("Diagonal Mar explicit 'hoy' date missing")
    date = datetime.strptime(today, "%d_%m_%Y").date().isoformat()
    if date != as_of.astimezone(MADRID).date().isoformat():
        raise ValueError(f"Diagonal Mar date {date} does not match capture day")
    cards = list(root.find(lambda e: "col-cartelera-desktop" in e.classes() and "gallery-item" in e.classes()))
    if not cards:
        raise ValueError("Diagonal Mar film cards missing")
    result = []
    for card in cards:
        title = next(card.find(lambda e: "titol-peli" in e.classes())).text().strip()
        for slot in card.find(lambda e: e.tag == "li" and "horari-item" in e.classes()):
            classes = slot.classes()
            formats = classes.intersection({"imax-label", "isense-label"})
            if "vo-label" not in classes or not formats or not has_vose(slot.text()):
                continue
            match = re.match(r"\s*((?:[01]\d|2[0-3]):[0-5]\d)", slot.text())
            if not match:
                raise ValueError("Diagonal Mar showtime label changed")
            time = match[1]
            format_name = "+".join(sorted("IMAX" if f == "imax-label" else "iSense" for f in formats))
            # The card ID is page-local: this is a synthetic ID, not a booking ID.
            result.append({
                "id": f"diagonalmar:{card.attrs['id']}:{date}:{time}:{format_name}",
                "cinema_id": "cinesa-diagonal-mar", "cinema": "Cinesa Diagonal Mar",
                "film_id": card.attrs["id"], "title": title,
                "date": date, "time": time, "room": None,
                "version": "VOSE", "language": None, "subtitles": "Español",
                "format": format_name, "availability": "unknown",
                "booking_url": CINESA_URL, "booking_scope": "cinema",
                "source_url": MALL_URL,
            })
    return result


def build_report(mooby_html, yelmo_json, mall_html, as_of, mooby_poster_pages=()):
    if as_of.tzinfo is None:
        raise ValueError("--as-of must include a timezone offset")
    yelmo, warnings = yelmo_sessions(yelmo_json)
    sessions = mooby_sessions(mooby_html, mooby_poster_pages) + yelmo + diagonal_mar_sessions(mall_html, as_of)
    unique = {}
    past = 0
    for session in sessions:
        starts = datetime.fromisoformat(f"{session['date']}T{session['time']}").replace(tzinfo=MADRID)
        if starts < as_of:
            past += 1
            continue
        session["timezone"] = "Europe/Madrid"
        previous = unique.get(session["id"])
        if previous is not None and previous != session:
            raise ValueError(f"Conflicting duplicate session {session['id']}")
        unique[session["id"]] = session
    sessions = sorted(unique.values(), key=lambda s: (s["date"], s["time"], s["cinema_id"]))
    counts = Counter(s["cinema_id"] for s in sessions)
    return {
        "as_of": as_of.isoformat(), "sessions": sessions,
        "counts": {key: counts[key] for key in ["mooby-balmes", "mooby-aribau", "mooby-bosque", "yelmo-maquinista", "cinesa-diagonal-mar"]},
        "past_sessions_excluded": past,
        "warnings": warnings + [
            "This offline probe uses Cinesa's today-only shopping-centre fallback. Use scripts/cinesa_showtimes.py for the official multi-day API collector with automatic token bootstrap.",
            "Seat availability is not established for these sources.",
            "Live HTTP access from the deployed Cloudflare Worker is not yet tested.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mooby", type=Path, required=True)
    parser.add_argument("--mooby-poster-page", type=Path, action="append", default=[],
                        help="Additional captured Mooby venue HTML for poster cards; repeat as needed")
    parser.add_argument("--yelmo", type=Path, required=True)
    parser.add_argument("--diagonal-mar", type=Path, required=True)
    parser.add_argument("--as-of", required=True, help="Capture time, e.g. 2026-11-19T10:11:00+01:00")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(args.mooby.read_text(), json.loads(args.yelmo.read_text()),
                          args.diagonal_mar.read_text(), datetime.fromisoformat(args.as_of),
                          [path.read_text() for path in args.mooby_poster_page])
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output)
        print(json.dumps({"output": str(args.output), "counts": report["counts"], "warnings": report["warnings"]}, ensure_ascii=False))
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
