"""Token lifecycle, credential containment, and session qualification checks."""

import base64
from copy import deepcopy
from datetime import date, datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from cinesa_showtimes import (
    API_BASE, BOOTSTRAP, CinesaClient, SourceError, atomic_write,
    cinesa_sessions, collect, published_dates,
)


def dummy_token(expiry):
    claims = base64.urlsafe_b64encode(json.dumps({"exp": expiry}).encode()).decode().rstrip("=")
    return "test." + claims + ".not-a-real-signature"


class Response:
    def __init__(self, status=200, data=None, content_type="application/json", headers=None):
        self.status_code, self.data = status, data
        self.headers = {"content-type": content_type, **(headers or {})}

    def json(self):
        return self.data


def config(expiry=2000, api_url=API_BASE):
    return Response(data={"api": {"apiUrl": api_url, "authToken": dummy_token(expiry),
                                  "vistaCdn": "https://vwc.cinesa.es/CDN"}})


class Transport:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def get(self, url, headers):
        self.calls.append((url, headers))
        return self.responses.pop(0)


def fixture():
    return {
        "businessDate": "2026-11-20",
        "relatedData": {
            "attributes": [{"id": key, "name": {"text": name}} for key, name in
                           [("vose", "Vose"), ("imax", "IMAX"), ("isense", "iSense"), ("vo", "VO")]],
            "films": [{"id": "film", "title": {"text": "Original-language film"}}],
            # Intentionally different suffix and display number.
            "screens": [{"id": "032-12", "name": {"text": "Sala 11"}}],
        },
        "showtimes": [{"id": "032-60528", "siteId": "032", "filmId": "film", "screenId": "032-12",
                       "attributeIds": ["imax", "vose"], "isSoldOut": False,
                       "schedule": {"businessDate": "2026-11-20", "startsAt": "2026-11-20T21:45:00+01:00",
                                    "filmStartsAt": "2026-11-20T22:05:00+01:00"}}],
    }


class TokenTests(unittest.TestCase):
    def test_cold_boot_uses_public_config_and_keeps_token_in_headers_only(self):
        transport = Transport(config(), Response(data={"ok": True}), Response(data={"ok": True}))
        client = CinesaClient(transport, clock=lambda: 1000)
        self.assertEqual(client.get("/film-screening-dates"), {"ok": True})
        client.get("/film-screening-dates")
        self.assertEqual(client.bootstrap_count, 1)
        self.assertEqual(transport.calls[0], (BOOTSTRAP, {"Accept": "application/json"}))
        self.assertEqual(transport.calls[1][1]["Authorization"], "Bearer " + dummy_token(2000))
        self.assertNotIn(dummy_token(2000), transport.calls[1][0])

    def test_near_expiry_refreshes_before_next_request(self):
        now = [1000]
        transport = Transport(config(), Response(data={}), config(4000), Response(data={}))
        client = CinesaClient(transport, clock=lambda: now[0])
        client.get("/film-screening-dates")
        now[0] = 1950
        client.get("/film-screening-dates")
        self.assertEqual(client.bootstrap_count, 2)
        self.assertEqual(transport.calls[-1][1]["Authorization"], "Bearer " + dummy_token(4000))
        self.assertNotIn("Authorization", transport.calls[2][1])

    def test_401_bootstraps_and_retries_once(self):
        transport = Transport(config(), Response(401), config(4000), Response(data={"ok": True}))
        client = CinesaClient(transport, clock=lambda: 1000)
        self.assertEqual(client.get("/film-screening-dates"), {"ok": True})
        self.assertEqual(client.bootstrap_count, 2)
        self.assertEqual(transport.calls[-1][1]["Authorization"], "Bearer " + dummy_token(4000))

    def test_persistent_401_is_bounded(self):
        transport = Transport(config(), Response(401), config(), Response(401))
        with self.assertRaisesRegex(SourceError, "HTTP 401"):
            CinesaClient(transport, clock=lambda: 1000).get("/film-screening-dates")
        self.assertEqual(len(transport.calls), 4)

    def test_rejects_expired_or_redirected_config_without_sending_token(self):
        for response in [config(900), config(api_url="https://example.org"), Response(302)]:
            transport = Transport(response)
            with self.subTest(response=response), self.assertRaises(SourceError):
                CinesaClient(transport, clock=lambda: 1000).get("/film-screening-dates")
            self.assertEqual(len(transport.calls), 1)

    def test_challenge_is_a_failure_with_no_response_body_or_retry_loop(self):
        for response in [Response(403, data="private body"), Response(data="private body", content_type="text/html")]:
            transport = Transport(response)
            with self.assertRaises(SourceError) as caught:
                CinesaClient(transport).get("/film-screening-dates")
            self.assertNotIn("private body", str(caught.exception))
            self.assertEqual(len(transport.calls), 1)

    def test_transient_retry_respects_retry_after(self):
        pauses = []
        transport = Transport(Response(429, headers={"retry-after": "2"}), config(), Response(data={}))
        CinesaClient(transport, clock=lambda: 1000, sleep=pauses.append).get("/film-screening-dates")
        self.assertEqual(pauses, [2])
        transport = Transport(Response(429, headers={"retry-after": "300"}))
        with self.assertRaisesRegex(SourceError, "HTTP 429"):
            CinesaClient(transport, sleep=pauses.append).get("/film-screening-dates")
        self.assertEqual(pauses, [2])


