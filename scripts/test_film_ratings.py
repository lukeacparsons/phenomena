import gzip
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from film_ratings import IMDB_DATASET, RatingsRefresher, apply_titles, enrich, film_identity, parse_audience_rating, parse_mappings, parse_rating, preserve_failure, refresh_programme


def rt(score=83, name="Tomatometer", count=100, audience=90, verified=True):
    return '<script type="application/ld+json">' + json.dumps({
        "@type": "Movie", "aggregateRating": {"name": name, "bestRating": "100", "ratingValue": score, "ratingCount": count}
    }) + '</script><script id="media-scorecard-json" type="application/json">' + json.dumps({
        "audienceScore": {"scorePercent": str(audience) + "%" if audience is not None else None,
                          "bandedRatingCount": "5,000+ Verified Ratings" if verified else "25,000+ Ratings",
                          "reviewsPageUrl": "/m/dune_2021/reviews/" + ("verified-audience" if verified else "all-audience")},
        "criticsScore": {"scorePercent": str(score) + "%"}
    }) + '</script>'


def mapping(imdb="tt0000001", rt_slug="m/dune_2021", fa="123", item="Q1"):
    return {key: {"value": value} for key, value in {
        "imdb": imdb, "item": "http://www.wikidata.org/entity/" + item, "rt": rt_slug, "fa": fa
    }.items()}


class RatingTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        credential_patch = patch('tmdb_languages.credentials', return_value={})
        credential_patch.start()
        self.addCleanup(credential_patch.stop)

    def test_only_critics_tomatometer_is_used(self):
        self.assertEqual(parse_rating("rotten_tomatoes", rt())["score"], 83)
        with self.assertRaises(ValueError):
            parse_rating("rotten_tomatoes", rt(name="Popcornmeter"))

    def test_zero_percent_is_a_real_score(self):
        self.assertEqual(parse_rating("rotten_tomatoes", rt(score=0))["score"], 0)
        self.assertIsNone(parse_rating("rotten_tomatoes", rt(count=0)))

    def test_certified_fresh_is_read_from_the_critics_badge_only(self):
        for flag in (True, False):
            html = rt(score=99).replace('"criticsScore": {', '"criticsScore": {"certified": ' + json.dumps(flag) + ',')
            self.assertIs(parse_rating('rotten_tomatoes', html)['certified_fresh'], flag)
        self.assertIsNone(parse_rating('rotten_tomatoes', rt(score=99))['certified_fresh'])
        html = rt(score=99).replace('"audienceScore": {', '"audienceScore": {"certified": true,')
        self.assertIsNone(parse_rating('rotten_tomatoes', html)['certified_fresh'])

    def test_audience_is_distinct_from_critics_and_keeps_verification(self):
        for verified in (True, False):
            audience = parse_audience_rating(rt(score=83, audience=90, verified=verified))
            self.assertEqual(audience["score"], 90)
            self.assertEqual(audience["verified"], verified)
            self.assertEqual(audience["scale"], 100)

    def test_audience_zero_unrated_and_invalid_pages_are_distinct(self):
        self.assertEqual(parse_audience_rating(rt(audience=0))["score"], 0)
        self.assertIsNone(parse_audience_rating(rt(audience=None)))
        for html in ("<html>Access denied</html>", rt(audience=101), rt(audience=-1), rt(audience="NaN")):
            with self.subTest(html=html), self.assertRaises(ValueError):
                parse_audience_rating(html)

    def test_audience_only_score_survives_failed_refresh(self):
        prior = {"url": "https://example.com/film", "score": None,
                 "audience": {"score": 80, "checked_at": "2026-01-01T00:00:00+00:00"}}
        result = preserve_failure(prior, prior["url"], datetime.now(timezone.utc), "Timeout")
        self.assertEqual(result["audience"], prior["audience"])
        self.assertEqual(result["status"], "stale")

    def test_unrated_movie_differs_from_failed_fetch(self):
        self.assertIsNone(parse_rating("rotten_tomatoes", '<script type="application/ld+json">{"@type":"Movie"}</script>'))
        with self.assertRaises(ValueError):
            parse_rating("rotten_tomatoes", '<html>Access denied</html>')

    def test_filmaffinity_reads_film_microdata(self):
        html = '<h1 id="main-title">Dune</h1><div id="movie-rat-avg" content="7.2"></div><span content="52901" itemprop="ratingCount"></span>'
        self.assertEqual(parse_rating("filmaffinity", html), {"score": 7.2, "count": 52901, "scale": 10})
        self.assertIsNone(parse_rating("filmaffinity", '<h1 id="main-title">Unrated film</h1>'))
        with self.assertRaises(ValueError):
            parse_rating("filmaffinity", '<html>Rate limited</html>')

    def test_invalid_scores_are_rejected(self):
        for value in (-1, 101, "NaN", "Infinity"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_rating("rotten_tomatoes", rt(score=value))

    def test_identity_conflict_is_not_silently_merged(self):
        with self.assertRaises(ValueError):
            film_identity({"id": "imdb:tt0000001", "sessions": [], "poster_provenance": {"imdb_id": "tt0000002"}}, {})

    def test_cinema_placeholders_are_not_imdb_links(self):
        self.assertIsNone(film_identity({"id": "imdb:tt111909", "sessions": []}, {}))

    def test_original_title_preserves_localized_search_aliases(self):
        film = {"title": "El quimérico inquilino", "titles": ["EL QUIMÉRICO INQUILINO"]}
        apply_titles(film, "tt0074811", {"original_title": "Le Locataire", "english_title": "The Tenant", "title_language": "fr"})
        self.assertEqual(film["title"], "Le Locataire")
        self.assertIn("The Tenant", film["titles"])
        self.assertIn("El quimérico inquilino", film["titles"])

    def test_asian_titles_display_english_but_remain_searchable(self):
        film = {"title": "La princesa Mononoke", "titles": []}
        apply_titles(film, "tt0119698", {"original_title": "もののけ姫", "english_title": "Princess Mononoke", "title_language": "ja"})
        self.assertEqual(film["title"], "Princess Mononoke")
        self.assertIn("もののけ姫", film["titles"])
        self.assertIn("La princesa Mononoke", film["titles"])

    def test_spanish_and_catalan_titles_keep_originals_and_english_search_aliases(self):
        for original, english, language in [("La bola negra", "The Black Ball", "es"), ("Viva", "Alive", "ca")]:
            with self.subTest(language=language):
                film = {"title": english, "titles": [english]}
                metadata = {"original_title": original, "english_title": english, "title_language": language}
                apply_titles(film, "tt0000001", metadata)
                self.assertEqual(film["title"], original)
                self.assertIn(english, film["titles"])
                self.assertIn(original, film["titles"])
                apply_titles(film, "tt0000001", metadata)
                self.assertEqual(film["title"], original)
                self.assertEqual(film["source_title"], english)

    def test_reviewed_spanish_titles_survive_future_refreshes(self):
        overrides = json.loads(Path(__file__).with_name("film_metadata_overrides.json").read_text())
        for imdb, original in [("tt35511966", "La bola negra"), ("tt39381628", "El tren fluvial")]:
            with self.subTest(imdb=imdb):
                metadata = overrides[imdb]
                film = {"title": metadata["english_title"], "titles": []}
                apply_titles(film, imdb, metadata)
                self.assertEqual(film["title"], original)
                self.assertEqual(film["title_language"], "es")

    def test_original_titles_do_not_collapse_dune_adaptations(self):
        for imdb, year in [("tt0087182", 1984), ("tt1160419", 2021)]:
            film = {"title": "Dune", "titles": []}
            apply_titles(film, imdb, {"original_title": "Dune", "title_language": "en"})
            self.assertEqual(film["title"], f"Dune ({year})")

    def test_ambiguous_or_unsafe_mappings_are_not_linked(self):
        self.assertEqual(parse_mappings([mapping(), mapping(item="Q2")]), {})
        result = parse_mappings([mapping(rt_slug="m/../../other", fa="123?url=bad")])["tt0000001"]
        self.assertNotIn("rotten_tomatoes", result)
        self.assertNotIn("filmaffinity", result)

    def test_failed_refresh_preserves_score_and_original_timestamp(self):
        prior = {"url": "https://example.com/film", "score": 0, "checked_at": "2026-01-01T00:00:00+00:00"}
        result = preserve_failure(prior, prior["url"], datetime.now(timezone.utc), "Timeout")
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["checked_at"], prior["checked_at"])
        self.assertEqual(result["status"], "stale")
        self.assertIsNone(preserve_failure(prior, "https://example.com/other", datetime.now(timezone.utc), "Timeout")["score"])

    def test_cached_run_needs_no_requests_and_keeps_unmatched_unknown(self):
        now = datetime(2026, 11, 19, tzinfo=timezone.utc)
        data = {"films": [{"id": "imdb:tt0000001", "title": "Dune", "sessions": []},
                          {"id": "event:1", "title": "Dune double bill", "sessions": []}]}
        calls = []

        def fetch(url):
            calls.append(url)
            if "wikidata.org" in url:
                return json.dumps({"results": {"bindings": [mapping()]}}).encode()
            if url == IMDB_DATASET:
                return gzip.compress(b"tconst\taverageRating\tnumVotes\ntt0000001\t8.0\t1000\n")
            if "rottentomatoes.com" in url:
                return rt().encode()
            return b'<h1 id="main-title">Dune</h1><div id="movie-rat-avg" content="7.2"></div><meta itemprop="ratingCount" content="20">'

        with tempfile.TemporaryDirectory() as directory:
            result = enrich(data, Path(directory), fetch, now, reviewed={})
            self.assertEqual(result["scores"], {"imdb": 1, "filmaffinity": 1, "rotten_tomatoes": 1})
            self.assertEqual(data["films"][0]["ratings"]["imdb"]["score"], 8)
            self.assertEqual(data["films"][0]["ratings"]["rotten_tomatoes"]["audience"]["score"], 90)
            self.assertEqual(data["films"][0]["ratings"]["rotten_tomatoes"]["audience"]["url"], "https://www.rottentomatoes.com/m/dune_2021/reviews/verified-audience")
            self.assertEqual(sum("rottentomatoes.com" in url for url in calls), 1)
            self.assertIsNone(data["films"][1]["ratings"]["imdb"]["score"])
            self.assertEqual(data["films"][1]["ratings"]["imdb"]["status"], "unmatched")
            calls.clear()
            enrich(data, Path(directory), fetch, now + timedelta(minutes=30), reviewed={})
            self.assertEqual(calls, [])


class DailyRatingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.programme = Path(self.directory.name) / "screenings.json"
        self.programme.write_text(json.dumps({"films": [{"id": "film:1", "title": "Film", "sessions": []}]}))
        self.start = datetime(2026, 11, 19, tzinfo=timezone.utc)
        self.now = self.start
        self.manifest = self.programme.parent / "ratings.json"
        self.manifest.write_text(json.dumps({"checked_at": self.start.isoformat(), "identity_metadata_version": 1, "search_content_version": 2, "films": {"film:1": {"ratings": {}}}}))
        self.calls = []

        def refresh(path, **kwargs):
            self.calls.append(kwargs["now"])
            return {"scores": {}}

        self.runner = RatingsRefresher(self.programme, clock=lambda: self.now, refresh=refresh)

    def test_fresh_cache_is_skipped_until_24_hours(self):
        self.assertFalse(self.runner.refresh_if_due())
        self.now = self.start + timedelta(hours=23, minutes=59)
        self.assertFalse(self.runner.refresh_if_due())
        self.now = self.start + timedelta(hours=24)
        self.assertTrue(self.runner.refresh_if_due())
        self.assertEqual(len(self.calls), 1)

    def test_existing_cache_gets_identity_resolution_without_waiting_a_day(self):
        data = json.loads(self.manifest.read_text())
        data.pop("identity_metadata_version")
        self.manifest.write_text(json.dumps(data))
        self.assertTrue(self.runner.refresh_if_due())

    def test_existing_cache_gets_story_content_without_waiting_a_day(self):
        data = json.loads(self.manifest.read_text())
        data.pop('search_content_version')
        self.manifest.write_text(json.dumps(data))
        self.assertTrue(self.runner.refresh_if_due())

    def test_failed_scores_retry_after_an_hour(self):
        data = json.loads(self.manifest.read_text())
        data["films"]["film:1"]["ratings"] = {"rotten_tomatoes": {"status": "ok", "audience": {"status": "stale"}}}
        self.manifest.write_text(json.dumps(data))
        self.now += timedelta(minutes=59)
        self.assertFalse(self.runner.refresh_if_due())
        self.now += timedelta(minutes=1)
        self.assertTrue(self.runner.refresh_if_due())

    def test_refresh_exception_does_not_remove_cache_or_retry_immediately(self):
        original = self.programme.read_bytes()
        self.now += timedelta(days=1)
        def fail(*args, **kwargs):
            raise OSError("Unavailable")
        self.runner.refresh = fail
        with self.assertRaises(OSError):
            self.runner.refresh_if_due()
        self.now += timedelta(minutes=30)
        self.assertFalse(self.runner.refresh_if_due())
        self.assertEqual(self.programme.read_bytes(), original)

    def test_new_films_trigger_enrichment_before_daily_deadline(self):
        self.programme.write_text(json.dumps({"films": [{"id": "film:1"}, {"id": "film:2"}]}))
        self.assertTrue(self.runner.refresh_if_due())

    def test_background_write_preserves_schedule_and_poster_changes(self):
        def enrich_during_schedule_change(data, *args, **kwargs):
            data["films"][0].update({"title": "Original title", "titles": ["English title"], "ratings": {"imdb": {"score": 8}}})
            latest = {"films": [{"id": "film:1", "title": "Film", "titles": ["New cinema alias"],
                                 "sessions": [{"id": "new-session"}], "poster_url": "/new-poster.webp"},
                                {"id": "film:2", "title": "New film", "sessions": []}]}
            self.programme.write_text(json.dumps(latest))
            return {"scores": {"imdb": 1}}
        with patch("film_ratings.enrich", side_effect=enrich_during_schedule_change):
            refresh_programme(self.programme, now=self.now)
        updated = json.loads(self.programme.read_text())
        film = updated["films"][0]
        self.assertEqual(film["title"], "Original title")
        self.assertEqual(film["sessions"], [{"id": "new-session"}])
        self.assertEqual(film["poster_url"], "/new-poster.webp")
        self.assertEqual(film["titles"], ["New cinema alias", "English title"])
        self.assertEqual(film["ratings"]["imdb"]["score"], 8)
        self.assertEqual(updated["films"][1]["title"], "New film")

    def test_newly_resolved_identity_upgrades_poster_in_daily_run(self):
        self.programme.write_text(json.dumps({"films": [{"id": "film:1", "title": "Local title", "sessions": [],
            "poster_url": "/square.jpg", "poster_width": 1200, "poster_height": 1200}]}))
        def resolve(data, *args, **kwargs):
            data["films"][0]["imdb_id"] = "tt1234567"
            return {"scores": {}}
        def posters(data, *args, **kwargs):
            film = data["films"][0]
            self.assertEqual(film["imdb_id"], "tt1234567")
            film.update(poster_url="/verified.jpg", poster_width=1000, poster_height=1500,
                        poster_provenance={"imdb_id": "tt1234567"})
            return {"upgraded": 1}
        with patch("film_ratings.enrich", side_effect=resolve), patch("film_ratings.enrich_posters", side_effect=posters):
            refresh_programme(self.programme, now=self.now)
        film = json.loads(self.programme.read_text())["films"][0]
        self.assertEqual(film["poster_url"], "/verified.jpg")
        self.assertEqual(film["poster_width"], 1000)


if __name__ == "__main__":
    unittest.main()
