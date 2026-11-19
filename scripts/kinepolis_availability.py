#!/usr/bin/env python3
"""Read Splau's remaining seats per area without selecting tickets or seats.

Follows the public cinema/session entry form into an empty anonymous ticketing
session. Uses the curl_cffi dependency in scripts/requirements-cinesa.txt.
"""

import argparse
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

from cinesa_showtimes import atomic_write

TICKETING = "https://tickets.kinepolis.es"
COMPLEX = "PFULL"
INTERNAL_CINEMA_ID = "361"


class AvailabilityError(ValueError):
    """Safe error messages without ticketing session identifiers or cookies."""


class EntryForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.action = None
        self.fields = {}
        self.count = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form" and attrs.get("id") == "movie-program-vista-redirect-form":
            self.inside = True
            self.action = attrs.get("action")
            self.count += 1
        if self.inside and tag == "input" and attrs.get("type") == "hidden" and "name" in attrs:
            self.fields[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.inside = False


def entry_fields(html, session_id):
    form = EntryForm()
    form.feed(html)
    if form.count != 1 or form.action != TICKETING:
        raise AvailabilityError("Splau entry form changed")
    if form.fields.get("CinemaId") != COMPLEX or form.fields.get("SessionId") != session_id:
        raise AvailabilityError("Splau entry form has the wrong screening")
    # Pass only the observed navigation fields. Never replay newly introduced
    # ticket quantities, seat selections, order data or payment inputs.
    allowed = {"CountryCode", "ReferrerUrl", "Culture", "CinemaId", "SessionId", "FilmId",
               "isMarathon", "EventID", "promotionID", "isSubscriptionChoice", "isSubscriptionNoChoice",
               "form_build_id", "form_id"}
    if set(form.fields) - allowed:
        raise AvailabilityError("Splau entry form has unexpected fields")
    if form.fields.get("CountryCode") != "ES":
        raise AvailabilityError("Splau entry form has the wrong country")
    return form.fields


def assignment(html, pattern):
    match = re.search(pattern + r"\s*=\s*", html)
    if match is None:
        raise AvailabilityError("Splau availability metadata missing")
    # JSON literals only, without executing remote JavaScript.
    return json.JSONDecoder().raw_decode(html[match.end():])[0]


def parse_availability(html, session_id, fetched_at):
    order = assignment(html, r"\bvar\s+orderData")
    if str(order["CinemaId"]) != INTERNAL_CINEMA_ID or order["Country"] != "ES":
        raise AvailabilityError("Splau ticketing cinema identity changed")
    if order["OrderId"] != 0 or order["NumberSeats"] != 0 or order["SelectedTickets"] or order["AllocatedSeats"]:
        raise AvailabilityError("Expected an empty ticketing session")
    title = assignment(html, r"\bselligentObj\.movie\.movieTitle")
    room = assignment(html, r"\bselligentObj\.purchase\.cinema\.hall\.id")
    if not isinstance(title, str) or not title or not re.fullmatch(r"\d+", str(room)):
        raise AvailabilityError("Splau film or room metadata missing")
    # Different fares (general/reduced/loyalty) share the same seating area.
    # Their own SeatsAvailable fields were zero placeholders. Count availSeats
    # once per AreaCode, never sum across ticket products.
    labels = {}
    for match in re.finditer(r"\bticketData\[[^\]]+\]\s*=\s*", html):
        ticket, _ = json.JSONDecoder().raw_decode(html[match.end():])
        labels.setdefault(ticket["AreaCategoryCode"], set()).add(unescape(ticket["DisplayName"]))
    areas = assignment(html, r"\bvar\s+availSeats")
    if not isinstance(areas, list) or not areas:
        raise AvailabilityError("Splau area availability missing")
    result, seen = [], set()
    for area in areas:
        code, remaining, sold_out = area["AreaCode"], area["SeatsAvailable"], area["IsSoldOut"]
        if not isinstance(code, str) or code in seen or code not in labels:
            raise AvailabilityError("Splau area identities are missing or duplicated")
        if type(remaining) is not int or remaining < 0 or type(sold_out) is not bool:
            raise AvailabilityError("Splau area availability is invalid")
        seen.add(code)
        result.append({"area_code": code, "ticket_labels": sorted(labels[code]),
                       "available": remaining, "is_sold_out": sold_out})
    return {
        "provider": "kinepolis", "cinema_id": "kinepolis-splau", "provider_session_id": COMPLEX + "-" + session_id,
        "title": unescape(title), "room": str(room), "availability_kind": "area_counts",
        "available_total": sum(area["available"] for area in result), "areas": result,
        "capacity": None, "accessibility_breakdown": None,
        "availability_fetched_at": fetched_at.isoformat(),
        "source_url": f"https://kinepolis.es/direct-vista-redirect/{session_id}/0/{COMPLEX}/0",
    }


def fetch_availability(session_id):
    from curl_cffi import requests
    entry_url = f"https://kinepolis.es/direct-vista-redirect/{session_id}/0/{COMPLEX}/0"
    try:
        # A separate anonymous cookie jar per screening prevents carrying a cart
        # between sessions. No browser profile or credentials are read or saved.
        with requests.Session(impersonate="chrome") as client:
            entry = client.get(entry_url, timeout=30, allow_redirects=False)
            if entry.status_code != 200:
                raise AvailabilityError(f"Splau entry failed: HTTP {entry.status_code}")
            fields = entry_fields(entry.text, session_id)
            # Follow the navigation redirect in the same request context. A
            # separately issued GET without the entry headers returned HTTP 500.
            page = client.post(TICKETING, data=fields,
                               headers={"Origin": "https://kinepolis.es", "Referer": entry_url},
                               timeout=30, allow_redirects=True, max_redirects=3)
            location = urlsplit(page.url)
            if page.status_code != 200 or location.netloc != "tickets.kinepolis.es" or location.path != "/Booking/TicketSelection":
                raise AvailabilityError(f"Splau ticket selection failed for {session_id}: HTTP {page.status_code}")
            return parse_availability(page.text, session_id, datetime.now(timezone.utc))
    except requests.RequestsError:
        raise AvailabilityError("Splau availability network request failed") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id", action="append", required=True, help="Numeric Splau Vista session ID; repeat for multiple sessions")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if any(not re.fullmatch(r"\d+", value) for value in args.session_id):
        parser.error("--session-id must be numeric")
    try:
        rows = [fetch_availability(sid) for sid in dict.fromkeys(args.session_id)]
        atomic_write(args.output, {"provider": "kinepolis", "status": "ok", "sessions": rows})
    except ImportError:
        print("Install scripts/requirements-cinesa.txt for the shared HTTP client", file=sys.stderr)
        return 1
    except AvailabilityError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (KeyError, ValueError, TypeError, OSError):
        print("Splau availability schema or output failure; previous output preserved", file=sys.stderr)
        return 1
    print(json.dumps({"sessions": [{key: row[key] for key in ("provider_session_id", "room", "available_total")}
                                   for row in rows]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