class SessionTests(unittest.TestCase):
    def test_public_poster_uses_film_id_without_token_or_resize(self):
        row, = cinesa_sessions(fixture(), date(2026, 11, 20))
        self.assertEqual(row["poster_url"], "https://vwc.cinesa.es/CDN/media/entity/get/FilmPosterGraphic/film")
        row, = cinesa_sessions(fixture(), date(2026, 11, 20), poster_base=None)
        self.assertIsNone(row["poster_url"])

    def test_la_farga_accepts_vose_without_imax_or_isense(self):
        payload = fixture()
        payload["showtimes"][0].update(id="010-39274", siteId="010", screenId="010-2", attributeIds=["vose"])
        payload["relatedData"]["screens"] = [{"id": "010-2", "name": {"text": "Sala 2"}}]
        row, = cinesa_sessions(payload, date(2026, 11, 20), "la-farga")
        self.assertEqual((row["cinema_id"], row["venue_experience"], row["format"]),
                         ("cinesa-la-farga", "LUXE", None))
        self.assertTrue(row["booking_url"].endswith("showtimeId=010-39274"))
        payload["showtimes"][0]["attributeIds"] = ["vo"]
        self.assertEqual(cinesa_sessions(payload, date(2026, 11, 20), "la-farga"), [])
        with self.assertRaises(SourceError):
            cinesa_sessions(payload, date(2026, 11, 20))

    def test_la_farga_requests_and_date_discovery_use_its_own_site(self):
        data = {"filmScreeningDates": [
            {"businessDate": "2026-11-20", "filmScreenings": [{"sites": [{"siteId": "010"}]}]},
            {"businessDate": "2026-11-21", "filmScreenings": [{"sites": [{"siteId": "032"}]}]},
        ]}
        transport = Transport(config(), Response(data=data))
        client = CinesaClient(transport, clock=lambda: 1000, venue="la-farga")
        self.assertEqual(published_dates(client.get("/film-screening-dates"), "010"), [date(2026, 11, 20)])
        self.assertTrue(transport.calls[-1][0].endswith("?siteIds=010"))

    def test_vose_and_premium_must_belong_to_same_time(self):
        payload = fixture()
        payload["showtimes"][0]["attributeIds"] = ["vose"]
        other = deepcopy(payload["showtimes"][0])
        other.update(id="032-2", attributeIds=["imax", "vo"])
        payload["showtimes"].append(other)
        self.assertEqual(cinesa_sessions(payload, date(2026, 11, 20)), [])

    def test_both_formats_and_original_language_unknown(self):
        for format_id, label in [("imax", "IMAX"), ("isense", "iSense")]:
            payload = fixture()
            payload["showtimes"][0]["attributeIds"] = [format_id, "vose"]
            row, = cinesa_sessions(payload, date(2026, 11, 20))
            self.assertEqual((row["format"], row["language"], row["subtitles"]), (label, None, "Español"))
            self.assertEqual((row["room"], row["room_name"]), ("11", "Sala 11"))
            self.assertTrue(row["booking_url"].endswith("showtimeId=032-60528"))

    def test_wrong_date_venue_or_missing_attribute_is_failure(self):
        for change in ["date", "venue", "attribute"]:
            payload = fixture()
            if change == "date":
                payload["businessDate"] = "2026-11-21"
            elif change == "venue":
                payload["showtimes"][0]["siteId"] = "other"
            else:
                payload["showtimes"][0]["attributeIds"].append("missing")
            with self.subTest(change=change), self.assertRaises((SourceError, KeyError)):
                cinesa_sessions(payload, date(2026, 11, 20))

    def test_public_room_number_can_have_a_format_suffix(self):
        for label, number in [("Sala 9 Imax", "9"), ("Sala 10  iSense", "10")]:
            payload = fixture()
            payload["relatedData"]["screens"][0]["name"]["text"] = label
            row, = cinesa_sessions(payload, date(2026, 11, 20))
            self.assertEqual((row["room"], row["room_name"]), (number, label))

    def test_calendar_date_comes_from_offset_timestamp_not_business_date(self):
        payload = fixture()
        payload["showtimes"][0]["schedule"]["startsAt"] = "2026-11-21T00:15:00+01:00"
        payload["showtimes"][0]["isSoldOut"] = True
        row, = cinesa_sessions(payload, date(2026, 11, 20))
        self.assertEqual((row["date"], row["time"], row["business_date"]), ("2026-11-21", "00:15", "2026-11-20"))
        self.assertEqual(row["availability"], "sold_out")

    def test_collection_reports_coverage_and_removes_past_sessions(self):
        dates = {"filmScreeningDates": [
            {"businessDate": day, "filmScreenings": [{"sites": [{"siteId": site}]}]}
            for day, site in [("2026-11-20", "032"), ("2026-11-22", "other"), ("2026-12-20", "032")]
        ]}
        self.assertEqual(published_dates(dates), [date(2026, 11, 20), date(2026, 12, 20)])
        transport = Transport(config(), Response(data=dates), Response(data=fixture()))
        report = collect(CinesaClient(transport, clock=lambda: 1000), date(2026, 11, 20), 7,
                         datetime(2026, 11, 21, tzinfo=timezone.utc))
        self.assertEqual(report["coverage"]["fetched_dates"], ["2026-11-20"])
        self.assertEqual((report["count"], report["past_matches_excluded"]), (0, 1))
        self.assertEqual(report["coverage"]["mode"], "date_window")
        self.assertTrue(report["coverage"]["truncated_by_window"])
        self.assertEqual(report["coverage"]["published_dates_beyond_window"], ["2026-12-20"])
        self.assertEqual(report["coverage"]["latest_published_date"], "2026-12-20")
        self.assertIsNone(report["coverage"]["latest_qualifying_date"])

    def test_all_published_includes_distant_presales_and_separates_nonmatching_dates(self):
        days = ["2026-11-20", "2027-06-05", "2027-06-06"]
        dates = {"filmScreeningDates": [
            {"businessDate": day, "filmScreenings": [{"sites": [{"siteId": "032"}]}]} for day in days
        ]}
        responses = []
        for index, day in enumerate(days):
            payload = fixture()
            payload["businessDate"] = day
            session = payload["showtimes"][0]
            session["id"] = f"032-{index}"
            session["schedule"].update(businessDate=day, startsAt=day + "T21:45:00+02:00")
            if index == 2:
                session["attributeIds"] = ["imax"]  # Last published date has no VOSE.
            responses.append(Response(data=payload))
        transport = Transport(config(), Response(data=dates), *responses)
        report = collect(CinesaClient(transport, clock=lambda: 1000), date(2026, 11, 20), None,
                         datetime(2026, 11, 20, tzinfo=timezone.utc))
        self.assertEqual([row["date"] for row in report["sessions"]], days[:2])
        coverage = report["coverage"]
        self.assertEqual(coverage["fetched_dates"], days)
        self.assertEqual(coverage["mode"], "all_published")
        self.assertIsNone(coverage["requested_end"])
        self.assertFalse(coverage["truncated_by_window"])
        self.assertEqual(coverage["latest_published_date"], "2027-06-06")
        self.assertEqual(coverage["latest_qualifying_date"], "2027-06-05")

    def test_no_published_dates_is_a_valid_empty_snapshot(self):
        transport = Transport(config(), Response(data={"filmScreeningDates": []}))
        report = collect(CinesaClient(transport, clock=lambda: 1000), date(2026, 11, 20), None,
                         datetime(2026, 11, 20, tzinfo=timezone.utc))
        self.assertEqual(report["sessions"], [])
        self.assertIsNone(report["coverage"]["latest_published_date"])
        self.assertIsNone(report["coverage"]["latest_qualifying_date"])
        self.assertFalse(report["coverage"]["truncated_by_window"])

    def test_failed_serialization_keeps_last_good_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "schedule.json"
            path.write_text('{"old": true}')
            with self.assertRaises(TypeError):
                atomic_write(path, {"unserializable": object()})
            self.assertEqual(json.loads(path.read_text()), {"old": True})
            self.assertEqual(len(list(Path(directory).iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
