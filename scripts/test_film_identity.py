"""Identity evidence, translated titles, cache reuse and ambiguity regressions."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from film_identity import enrich, verify, parse_source, publisher_facts, provider_url, entity_titles, Lookup

NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)


def candidate(**changes):
    return {"imdb_id": "tt1234567", "titles": ["La carn", "The Flesh"], "original_title": "La carn",
            "english_title": "The Flesh", "title_language": "ca", "years": [2025], "directors": ["Joan Porcel"],
            "runtimes": [83], "cast": ["Lluís Garau"], "identity_source": "https://www.wikidata.org/entity/Q123",
            "rotten_tomatoes": "https://www.rottentomatoes.com/m/the_flesh_2025",
            "filmaffinity": "https://www.filmaffinity.com/es/film123456.html", **changes}


class IdentityTests(unittest.TestCase):
    def test_published_aliases_include_spanish_catalan_english_and_native(self):
        item = {"labels": {"en": {"value": "The Black Ball"}, "es": {"value": "La bola negra"}, "ca": {"value": "La bola negra"}},
                "aliases": {"es": [{"value": "Bola negra"}]}, "claims": {"P1476": [{"rank": "normal",
                "mainsnak": {"snaktype": "value", "datavalue": {"value": {"text": "La bola negra", "language": "es"}}}}]}}
        self.assertEqual(entity_titles(item), ["The Black Ball", "La bola negra", "Bola negra"])
        self.assertEqual(entity_titles({"labels": [], "aliases": []}), [])

    def test_title_alone_and_runtime_alone_are_not_identity(self):
        self.assertIsNone(verify({"titles": ["La carn"]}, candidate()))
        self.assertIsNone(verify({"titles": ["La carn"], "runtimes": [83]}, candidate()))
        self.assertIn("release_year", verify({"titles": ["LA CARN"], "years": [2025]}, candidate()))

    def test_different_localized_title_requires_corroboration(self):
        facts = {"titles": ["Un título local"], "directors": ["Joan Porcel"], "runtimes": [83]}
        self.assertIsNone(verify(facts, candidate()))
        self.assertEqual(verify(facts, candidate(), discovered=True), ["director", "runtime"])
        self.assertIsNone(verify({**facts, "runtimes": []}, candidate(), discovered=True))

    def test_conflicting_year_director_or_runtime_rejects_remake(self):
        facts = {"titles": ["La carn"], "years": [2025], "directors": ["Joan Porcel"], "runtimes": [83]}
        for changed in ({"years": [1991]}, {"directors": ["Marco Ferreri"]}, {"runtimes": [110]}):
            self.assertIsNone(verify({**facts, **changed}, candidate()))

    def test_bilingual_heading_must_refer_to_same_film(self):
        self.assertIsNotNone(verify({"titles": ["La carn / The Flesh"], "years": [2025]}, candidate(titles=["La carn", "The Flesh", "La carn / The Flesh"])))
        self.assertIsNone(verify({"titles": ["La carn / Dune"], "years": [2025]}, candidate(titles=["La carn / Dune", "La carn"])))

    def test_cinema_metadata_never_treats_local_release_as_original_year(self):
        movie = {"@type": "Movie", "name": "¿Teléfono rojo?", "dateCreated": "1966-01-10",
                 "directors": [{"name": "Stanley Kubrick"}], "duration": "PT95M"}
        html = '<script type="application/ld+json">' + json.dumps([{"@type": "Event", "workPerformed": movie}]*2) + '</script>'
        facts = parse_source(html)
        self.assertEqual(facts["directors"], ["Stanley Kubrick"])
        self.assertEqual(facts["runtimes"], [95])
        self.assertEqual(facts["years"], [])

    def test_explicit_original_title_language_year_and_director(self):
        facts = parse_source('<div>Títol original: La carn</div><div>Direcció: Joan Porcel</div><div>Any: 2025</div><div>Durada: 83\'</div><div>Idioma original: Català, castellà, anglès</div><div>Versió: VO</div>')
        self.assertEqual(facts["titles"], ["La carn"])
        self.assertEqual(facts["languages"], ["ca", "es", "en"])
        self.assertEqual(facts["years"], [2025])

    def test_identity_resolution_runs_even_with_suitable_poster_and_reuses_cache(self):
        film = {"id": "venue:42", "title": "LA CARN", "poster_width": 2000, "poster_height": 3000,
                "sessions": [{"provider": "venue", "film_id": "42", "title": "LA CARN", "year": 2025}]}
        fetch = Mock(side_effect=AssertionError("No external request expected"))
        with tempfile.TemporaryDirectory() as folder, patch.object(Lookup, "candidates", return_value=[candidate()]) as lookup:
            data = {"films": [deepcopy(film)]}
            ids = {film["id"]: None}
            enrich(data, Path(folder), fetch, NOW, ids, {})
            self.assertEqual(ids[film["id"]], "tt1234567")
            self.assertEqual(data["films"][0]["title"], "LA CARN")  # Display policy is applied downstream.
            self.assertIn("The Flesh", data["films"][0]["titles"])
            # A fresh schedule snapshot also gets the cached identity.
            data = {"films": [deepcopy(film)]}
            enrich(data, Path(folder), fetch, NOW+timedelta(hours=1), {film["id"]: None}, {})
            self.assertEqual(lookup.call_count, 1)
            self.assertEqual(data["films"][0]["imdb_id"], "tt1234567")
            fetch.assert_not_called()

    def test_ambiguous_matches_and_events_remain_unresolved(self):
        data = {"films": [{"id": "film:1", "title": "La carn", "sessions": [{"year": 2025}]},
                          {"id": "event:1", "title": "La carn + Dune", "sessions": [{"year": 2025}]}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(Lookup, "candidates", return_value=[candidate(), candidate(imdb_id="tt2345678")]):
            enrich(data, Path(folder), Mock(), NOW, {}, {})
            saved = json.loads((Path(folder)/"film-identities.json").read_text())["films"]
            self.assertEqual(saved["film:1"]["status"], "ambiguous")
            self.assertEqual(saved["event:1"]["status"], "programme_event")
            self.assertFalse(any(f.get("imdb_id") for f in data["films"]))

    def test_publisher_pages_include_the_explicit_original_title(self):
        html = '<h1 id="main-title">The Flesh (2025)</h1><dl><dt>Título original</dt><dd>La carn</dd><dt>Año</dt><dd>2025</dd><dt>Dirección</dt><dd><a href="name.php?id=1">Joan Porcel</a></dd></dl>'
        result = publisher_facts(html, "filmaffinity")
        self.assertEqual(result["titles"], ["The Flesh", "La carn"])
        self.assertEqual(result["years"], [2025])
        self.assertEqual(result["directors"], ["Joan Porcel"])

    def test_provider_links_are_exact_film_pages_on_expected_hosts(self):
        self.assertTrue(provider_url("https://www.filmaffinity.com/es/film123456.html", "filmaffinity"))
        for url in ("https://evil.test/es/film123.html", "https://www.rottentomatoes.com/m/../../other", "https://www.rottentomatoes.com/m/test?redirect=other"):
            self.assertFalse(provider_url(url, "rotten_tomatoes"))

    def test_english_imdb_label_can_bridge_a_verified_catalan_film(self):
        lookup = Lookup(Mock(), {}, NOW)
        page = candidate(titles=["La carn"], english_title="La carn", evidence=["published_title", "director", "release_year"])
        lookup.publisher = Mock(return_value=page)
        lookup.parsed = Mock(return_value="La carn")
        row = {"id": "tt1234567", "l": "The Flesh", "y": 2025, "qid": "movie", "s": "Lluís Garau"}
        lookup.json = Mock(return_value={"d": [row]})
        resolved = lookup.from_filmaffinity({"titles": ["LA CARN"], "languages": ["ca"]})
        self.assertEqual(resolved["original_title"], "La carn")
        self.assertEqual(resolved["english_title"], "The Flesh")
        self.assertEqual(resolved["title_language"], "ca")
        for wrong in ({"y": 1991}, {"s": "A different actor"}):
            lookup.json.return_value = {"d": [{**row, **wrong}]}
            self.assertIsNone(lookup.from_filmaffinity({"titles": ["LA CARN"]}))

    def test_broken_unrelated_publisher_hit_does_not_discard_verified_result(self):
        lookup = Lookup(Mock(), {}, NOW)
        good, bad = "https://www.filmaffinity.com/es/film123.html", "https://www.filmaffinity.com/es/film456.html"
        def parsed(url, parser):
            if "search.php" in url:
                return [good, bad]
            if url == good:
                return candidate()
            raise OSError("Unrelated result unavailable")
        lookup.parsed = parsed
        result = lookup.publisher(candidate(), "filmaffinity")
        self.assertEqual(result["filmaffinity"], good)

    def test_repeated_fetch_failures_keep_verified_identity_and_evidence_date(self):
        film = {"id": "venue:42", "title": "La carn", "sessions": [{"year": 2025}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(Lookup, "candidates", return_value=[candidate()]) as lookup:
            output = Path(folder)
            enrich({"films": [deepcopy(film)]}, output, Mock(), NOW, {}, {})
            lookup.side_effect = OSError("Offline")
            for day in (8, 9):
                data = {"films": [deepcopy(film)]}
                enrich(data, output, Mock(), NOW+timedelta(days=day), {}, {})
                record = json.loads((output/"film-identities.json").read_text())["films"][film["id"]]
                self.assertEqual(data["films"][0]["imdb_id"], "tt1234567")
                self.assertEqual(record["checked_at"], NOW.isoformat())
                self.assertEqual(record["status"], "error")


if __name__ == "__main__":
    unittest.main()
