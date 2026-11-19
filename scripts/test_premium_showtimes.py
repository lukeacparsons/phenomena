"""Regression checks for the important false-positive and date-boundary cases."""

from copy import deepcopy
from datetime import datetime
import json
import unittest

from explore_premium_showtimes import (
    build_report, diagonal_mar_sessions, mooby_sessions, yelmo_sessions,
)

AS_OF = datetime.fromisoformat("2026-11-19T10:11:00+01:00")


def mooby_fixture():
    # Minimal shape and representative values observed in window.shops.
    event = {
        "imdbid": "tt34890576", "name": "Clayface", "locale_title": "Clayface (ATMOS) (VOSE)",
        "version": "VOSE ATMOS", "audio": "Dolby Atmos", "language": "Anglès",
        "subtitles_lang": "Español", "performances": [{
            "performance_code": "189683", "time": "20261119214000",
            "schedule_date": "20261119", "hall_code": "08", "data": {"available": False},
        }],
    }
    shop = {"id": 29, "name": "MOOBY BALMES", "code": "BAL-BALMES", "events": [event],
            "shop_url": "https://moobycinemas-balmes.admit-one.eu/?p=tickets&perfCode=%s&language=%s&theatre=%s"}
    aribau = {**deepcopy(shop), "id": 28, "code": "BAL-ARIBAU", "events": []}
    bosque = {**deepcopy(shop), "id": 27, "name": "MOOBY BOSQUE", "code": "BAL-BOSQUE", "events": [],
              "shop_url": "https://moobycinemas-bosque.admit-one.eu/?p=tickets&perfCode=%s&language=%s&theatre=%s"}
    return {"29": shop, "28": aribau, "27": bosque}


def mooby_html(shops):
    return "<script>window.shops = " + json.dumps(shops) + ";</script>"


def yelmo_fixture():
    session = {"VistaCinemaId": "1350", "ShowtimeId": "48239", "Time": "20:15",
               "TimeFilter": "/Date(1795140900000)/", "Screen": 1, "IsSpecialDate": False}
    variant = {"Name": "PREMIUM", "Language": "INGLÉS SUBTITULADO EN ESPAÑOL (VOSE)",
               "Showtimes": [session]}
    movie = {"Id": 7402, "Title": "Rocky (50 aniversario)", "Formats": [variant]}
    day = {"FilterDate": "/Date(1795068000000)/", "ShowtimeDate": "19 noviembre", "Movies": [movie]}
    return {"d": {"Cinemas": [{"Key": "westfield-la-maquinista", "VistaId": "1350",
                                "Name": "Westfield La Maquinista", "Dates": [day]}]}}


def yelmo_variant(payload):
    return payload["d"]["Cinemas"][0]["Dates"][0]["Movies"][0]["Formats"][0]


MALL = """
<select id="DiasCine"><option data-group="all">todas las peliculas</option>
<option data-group="19_11_2026">hoy</option><option data-group="20_11_2026">mañana</option></select>
<div class="gallery-item col-cartelera-desktop" id="clayface" data-groups='["19_11_2026","20_11_2026"]'>
  <h3 class="titol-peli">Clayface</h3><ul>
  <li class="horari-item vo-label isense-label">16:45 <span>(VOSE)</span> <span>(iSense)</span></li>
  <li class="horari-item isense-label">19:20 <span>(iSense)</span></li>
  <li class="horari-item vo-label">22:05 <span>(VOSE)</span></li></ul>
</div>
<div class="gallery-item col-cartelera-mobile" id="clayface2">
  <h3 class="titol-peli">Clayface</h3>
  <li class="horari-item vo-label isense-label">16:45 (VOSE) (iSense)</li>
</div>
"""


