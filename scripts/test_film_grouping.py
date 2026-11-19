"""Regression cases for cross-cinema cards, remakes and preserved bookings."""

import copy
import unittest

from film_grouping import deduplicate_programme
from poster_fallbacks import identity


def film(fid, title, sid, **extra):
    return {"id": fid, "title": title, "titles": [title], "sessions": [{"id": sid,
            "provider": fid.split(":")[0], "film_id": fid.split(":", 1)[-1],
            "starts_at": "2026-11-20T19:00:00+01:00", "cinema_id": sid,
            "booking_url": "https://cinema.example/" + sid, "formats": ["IMAX"],
            "seat_data": {"available": 20}}], **extra}


class FilmGroupingTests(unittest.TestCase):
    def group(self, films, reviewed=None):
        data = {"films": films}
        deduplicate_programme(data, reviewed=reviewed or {})
        return data

    def test_la_bola_negra_has_one_card_with_all_bookings_and_best_poster(self):
        main = film("imdb:tt35511966", "La bola negra", "mooby:1", original_title="La bola negra",
                    english_title="The Black Ball", title_provenance={"source_url": "https://cinema.example/title"},
                    runtime_minutes=159, details={"directors": ["Javier Ambrossi", "Javier Calvo"]},
                    poster_url="large.jpg", poster_width=1000, poster_height=1500)
        duplicate = film("renoir:la-bola-negra", "LA BOLA NEGRA", "renoir:2", runtime_minutes=155,
                         poster_url="small.jpg", poster_width=200, poster_height=300)
        before = copy.deepcopy([*main["sessions"], *duplicate["sessions"]])
        data = self.group([duplicate, main])
        self.assertEqual(len(data["films"]), 1)
        combined = data["films"][0]
        self.assertEqual(combined["title"], "La bola negra")
        self.assertEqual(combined["id"], main["id"])
        self.assertEqual(combined["poster_url"], "large.jpg")
        self.assertEqual(combined["details"], main["details"])
        self.assertIn(duplicate["id"], combined["merged_ids"])
        self.assertIn("The Black Ball", combined["titles"])
        self.assertEqual(combined["sessions"], before)

    def test_verified_identity_joins_different_titles_and_preserves_metadata(self):
        a = film("imdb:tt27988879", "Ramayana", "mooby:1")
        b = film("cinesa:HO1", "Ramayana: Rise of a Legend", "cinesa:2", imdb_id="tt27988879",
                 original_title="Ramayana: Rise of a Legend", ratings={"imdb": {"score": 8}})
        result = self.group([a, b])["films"]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["ratings"], b["ratings"])
        self.assertEqual(result[0]["title"], b["title"])

    def test_remakes_and_ambiguous_title_cannot_be_bridged(self):
        films = [film("imdb:tt0087182", "Dune (1984)", "a", titles=["Dune"], release_year=1984, runtime_minutes=137),
                 film("imdb:tt1160419", "Dune (2021)", "b", titles=["Dune"], release_year=2021, runtime_minutes=155),
                 film("cinema:unknown", "DUNE", "c")]
        self.assertEqual(len(self.group(copy.deepcopy(films))["films"]), 3)
        films[2]["runtime_minutes"] = 136
        result = self.group(films)["films"]
        self.assertEqual(len(result), 2)
        classic = next(f for f in result if f["id"] == "imdb:tt0087182")
        self.assertEqual({s["id"] for s in classic["sessions"]}, {"a", "c"})

    def test_conflicting_identity_year_director_or_runtime_remain_separate(self):
        for extra in ({"imdb_id": "tt0000002"}, {"release_year": 1990},
                      {"details": {"directors": ["Another Director"]}}, {"runtime_minutes": 160}):
            with self.subTest(extra=extra):
                known = film("imdb:tt0000001", "Same title", "a", release_year=2026,
                             runtime_minutes=100, details={"directors": ["Original Director"]})
                unknown = film("cinema:1", "SAME TITLE", "b", **extra)
                self.assertEqual(len(self.group([known, unknown])["films"]), 2)

    def test_repeat_screenings_and_format_labels_join_without_losing_versions(self):
        a = film("filmoteca:1", "Billy Elliot (VOSC)", "a")
        b = film("filmoteca:2", "BILLY ELLIOT (VOSE)", "b")
        a["sessions"][0]["version"] = "VOSC"
        b["sessions"][0]["version"] = "VOSE"
        data = self.group([a, b])
        self.assertEqual(len(data["films"]), 1)
        self.assertEqual([s["version"] for s in data["films"][0]["sessions"]], ["VOSC", "VOSE"])

    def test_grouping_keeps_suitable_imdb_poster_over_larger_square(self):
        a = film("imdb:tt0000001", "Film", "a", poster_url="/verified.jpg", poster_width=900, poster_height=1350,
                 poster_provenance={"imdb_id": "tt0000001"})
        b = film("cinema:1", "Film", "b", imdb_id="tt0000001", poster_url="/square.jpg", poster_width=2000, poster_height=2000)
        self.assertEqual(self.group([a, b])["films"][0]["poster_url"], "/verified.jpg")

    def test_editions_seasons_and_double_bills_remain_distinct(self):
        films = [film("imdb:tt0075148", "Rocky", "a"),
                 film("edition:rocky-50", "Rocky", "b", imdb_id="tt0075148"),
                 film("cinema:double", "Rocky + Rocky II", "c"),
                 film("cinema:opera1", "Opera (2025-26)", "d"), film("cinema:opera2", "Opera (2026-27)", "e")]
        self.assertEqual(len(self.group(films)["films"]), 5)

    def test_bilingual_heading_joins_only_when_both_titles_identify_same_film(self):
        known = film("imdb:tt0090756", "Blue Velvet", "a", titles=["Blue Velvet", "Terciopelo azul"])
        bilingual = film("filmoteca:1", "Blue Velvet / Terciopelo azul", "b")
        other = film("cinema:2", "Blue Velvet / A different film", "c")
        result = self.group([known, bilingual, other])
        self.assertEqual(len(result["films"]), 2)
        self.assertEqual(len(next(f for f in result["films"] if f["id"] == known["id"])["sessions"]), 2)

    def test_renoir_capitalisation_uses_original_title_or_sentence_case(self):
        known = film("imdb:tt0000001", "Sense and Sensibility", "a", titles=["Sentido y sensibilidad"],
                     original_title="Sense and Sensibility")
        renoir = film("renoir:/pelicula/sentido-y-sensibilidad/", "SENTIDO Y SENSIBILIDAD", "b")
        result = self.group([known, renoir])["films"][0]
        self.assertEqual(result["title"], "Sense and Sensibility")
        result = self.group([renoir])["films"][0]
        self.assertEqual(result["title"], "Sentido y sensibilidad")
        self.assertIn("SENTIDO Y SENSIBILIDAD", result["titles"])
        proper = film("renoir:/pelicula/llueve-sobre-babel/", "LLUEVE SOBRE BABEL", "c")
        self.assertEqual(self.group([proper])["films"][0]["title"], "Llueve sobre Babel")

    def test_reviewed_id_correction_survives_merge_and_later_enrichment(self):
        reviewed = {"imdb:tt0000001": {"imdb_id": "tt0000002", "superseded_imdb_ids": ["tt0000001"]}}
        a = film("imdb:tt0000001", "Film", "a")
        a["sessions"][0]["imdb_id"] = "tt0000001"
        b = film("imdb:tt0000002", "Film", "b")
        data = self.group([a, b], reviewed)
        self.assertEqual(len(data["films"]), 1)
        self.assertEqual(identity(data["films"][0], reviewed)[0], "tt0000002")
        before = copy.deepcopy(data)
        deduplicate_programme(data, reviewed)
        self.assertEqual(data, before)

    def test_identical_session_ids_deduplicate_but_conflicts_are_rejected(self):
        a = film("imdb:tt0000001", "Film", "a")
        b = copy.deepcopy(a)
        self.assertEqual(self.group([a, b])["session_count"], 1)
        b["sessions"][0]["booking_url"] = "https://cinema.example/different"
        with self.assertRaises(ValueError):
            self.group([a, b])


if __name__ == "__main__":
    unittest.main()
