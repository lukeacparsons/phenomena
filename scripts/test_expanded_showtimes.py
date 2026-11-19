"""All-room collection preserves VOSE and the original premium subset."""

from copy import deepcopy
from datetime import date
import unittest

from build_cinema_preview import phenomena_sessions
from cinesa_showtimes import cinesa_sessions
from explore_premium_showtimes import mooby_sessions, yelmo_sessions
from kinepolis_showtimes import splau_sessions
from test_cinesa_showtimes import fixture as cinesa_fixture
from test_kinepolis_showtimes import fixture as splau_fixture
from test_premium_showtimes import mooby_fixture, mooby_html, yelmo_fixture


class ExpandedTests(unittest.TestCase):
    def test_mooby_all_rooms_keeps_original_selection_flag_and_excludes_dubbed(self):
        shops = mooby_fixture()
        ordinary = deepcopy(shops["29"]["events"][0])
        ordinary.update(audio="Dolby Surround 5.1", version="VOSE")
        ordinary["performances"][0].update(hall_code="02", performance_code="2")
        dubbed = deepcopy(ordinary)
        dubbed["version"] = "DOBLADA"
        shops["29"]["events"] += [ordinary, dubbed]
        rows = mooby_sessions(mooby_html(shops), premium_only=False)
        self.assertEqual([(r["room"], r["big_screen"]) for r in rows], [("08", True), ("02", False)])

    def test_yelmo_plain_vose_is_included_without_borrowing_premium_label(self):
        payload = yelmo_fixture()
        movie = payload["d"]["Cinemas"][0]["Dates"][0]["Movies"][0]
        plain = deepcopy(movie["Formats"][0])
        plain["Name"] = "2D"
        movie["Formats"][0]["Language"] = "ESPAÑOL"
        movie["Formats"].append(plain)
        rows, warnings = yelmo_sessions(payload, premium_only=False)
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["big_screen"])
        self.assertFalse(warnings)

    def test_cinesa_all_rooms_does_not_admit_plain_vo_or_dubbed(self):
        payload = cinesa_fixture()
        for attributes in [["vose"], ["vo"], ["imax"]]:
            row = deepcopy(payload["showtimes"][0])
            row.update(id="032-" + str(len(payload["showtimes"])), attributeIds=attributes)
            payload["showtimes"].append(row)
        rows = cinesa_sessions(payload, date(2026, 11, 20), premium_only=False)
        self.assertEqual([r["big_screen"] for r in rows], [True, False])

    def test_splau_all_rooms_retains_exact_audio_and_subtitle_checks(self):
        payload = splau_fixture()
        for section in ["current_movies", "future_movies"]:
            row = deepcopy(payload[section]["sessions"][0])
            row.update(id="PFULL-124", vistaSessionId=124, hall=4, rawSessionAttributes="2D,French,es")
            payload[section]["sessions"].append(row)
        rows, _ = splau_sessions(payload, premium_only=False)
        self.assertEqual([r["big_screen"] for r in rows], [True, False])
        for section in ["current_movies", "future_movies"]:
            payload[section]["films"][0]["audioLanguage"] = "ES"
        self.assertEqual(splau_sessions(payload, premium_only=False)[0], [])

    def test_splau_empty_optional_spoken_metadata_retains_explicit_language_proof(self):
        payload = splau_fixture()
        for section in ["current_movies", "future_movies"]:
            payload[section]["films"][0]["spokenLanguage"] = []
        self.assertEqual(len(splau_sessions(payload, premium_only=False)[0]), 1)

    def test_phenomena_vose_only_does_not_infer_from_film_title(self):
        session = {"session_id": "1", "date": "20/11/2026", "time": "19:00"}
        payload = {"events": [{"evento_id": "1", "name": "Film (VOSI)", "sessions": [session]},
                              {"evento_id": "2", "name": "Film", "sessions": [session]},
                              {"evento_id": "3", "name": "Film (VOSE)", "sessions": [session]}]}
        rows = phenomena_sessions(payload, vose_only=True)
        self.assertEqual([row["film_id"] for row in rows], ["3"])


if __name__ == "__main__":
    unittest.main()
