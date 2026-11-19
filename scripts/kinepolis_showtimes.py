#!/usr/bin/env python3
"""Collect Splau VOSE + Atmos/Laser ULTRA from Kinépolis's embedded programme.

Uses the same curl_cffi dependency as scripts/requirements-cinesa.txt.
--input reads a saved HTML capture without network access. No login needed.
"""

import argparse
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
from zoneinfo import ZoneInfo
from urllib.parse import quote

from cinesa_showtimes import atomic_write
from original_audio import original_audio as qualify_original

SOURCE_URL = "https://kinepolis.es/movie-formats/laser-ultra"
COMPLEX = "PFULL"
MADRID = ZoneInfo("Europe/Madrid")


def poster_url(data, film):
    # The public site's createPosterUrl adds "images" before the media path.
    # Omitting its ?impolicy=Poster avoids the 220px listing derivative.
    base = data.get("movieservice_image_url")
    if base != "https://cdn.kinepolis.es/":
        return None
    for asset in film.get("images", []):
        path = asset.get("url", "")
        if asset.get("mediaType") == "Poster Graphic" and path.startswith("/ES/"):
            return base + "images" + quote(path, safe="/:")
    return None


def programme_from_html(html):
    # Decode JSON assignments; never execute downloaded JavaScript. The format
    # page embeds a full national programme before client-side format filtering.
    for match in re.finditer(r"jQuery\.extend\(Drupal\.settings,\s*", html):
        data, _ = json.JSONDecoder().raw_decode(html[match.end():])
        if "variables" in data and "current_movies" in data["variables"]:
            return data["variables"]
    raise ValueError("Kinépolis programme missing; do not treat as zero sessions")


def splau_sessions(data, *, premium_only=True, original_only=False):
    complexes = [c for c in data["complexes"] if c["complexCode"] == COMPLEX]
    if len(complexes) != 1 or not complexes[0]["isActive"] or complexes[0]["inMaintenance"]:
        raise ValueError("Splau identity missing or programme unavailable")
    unique, observed = {}, {}
    for section in ("current_movies", "future_movies"):
        programme = data[section]
        films = {film["id"]: film for film in programme["films"]}
        for session in programme["sessions"]:
            if session["complexOperator"] != COMPLEX:
                continue
            starts = datetime.fromisoformat(session["showtime"])
            if starts.tzinfo is None:
                raise ValueError("Kinépolis showtime is missing its UTC offset")
            observed[session["id"]] = starts.astimezone(MADRID).date().isoformat()
            if session["mainComplex"] != COMPLEX:
                raise ValueError("Splau booking cinema does not match the session")
            if not session["isPublicScreening"]:
                continue
            raw = {value.strip().casefold() for value in session["rawSessionAttributes"].split(",")}
            formats = [label for key, label in [("atmos", "Dolby Atmos"), ("laserultra", "Laser ULTRA")] if key in raw]
            big_screen = bool(formats)
            if (premium_only and not big_screen) or (not original_only and ("es" not in raw or "nosubt" in raw)):
                continue
            # Join this exact film variant, not a corporate ID shared by dubbed
            # and original versions. Confirm original audio and Spanish subtitles.
            film = films[session["film"]["id"]]
            audio, original = film.get("audioLanguage"), film.get("originalAudioLanguage")
            if original_only and (not audio or not original):
                continue
            if not audio or not original:
                raise ValueError("Premium subtitled session has unknown original audio language")
            if audio.casefold() != original.casefold():
                continue
            spoken = film.get("spokenLanguage")
            # Some exact film variants supply [] here despite explicit matching
            # audioLanguage/originalAudioLanguage and Spanish subtitle IDs.
            if isinstance(spoken, dict) and spoken.get("code") and spoken["code"].casefold() not in raw:
                raise ValueError("Kinépolis session and film audio languages disagree")
            spanish_ids = {str(sub["id"]) for sub in film.get("subtitles", []) if sub.get("code") == "Span Subt"}
            session_subtitles = {str(sub["id"]) for sub in session.get("sessionSubtitles", [])}
            if not original_only and not spanish_ids.intersection(session_subtitles):
                raise ValueError("Spanish subtitle attribute disagrees with subtitle metadata")
            subtitle = 'Español' if spanish_ids.intersection(session_subtitles) else None
            qualification = qualify_original('', audio=audio, original=original, subtitles=subtitle)
            sid = session["id"]
            if sid != COMPLEX + "-" + str(session["vistaSessionId"]) or not re.fullmatch(r"PFULL-\d+", sid):
                raise ValueError("Kinépolis session identity mismatch")
            sold_out = session["isSoldOut"]
            if type(sold_out) is not bool:
                raise ValueError("Kinépolis sold-out flag is invalid")
            local = starts.astimezone(MADRID)
            row = {
                "id": "kinepolis:" + sid, "provider": "kinepolis", "provider_session_id": sid,
                "cinema_id": "kinepolis-splau", "cinema": complexes[0]["name"],
                "film_id": film["id"], "imdb_id": film.get("imdbCode"), "title": film["title"],
                "poster_url": poster_url(data, film),
                "runtime_minutes": film.get("duration"), "starts_at": starts.isoformat(),
                "date": local.date().isoformat(), "time": local.strftime("%H:%M"), "timezone": "Europe/Madrid",
                "business_date": datetime.fromisoformat(session["businessDay"]).astimezone(MADRID).date().isoformat(),
                "room": str(session["hall"]), "version": "VOSE", "language": audio,
                "big_screen": big_screen,
                "subtitles": "Español", "format": " + ".join(formats),
                "raw_attributes": session["rawSessionAttributes"], "is_sold_out": sold_out,
                "availability": "sold_out" if sold_out else "not_marked_sold_out",
                "booking_url": f"https://kinepolis.es/direct-vista-redirect/{session['vistaSessionId']}/0/{COMPLEX}/0",
                "booking_scope": "session", "source_url": SOURCE_URL,
                **(qualification or {}),
            }
            if sid in unique and unique[sid] != row:
                raise ValueError("Conflicting current/future programme sessions")
            unique[sid] = row
    return list(unique.values()), observed