class PremiumShowtimeTests(unittest.TestCase):
    def test_mooby_posters_join_by_imdb_from_extra_venue_pages(self):
        html = mooby_html(mooby_fixture())
        extra = '<a class="event" x-ref="tt34890576"><img src="https://cms.elqueque.com/clayface.webp"></a>'
        wrong = '<a class="event" x-ref="tt00000000"><img src="https://cms.elqueque.com/wrong.webp"></a>'
        self.assertIsNone(mooby_sessions(html)[0]["poster_url"])
        self.assertEqual(mooby_sessions(html, [wrong, extra])[0]["poster_url"], "https://cms.elqueque.com/clayface.webp")

    def test_yelmo_poster_stays_with_its_exact_movie(self):
        payload = yelmo_fixture()
        movie = payload["d"]["Cinemas"][0]["Dates"][0]["Movies"][0]
        movie["Poster"] = "https://eu-static.yelmocines.es/rocky.jpg"
        self.assertEqual(yelmo_sessions(payload)[0][0]["poster_url"], movie["Poster"])

    def test_balmes_requires_room_audio_and_vose_together(self):
        shops = mooby_fixture()
        good = shops["29"]["events"][0]
        for field, value in [("audio", "DIGITAL"), ("version", "DOBLADA ESP ATMOS")]:
            bad = deepcopy(good)
            bad[field] = value
            shops["29"]["events"].append(bad)
        wrong_room = deepcopy(good)
        wrong_room["performances"][0]["hall_code"] = "07"
        shops["29"]["events"].append(wrong_room)
        bosque = deepcopy(shops["29"])
        bosque.update(id=27, code="BAL-BOSQUE")
        shops["27"] = bosque
        rows = mooby_sessions(mooby_html(shops))
        self.assertEqual([r["id"] for r in rows], ["mooby:29:189683"])
        self.assertEqual(rows[0]["availability"], "unknown")

    def test_aribau_requires_room_five_even_for_vose_films(self):
        shops = mooby_fixture()
        event = deepcopy(shops["29"]["events"][0])
        shops["29"]["events"] = []
        event.update(audio="Dolby Surround 5.1", version="VOSE")
        event["performances"][0]["hall_code"] = "05"
        shops["28"]["events"] = [event, deepcopy(event)]
        shops["28"]["events"][1]["performances"][0]["hall_code"] = "02"
        rows = mooby_sessions(mooby_html(shops))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["room"], "05")

    def test_missing_mooby_data_is_error(self):
        with self.assertRaises(ValueError):
            mooby_sessions("<h1>Just a moment...</h1>")

    def test_bosque_requires_vose_atmos_and_room_one_on_same_variant(self):
        shops = mooby_fixture()
        event = deepcopy(shops["29"]["events"][0])
        shops["29"]["events"] = []
        event.update(version="VOSE - INFINITY VISION - ATMOS", language="Hindi,")
        event["performances"][0].update(performance_code="141987", hall_code="01")
        shops["27"]["events"] = [event]
        # A title mentioning VOSE/ATMOS is not enough. An Atmos room may also
        # show dubbed films or original-language opera without an Atmos mix.
        for changes in [
            {"version": "DOBLADA ESP ATMOS"}, {"version": "VOSI ATMOS"},
            {"audio": "Dolby Surround 5.1"}, {"audio": "DIGITAL"},
        ]:
            invalid = deepcopy(event)
            invalid.update(changes)
            shops["27"]["events"].append(invalid)
        wrong_room = deepcopy(event)
        wrong_room["performances"][0]["hall_code"] = "02"
        shops["27"]["events"].append(wrong_room)
        rows = mooby_sessions(mooby_html(shops))
        self.assertEqual([row["id"] for row in rows], ["mooby:27:141987"])
        self.assertEqual((rows[0]["cinema_id"], rows[0]["room"], rows[0]["language"]),
                         ("mooby-bosque", "01", "Hindi,"))
        self.assertEqual(rows[0]["booking_url"],
                         "https://moobycinemas-bosque.admit-one.eu/?p=tickets&perfCode=141987&language=esp&theatre=27")
        report = build_report(mooby_html(shops), yelmo_fixture(), MALL, AS_OF)
        self.assertEqual(report["counts"]["mooby-bosque"], 1)

    def test_yelmo_does_not_combine_language_from_one_format_with_another(self):
        payload = yelmo_fixture()
        movie = payload["d"]["Cinemas"][0]["Dates"][0]["Movies"][0]
        vose_plain = deepcopy(movie["Formats"][0])
        vose_plain["Name"] = "2D"
        movie["Formats"][0]["Language"] = "ESPAÑOL"
        movie["Formats"].append(vose_plain)
        self.assertEqual(yelmo_sessions(payload)[0], [])

    def test_yelmo_accepts_all_vose_languages_and_premium_variants(self):
        for name in ["PREMIUM", "CA PREMIUM", "XE", "XE ATMOS", "ATMOS"]:
            with self.subTest(name=name):
                payload = yelmo_fixture()
                yelmo_variant(payload).update(Name=name, Language="JAPONÉS SUBTITULADO EN ESPAÑOL (VOSE)")
                self.assertEqual(len(yelmo_sessions(payload)[0]), 1)
        for language in ["COREANO SUBTITULADO EN INGLÉS (VOSI)", "INGLÉS", "ESPAÑOL"]:
            with self.subTest(language=language):
                payload = yelmo_fixture()
                yelmo_variant(payload)["Language"] = language
                self.assertEqual(yelmo_sessions(payload)[0], [])

    def test_yelmo_uses_display_time_without_seven_hour_shift(self):
        rows, warnings = yelmo_sessions(yelmo_fixture())
        self.assertEqual((rows[0]["date"], rows[0]["time"]), ("2026-11-19", "20:15"))
        self.assertEqual(warnings, [])

    def test_yelmo_unverified_dst_and_midnight_are_reported(self):
        for changes in [{"IsSpecialDate": True}, {"Time": "00:15"}]:
            payload = yelmo_fixture()
            yelmo_variant(payload)["Showtimes"][0].update(changes)
            rows, warnings = yelmo_sessions(payload)
            self.assertEqual(rows, [])
            self.assertEqual(len(warnings), 1)

    def test_yelmo_cinema_mismatch_is_error(self):
        payload = yelmo_fixture()
        yelmo_variant(payload)["Showtimes"][0]["VistaCinemaId"] = "814"
        with self.assertRaises(ValueError):
            yelmo_sessions(payload)

    def test_mall_matches_one_slot_without_mobile_duplicates_or_date_expansion(self):
        rows = diagonal_mar_sessions(MALL, AS_OF)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["date"], rows[0]["time"], rows[0]["format"]),
                         ("2026-11-19", "16:45", "iSense"))
        self.assertEqual(rows[0]["booking_scope"], "cinema")

    def test_mall_stale_date_is_error(self):
        with self.assertRaises(ValueError):
            diagonal_mar_sessions(MALL, datetime.fromisoformat("2026-11-20T12:00:00+01:00"))

    def test_past_sessions_are_removed_in_madrid_time(self):
        as_of = datetime.fromisoformat("2026-11-19T20:00:00+01:00")
        report = build_report(mooby_html(mooby_fixture()), yelmo_fixture(), MALL, as_of)
        self.assertEqual(report["counts"]["cinesa-diagonal-mar"], 0)
        self.assertEqual(report["past_sessions_excluded"], 1)
        self.assertEqual(report["counts"]["yelmo-maquinista"], 1)


if __name__ == "__main__":
    unittest.main()
