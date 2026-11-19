"""Checks for session-level language/format and overlapping programme data."""

from copy import deepcopy
from datetime import date, datetime
import json
import unittest

from kinepolis_showtimes import build_report, programme_from_html, splau_sessions


def fixture():
    film = {"id": "film-original", "title": "VOSE Film", "audioLanguage": "FR", "originalAudioLanguage": "FR",
            "spokenLanguage": {"code": "French"}, "subtitles": [{"id": "20", "code": "Span Subt"}]}
    session = {"complexOperator": "PFULL", "mainComplex": "PFULL", "id": "PFULL-123", "vistaSessionId": 123,
               "showtime": "2026-12-15T18:20:00+00:00", "businessDay": "2026-12-15T05:00:00+00:00", "hall": 11,
               "rawSessionAttributes": "2D,French,es,LASERULTRA", "film": {"id": "film-original"},
               "sessionSubtitles": [{"id": "20"}], "isSoldOut": False, "isPublicScreening": True}
    programme = {"films": [film], "sessions": [session]}
    return {"complexes": [{"complexCode": "PFULL", "name": "Kinépolis Barcelona Splau",
                           "isActive": True, "inMaintenance": False}],
            "current_movies": programme, "future_movies": deepcopy(programme)}


class KinepolisTests(unittest.TestCase):
    def test_poster_uses_exact_variant_and_excludes_backdrop_and_thumbnail_policy(self):
        payload = fixture()
        payload["movieservice_image_url"] = "https://cdn.kinepolis.es/"
        for section in ("current_movies", "future_movies"):
            payload[section]["films"][0]["images"] = [
                {"mediaType": "Backdrop", "url": "/ES/wide.jpg"},
                {"mediaType": "Poster Graphic", "url": "/ES/VOSE Film.jpg"},
            ]
        row, = splau_sessions(payload)[0]
        self.assertEqual(row["poster_url"], "https://cdn.kinepolis.es/images/ES/VOSE%20Film.jpg")

    def test_original_language_laser_ultra_and_duplicate_programmes(self):
        rows, observed = splau_sessions(fixture())
        self.assertEqual((len(rows), len(observed)), (1, 1))
        row = rows[0]
        self.assertEqual((row["language"], row["format"], row["time"], row["room"]), ("FR", "Laser ULTRA", "19:20", "11"))
        self.assertEqual(row["booking_url"], "https://kinepolis.es/direct-vista-redirect/123/0/PFULL/0")

    def test_atmos_outside_laser_rooms_qualifies(self):
        payload = fixture()
        for section in ["current_movies", "future_movies"]:
            payload[section]["sessions"][0].update(hall=16, rawSessionAttributes="2D,Atmos,French,es")
        row, = splau_sessions(payload)[0]
        self.assertEqual((row["format"], row["room"]), ("Dolby Atmos", "16"))

    def test_vose_and_format_do_not_cross_between_sessions_or_cinemas(self):
        payload = fixture()
        for section in ["current_movies", "future_movies"]:
            session = payload[section]["sessions"][0]
            session["rawSessionAttributes"] = "2D,French,es"
            other = deepcopy(session)
            other.update(id="PFULL-124", vistaSessionId=124, rawSessionAttributes="2D,French,en,LASERULTRA")
            payload[section]["sessions"].append(other)
            different_cinema = deepcopy(fixture()[section]["sessions"][0])
            different_cinema["complexOperator"] = "KMAD"
            payload[section]["sessions"].append(different_cinema)
        self.assertEqual(splau_sessions(payload)[0], [])

    def test_dubbed_audio_does_not_qualify_even_if_title_says_vose(self):
        payload = fixture()
        for section in ["current_movies", "future_movies"]:
            payload[section]["films"][0]["audioLanguage"] = "ES"
        self.assertEqual(splau_sessions(payload)[0], [])

    def test_conflicting_duplicate_or_missing_subtitle_proof_fails(self):
        for change in ["duplicate", "subtitles"]:
            payload = fixture()
            if change == "duplicate":
                payload["future_movies"]["sessions"][0]["hall"] = 12
            else:
                payload["current_movies"]["sessions"][0]["sessionSubtitles"] = [{"id": "not-spanish"}]
            with self.subTest(change=change), self.assertRaises(ValueError):
                splau_sessions(payload)

    def test_legacy_empty_page_is_failure_but_no_matching_week_is_valid(self):
        with self.assertRaises(ValueError):
            programme_from_html('<script>jQuery.extend(Drupal.settings, {"kinepolis_movie_filter":{"list":null}});</script>')
        html = '<script>jQuery.extend(Drupal.settings, ' + json.dumps({"variables": fixture()}) + ');</script>'
        report = build_report(html, date(2026, 11, 19), 7, datetime.fromisoformat("2026-11-19T12:00:00+01:00"))
        self.assertEqual(report["count"], 0)
        self.assertEqual(report["coverage"]["published_dates"], ["2026-12-15"])
        self.assertEqual(report["coverage"]["mode"], "date_window")
        self.assertTrue(report["coverage"]["truncated_by_window"])
        self.assertEqual(report["coverage"]["published_dates_beyond_window"], ["2026-12-15"])
        self.assertIsNone(report["coverage"]["latest_qualifying_date"])

    def test_all_published_keeps_distant_presales_and_excludes_past_sessions(self):
        payload = fixture()
        current = payload["current_movies"]["sessions"][0]
        current.update(showtime="2026-11-19T08:00:00+00:00", businessDay="2026-11-19T05:00:00+00:00")
        future = payload["future_movies"]["sessions"][0]
        future.update(id="PFULL-124", vistaSessionId=124, showtime="2027-06-05T18:00:00+00:00",
                      businessDay="2027-06-05T05:00:00+00:00")
        nonmatching = deepcopy(future)
        nonmatching.update(id="PFULL-125", vistaSessionId=125, rawSessionAttributes="2D,French,es",
                           showtime="2027-06-06T18:00:00+00:00", businessDay="2027-06-06T05:00:00+00:00")
        payload["future_movies"]["sessions"].append(nonmatching)
        html = '<script>jQuery.extend(Drupal.settings, ' + json.dumps({"variables": payload}) + ');</script>'
        report = build_report(html, date(2026, 11, 19), None, datetime.fromisoformat("2026-11-19T12:00:00+01:00"))
        self.assertEqual([row["provider_session_id"] for row in report["sessions"]], ["PFULL-124"])
        coverage = report["coverage"]
        self.assertEqual(coverage["mode"], "all_published")
        self.assertIsNone(coverage["requested_end"])
        self.assertFalse(coverage["truncated_by_window"])
        self.assertEqual(coverage["latest_published_date"], "2027-06-06")
        self.assertEqual(coverage["latest_qualifying_date"], "2027-06-05")

    def test_empty_programme_has_unknown_horizons(self):
        payload = fixture()
        for section in ("current_movies", "future_movies"):
            payload[section]["sessions"] = []
        html = '<script>jQuery.extend(Drupal.settings, ' + json.dumps({"variables": payload}) + ');</script>'
        report = build_report(html, date(2026, 11, 19), None, datetime.fromisoformat("2026-11-19T12:00:00+01:00"))
        self.assertEqual(report["sessions"], [])
        self.assertIsNone(report["coverage"]["latest_published_date"])
        self.assertIsNone(report["coverage"]["latest_qualifying_date"])
        self.assertFalse(report["coverage"]["truncated_by_window"])


if __name__ == "__main__":
    unittest.main()