def build_report(html, start, days, as_of, *, premium_only=True, original_only=False):
    rows, observed = splau_sessions(programme_from_html(html), premium_only=premium_only, original_only=original_only)
    end = start + timedelta(days=days - 1) if days is not None else None
    published = sorted(set(observed.values()))
    beyond_window = [day for day in published if end is not None and day > end.isoformat()]
    rows = [row for row in rows if row["date"] >= start.isoformat()
            and (end is None or row["date"] <= end.isoformat())
            and datetime.fromisoformat(row["starts_at"]) >= as_of]
    return {
        "provider": "kinepolis", "cinema_id": "kinepolis-splau", "status": "ok", "fetched_at": as_of.isoformat(),
        "coverage": {"mode": "all_published" if end is None else "date_window",
                     "requested_start": start.isoformat(), "requested_end": end.isoformat() if end else None,
                     "published_dates": published,
                     "latest_published_date": published[-1] if published else None,
                     "latest_qualifying_date": max((row["date"] for row in rows), default=None),
                     "truncated_by_window": bool(beyond_window),
                     "published_dates_beyond_window": beyond_window},
        "sessions_examined": len(observed), "count": len(rows),
        "counts_by_format": dict(Counter(row["format"] for row in rows)),
        "sessions": sorted(rows, key=lambda row: (row["starts_at"], row["id"])),
    }


def fetch_html():
    from curl_cffi import requests
    try:
        response = requests.get(SOURCE_URL, impersonate="chrome", timeout=45, allow_redirects=False)
    except requests.RequestsError:
        raise ValueError("Kinépolis network request failed") from None
    if response.status_code != 200 or "text/html" not in response.headers.get("content-type", ""):
        raise ValueError(f"Kinépolis fetch failed: HTTP {response.status_code}")
    return response.text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Saved modern programme HTML; otherwise fetch live")
    parser.add_argument("--as-of", type=datetime.fromisoformat, help="Capture timestamp with offset, for --input")
    parser.add_argument("--start-date", type=date.fromisoformat, help="Madrid date; default capture day")
    parser.add_argument("--days", type=int, help="Optional calendar window, 1–90 days; default: all published future dates")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.days is not None and not 1 <= args.days <= 90:
        parser.error("--days must be between 1 and 90")
    if bool(args.input) != bool(args.as_of):
        parser.error("--input and --as-of must be supplied together")
    as_of = args.as_of or datetime.now(timezone.utc)
    if as_of.tzinfo is None:
        parser.error("--as-of needs a UTC offset")
    try:
        html = args.input.read_text() if args.input else fetch_html()
        report = build_report(html, args.start_date or as_of.astimezone(MADRID).date(), args.days, as_of)
        atomic_write(args.output, report)
    except ImportError:
        print("Install scripts/requirements-cinesa.txt for the shared HTTP client", file=sys.stderr)
        return 1
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        print("Kinépolis collection failed (HTTP, schema or file error); previous output preserved", file=sys.stderr)
        return 1
    print(json.dumps({key: report[key] for key in ("fetched_at", "count", "counts_by_format", "sessions_examined")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
