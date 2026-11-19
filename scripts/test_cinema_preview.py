"""Cross-source identity, timezone ordering and honest availability semantics."""

from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from build_cinema_preview import assemble, film_key, formats, phenomena_sessions
from premium_availability import fetch_availability, ScreeningAvailabilityUnavailable

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)


def row(sid, start, **extra):
    return {"id": sid, "provider": "cinesa", "provider_session_id": sid.split(":")[-1],
            "cinema_id": "cinesa-diagonal-mar", "film_id": "HO00003679", "title": "Dune: Parte Tres",
            "starts_at": start, "date": "2026-12-15", "time": "19:00", "room": "09", "format": "IMAX",
            "version": "VOSE", "poster_url": "https://vwc.cinesa.es/poster", **extra}


class PreviewTests(unittest.TestCase):
    def test_same_film_joins_but_original_dune_and_double_bills_stay_distinct(self):
        movie = row("cinesa:032-1", "2026-12-15T19:00:00+01:00")
        self.assertEqual(film_key(movie), film_key({**movie, "provider": "phenomena", "film_id": "2988"}))
        self.assertNotEqual(film_key(movie), film_key({**movie, "provider": "phenomena", "film_id": "3045"}))
        self.assertNotEqual(film_key(movie), film_key({**movie, "provider": "phenomena", "film_id": "2387"}))

    def test_offsets_sort_by_instant_and_format_stays_on_its_session(self):
        late = row("kinepolis:PFULL-1", "2026-12-15T18:20:00+00:00", provider="kinepolis", film_id="HO00006684",
                   imdb_id="tt31378509", cinema_id="kinepolis-splau", room="11", time="19:20", format="Laser ULTRA")
        early = row("cinesa:032-1", "2026-12-15T19:00:00+01:00")
        data = assemble([{"sessions": [late, early]}], {"assets": []}, NOW)
        self.assertEqual(len(data["films"]), 1)
        sessions = data["films"][0]["sessions"]
        self.assertEqual([s["id"] for s in sessions], [early["id"], late["id"]])
        self.assertEqual([s["formats"] for s in sessions], [["IMAX"], ["Laser ULTRA"]])
        self.assertEqual(sessions[0]["room"], "9")
        self.assertNotIn("seat_data", sessions[0])

    def test_wild_horse_nine_joins_across_all_sources_without_losing_sessions(self):
        rows = [row("cinesa:032-1", "2026-11-20T19:00:00+01:00", film_id="HO00003865", title="Wild Horse Nine"),
                row("mooby:29:2", "2026-11-20T20:00:00+01:00", provider="mooby", film_id="tt15799564", title="Wild Horse Nine"),
                row("phenomena:3", "2026-11-21T19:00:00+01:00", provider="phenomena", film_id="3021", title="WILD HORSE NINE"),
                row("yelmo:1350:4", "2026-11-22T19:00:00+01:00", provider="yelmo", film_id="7211", title="Wild Horse Nine"),
                row("kinepolis:PFULL-5", "2026-11-23T19:00:00+01:00", provider="kinepolis", film_id="HO00006764", imdb_id="tt15799564", title="VOSE Wild Horse Nine")]
        result = assemble([{"sessions": rows}], {"assets": []}, NOW)
        self.assertEqual(len(result["films"]), 1)
        self.assertEqual({s["id"] for s in result["films"][0]["sessions"]}, {s["id"] for s in rows})

    def test_dune_remakes_are_named_distinctly_and_not_merged(self):
        original = row("phenomena:1", "2026-11-20T19:00:00+01:00", provider="phenomena", film_id="3045", title="Dune")
        remake = row("phenomena:2", "2026-11-21T19:00:00+01:00", provider="phenomena", film_id="106", title="Dune")
        result = assemble([{"sessions": [original, remake]}], {"assets": []}, NOW)
        self.assertEqual([f["title"] for f in result["films"]], ["Dune (1984)", "Dune (2021)"])

    def test_largest_verified_poster_is_selected_for_the_same_film_only(self):
        first = row("cinesa:032-1", "2026-12-15T19:00:00+01:00")
        second = {**first, "id": "cinesa:032-2", "poster_url": "https://vwc.cinesa.es/large"}
        assets = [{"url": first["poster_url"], "width": 200, "height": 300, "filename": "small.jpg", "status": "ok"},
                  {"url": second["poster_url"], "width": 1000, "height": 1500, "filename": "large.jpg", "status": "ok"}]
        film = assemble([{"sessions": [first, second]}], {"assets": assets}, NOW)["films"][0]
        self.assertEqual(film["poster_url"], "/preview-data/posters/large.jpg")
        self.assertEqual(len(film["sessions"]), 2)

    def test_past_sessions_are_removed_and_duplicate_ids_fail(self):
        past = row("cinesa:032-1", "2026-11-18T19:00:00+01:00")
        self.assertEqual(assemble([{"sessions": [past]}], {"assets": []}, NOW)["session_count"], 0)
        future = row("cinesa:032-2", "2026-12-15T19:00:00+01:00")
        with self.assertRaises(ValueError):
            assemble([{"sessions": [future, future]}], {"assets": []}, NOW)

    def test_phenomena_closed_booking_is_not_invented_sold_out(self):
        payload = {"_meta": {"scraped_at": NOW.isoformat()}, "events": [{"evento_id": "415", "name": "Film (Proyección en 4K y VOSE)",
            "sessions": [{"session_id": "1", "date": "20/11/2026", "time": "19:00", "purchase_open": False, "available": 200}]}]}
        result = phenomena_sessions(payload)[0]
        self.assertEqual((result["date"], result["version"], result["title"]), ("2026-11-20", "VOSE", "Film"))
        self.assertFalse(result["seat_data"]["purchase_open"])
        self.assertNotIn("is_sold_out", result["seat_data"])

    def test_yelmo_seat_check_is_explicitly_unsupported(self):
        with self.assertRaises(NotImplementedError):
            fetch_availability({"provider": "yelmo"})

    @patch('curl_cffi.requests.get')
    def test_unallocated_requires_explicit_flag_and_matching_screening(self, get):
        row = {'id': 'verdi:46:123', 'provider': 'verdi', 'booking_url': 'https://tickets.example/123'}
        response = get.return_value
        response.text = 'var GlobalPerfID = 123;\nvar GlobalUnallocatedPerformance = true;'
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            fetch_availability(row)
        for html in ['var GlobalPerfID = 124;\nvar GlobalUnallocatedPerformance = true;',
                     'var GlobalUnallocatedPerformance = true;',
                     'var GlobalPerfID = 123;\nvar GlobalUnallocatedPerformance = false;',
                     'var GlobalPerfID = 123;']:
            response.text = html
            with self.subTest(html=html), self.assertRaises(ValueError) as caught:
                fetch_availability(row)
            self.assertNotIsInstance(caught.exception, ScreeningAvailabilityUnavailable)

    @patch('curl_cffi.requests.get')
    def test_allocated_seat_map_still_counts_available_ordinary_seats(self, get):
        get.return_value.text = ('var GlobalPerfID = 123;\nvar GlobalUnallocatedPerformance = false;\n'
            'var GlobalSeatTypeCodes = [1];\n'
            'var GlobalColumnData = [[[1, 1, "O", 0, 1, 0, 0, 0, 0, 0, 0], '
            '[2, 1, "X", 0, 1, 0, 0, 0, 0, 0, 0]]];')
        result = fetch_availability({'id': 'verdi:46:123', 'provider': 'verdi',
                                     'booking_url': 'https://tickets.example/123'})
        self.assertEqual(result['available'], 1)

    @patch("premium_availability.ChromeTransport")
    @patch("premium_availability.CinesaClient")
    def test_cinesa_accessible_places_are_not_counted_as_ordinary(self, client, transport):
        client.return_value.get.side_effect = [
            {"isSoldOut": False, "seatAvailabilities": [{"seatId": "one", "status": "Sold"}, {"seatId": "two", "status": "Available"}]},
            {"seatLayout": {"screenId": "032-9", "areas": [{"rows": [{"seats": [{"id": "one", "type": "Normal"}, {"id": "two", "type": "Wheelchair"}]}]}]}},
        ]
        result = fetch_availability({"provider": "cinesa", "cinema_id": "cinesa-diagonal-mar", "provider_session_id": "032-1", "screen_id": "032-9"})
        self.assertEqual((result["available"], result["wheelchair"], result["is_sold_out"]), (0, 1, False))


if __name__ == "__main__":
    unittest.main()
