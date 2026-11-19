"""Read-only availability adapters for the local preview; no ticket selection."""

import ast
from collections import Counter
from datetime import datetime, timezone
import re

from cinesa_showtimes import CinesaClient, ChromeTransport, venue_for_cinema
from kinepolis_availability import fetch_availability as splau_availability


class ScreeningAvailabilityUnavailable(ValueError):
    """The verified screening explicitly has no public seat availability."""


def fetch_availability(row, *, client=None, layouts=None):
    provider = row["provider"]
    result = {"kind": "ordinary", "checked_at": datetime.now(timezone.utc).isoformat()}
    if provider == "cinesa":
        transport = None if client else ChromeTransport()
        try:
            venue = venue_for_cinema(row["cinema_id"])
            client = client or CinesaClient(transport, venue=venue)
            route = "/showtimes/" + row["provider_session_id"]
            availability = client.get(route + "/seat-availability")
            layouts = {} if layouts is None else layouts
            layout = layouts.get(row["provider_session_id"])
            if layout is None:
                layout = client.get(route + "/seat-layout")["seatLayout"]
            if layout["screenId"] != row["screen_id"]:
                raise ValueError("Wrong auditorium")
            seats = {seat["id"]: seat for area in layout["areas"] for line in area["rows"] for seat in line["seats"]}
            if any(seat["seatId"] not in seats for seat in availability["seatAvailabilities"]):
                layouts.pop(row["provider_session_id"], None)
                raise ValueError("Seat layout changed; refresh on the next run")
            counts = Counter(seats[seat["seatId"]]["type"] for seat in availability["seatAvailabilities"] if seat["status"] == "Available")
            result.update(available=counts["Normal"], wheelchair=counts["Wheelchair"], companion=counts["Companion"], is_sold_out=availability["isSoldOut"])
            layouts[row["provider_session_id"]] = layout
        finally:
            if transport:
                transport.close()
    elif provider in {"mooby", "verdi", "filmax"}:
        from curl_cffi import requests
        response = requests.get(row["booking_url"], impersonate="chrome", timeout=25)
        response.raise_for_status()
        def literal(name):
            match = re.search(r"var\s+" + name + r"\s*=\s*([^\r\n]+);", response.text)
            if not match:
                raise ValueError("Seat data missing")
            return ast.literal_eval(match[1])
        if str(literal("GlobalPerfID")) != row["id"].split(":")[-1]:
            raise ValueError("Wrong screening")
        if re.search(r"\bvar\s+GlobalUnallocatedPerformance\s*=\s*true\s*;", response.text):
            # Unnumbered admission supplies no seat map. This is not a zero
            # count or an outage affecting the provider's other performances.
            raise ScreeningAvailabilityUnavailable("Unallocated screening has no seat map")
        seats = [seat for line in literal("GlobalColumnData") for seat in line if seat[0] not in (-1, -2)]
        if any(seat[2] not in {"O", "X", "P"} for seat in seats):
            raise ValueError("Unknown seat status")
        allowed = {str(code) for code in literal("GlobalSeatTypeCodes")}
        result["available"] = sum(seat[2] == "O" and str(seat[4]) in allowed and not any(seat[i] for i in (8, 9, 10)) for seat in seats)
    elif provider == "kinepolis":
        data = splau_availability(row["provider_session_id"].split("-")[-1])
        if str(data["room"]) != str(row["room"]):
            raise ValueError("Wrong auditorium")
        result.update(kind="area_counts", available=data["available_total"], areas=data["areas"], checked_at=data["availability_fetched_at"])
    elif provider == "phenomena":
        from curl_cffi import requests
        response = requests.get("https://phenomena.luke-391.workers.dev/api/availability", params={"evento": row["film_id"]}, impersonate="chrome", timeout=25)
        response.raise_for_status()
        data = response.json()["sessions"][row["provider_session_id"]]
        result.update(kind="reported_total", available=data["available"], capacity=data["capacity"], purchase_open=data["purchase_open"], closed_reason=data.get("closed_reason"))
    else:
        raise NotImplementedError("Availability is not yet verified for this cinema")
    return result


class AvailabilityFetcher:
    """Reuse anonymous Cinesa clients within one run, never browser credentials."""

    def __init__(self):
        self.clients = {}
        self.layouts = {}

    def __enter__(self):
        return self

    def fetch(self, row):
        if row["provider"] != "cinesa":
            return fetch_availability(row)
        venue = venue_for_cinema(row["cinema_id"])
        if venue not in self.clients:
            transport = ChromeTransport()
            self.clients[venue] = CinesaClient(transport, venue=venue)
        return fetch_availability(row, client=self.clients[venue], layouts=self.layouts)

    def __exit__(self, *_):
        for client in self.clients.values():
            client.transport.close()


def fetch_phenomena_availability():
    """One read-only programme request covers all Phenomena sessions."""
    from curl_cffi import requests
    response = requests.get("https://phenomena.luke-391.workers.dev/api/availability-all",
                            impersonate="chrome", timeout=30)
    response.raise_for_status()
    events = response.json()["events"]
    checked_at = datetime.now(timezone.utc).isoformat()
    return {"phenomena:" + str(sid): {"kind": "reported_total", "checked_at": checked_at, **value}
            for sessions in events.values() for sid, value in sessions.items()}
