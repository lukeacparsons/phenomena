"""Fallback identity, decoded resolution, cache and failure isolation."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from PIL import Image
from poster_fallbacks import enrich, identity, select_candidate

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
IMAGE = "https://m.media-amazon.com/images/M/poster.jpg"


def film():
    return {"id": "imdb:tt123", "title": "Film", "titles": ["Film"], "poster_url": "/cinema.jpg",
            "poster_width": 137, "poster_height": 204,
            "sessions": [{"provider": "mooby", "film_id": "tt123", "year": 2026}]}


def candidate(imdb="tt123", year=2026):
    return {"id": imdb, "qid": "movie", "l": "Film", "y": year, "i": {"imageUrl": IMAGE, "width": 2000, "height": 3000}}


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.output = Path(self.folder.name)
        self.lookup = Mock(return_value={"d": [candidate()]})
        self.download = Mock(return_value=self.image())

    def image(self, size=(900, 1350)):
        stream = BytesIO()
        Image.new("RGB", size).save(stream, "PNG")
        return stream.getvalue()

    def run_fallback(self, movie=None, now=NOW):
        data = {"films": [movie or film()]}
        result = enrich(data, self.output, self.lookup, self.download, now, reviewed={})
        return data["films"][0], result

    def test_decoded_dimensions_and_exact_id_determine_replacement(self):
        self.lookup.return_value = {"d": [candidate("tt999"), candidate()]}
        movie, result = self.run_fallback()
        self.assertEqual((movie["poster_width"], movie["poster_height"]), (900, 1350))
        self.assertEqual(movie["poster_provenance"]["imdb_id"], "tt123")
        self.assertEqual(movie["poster_original"]["url"], "/cinema.jpg")
        self.assertEqual(result["upgraded"], 1)

    def test_high_resolution_source_is_not_searched(self):
        movie = film()
        movie.update(poster_width=1000, poster_height=1500)
        self.run_fallback(movie)
        self.lookup.assert_not_called()

    def test_large_square_banner_and_narrow_images_are_replaced(self):
        for width, height in ((1500, 1500), (1800, 1000), (900, 2400)):
            with self.subTest(size=(width, height)):
                movie = film()
                movie.update(poster_width=width, poster_height=height)
                movie, _ = self.run_fallback(movie)
                self.assertEqual((movie["poster_width"], movie["poster_height"]), (900, 1350))

    def test_wrong_shape_imdb_image_does_not_replace_source(self):
        self.download.return_value = self.image((1500, 1500))
        movie, result = self.run_fallback()
        self.assertEqual(movie["poster_url"], "/cinema.jpg")
        self.assertEqual(result["films"][movie["id"]]["status"], "below_target")

    def test_four_to_five_imdb_poster_replaces_banner_and_retries_old_rejection(self):
        movie=film();movie.update(poster_width=1200,poster_height=630,
                                 poster_image={'source':'/cinema.jpg','variants':[]})
        previous={'films':{movie['id']:{'status':'below_target','image_policy_version':2,
                                      'query':'tt123','checked_at':NOW.isoformat(),'width':1290,'height':1611}}}
        (self.output/'fallbacks.json').write_text(json.dumps(previous))
        self.download.return_value=self.image((1290,1611))
        updated,result=self.run_fallback(movie,NOW+timedelta(minutes=1))
        self.assertEqual((updated['poster_width'],updated['poster_height']),(1290,1611))
        self.assertEqual(result['upgraded'],1)
        self.lookup.assert_called_once()
        self.assertNotIn('poster_image',updated)

    def test_targeted_refresh_preserves_other_films_cached_fallbacks(self):
        other={'status':'needs_review','query':'another film','checked_at':NOW.isoformat()}
        (self.output/'fallbacks.json').write_text(json.dumps({'films':{'other':other}}))
        _,result=self.run_fallback()
        self.assertEqual(result['films']['other'],other)

    def test_oversized_original_uses_same_imdb_artwork_at_bounded_resolution(self):
        row = candidate()
        row["i"].update(imageUrl="https://m.media-amazon.com/images/M/abc._V1_.jpg", width=12000, height=18000)
        self.lookup.return_value = {"d": [row]}
        self.download.return_value = self.image((1200, 1800))
        movie, result = self.run_fallback()
        self.download.assert_called_once_with("https://m.media-amazon.com/images/M/abc._V1_SX1200_.jpg")
        self.assertEqual(movie["poster_width"], 1200)
        self.assertEqual(result["upgraded"], 1)

    def test_wrong_id_is_not_accepted_even_with_identical_title(self):
        self.lookup.return_value = {"d": [candidate("tt999")]}
        movie, result = self.run_fallback()
        self.assertEqual(movie["poster_url"], "/cinema.jpg")
        self.assertEqual(result["needs_review"], 1)
        self.download.assert_not_called()

    def test_missing_year_ambiguous_title_and_remake_are_not_auto_matched(self):
        movie = film()
        self.assertIsNone(select_candidate(movie, [candidate("tt1"), candidate("tt2")], None))
        self.assertIsNone(select_candidate(movie, [candidate(year=1986)], None))
        movie["sessions"][0].pop("year")
        self.assertIsNone(select_candidate(movie, [candidate()], None))
        movie["sessions"][0]["starts_at"] = "2026-11-20T12:00:00Z"
        self.assertIsNone(select_candidate(movie, [candidate()], None))

    def test_exact_title_and_known_year_can_match_without_source_id(self):
        self.assertEqual(select_candidate(film(), [candidate()], None)["id"], "tt123")

    def test_real_thumbnail_not_metadata_claim_is_checked(self):
        self.download.return_value = self.image((137, 204))
        movie, result = self.run_fallback()
        self.assertEqual(movie["poster_url"], "/cinema.jpg")
        self.assertEqual(result["films"][movie["id"]]["status"], "below_target")

    def test_non_image_and_wrong_hosts_preserve_source_and_sessions(self):
        original = film()
        for image_url in [IMAGE, "https://localhost/poster.jpg"]:
            row = candidate()
            row["i"]["imageUrl"] = image_url
            self.lookup.return_value = {"d": [row]}
            self.download.return_value = b"<html>not a poster</html>"
            movie, result = self.run_fallback(deepcopy(original), NOW + timedelta(days=2))
            self.assertEqual(movie, original)
            self.assertEqual(result["failed"], 1)

    def test_warm_cache_reuses_asset_without_network_requests(self):
        first, _ = self.run_fallback()
        second, result = self.run_fallback(now=NOW + timedelta(hours=1))
        self.assertEqual(first["poster_url"], second["poster_url"])
        self.assertEqual(self.lookup.call_count, 1)
        self.assertEqual(self.download.call_count, 1)
        self.assertTrue(result["films"]["imdb:tt123"]["reused_from_cache"])

    def test_larger_cached_fallback_survives_grouping_with_an_adequate_cinema_image(self):
        first, _ = self.run_fallback()
        movie = film()
        movie.update(poster_width=600, poster_height=900)
        next, _ = self.run_fallback(movie)
        self.assertEqual(first["poster_url"], next["poster_url"])
        self.assertEqual(next["poster_width"], 900)
        self.assertEqual(self.lookup.call_count, 1)

    def test_failed_later_refresh_retains_verified_fallback_and_original_time(self):
        first, _ = self.run_fallback()
        self.lookup.side_effect = ValueError("offline")
        second, _ = self.run_fallback(now=NOW + timedelta(days=8))
        self.assertEqual(first["poster_url"], second["poster_url"])
        self.assertEqual(first["poster_provenance"]["fetched_at"], second["poster_provenance"]["fetched_at"])
        self.assertTrue(second["poster_provenance"]["stale"])

    def test_conflicting_verified_ids_fail_closed(self):
        with self.assertRaises(ValueError):
            identity(film(), {"imdb:tt123": {"imdb_id": "tt999"}})

    def test_reviewed_correction_replaces_only_the_named_bad_id(self):
        reviewed = {"imdb:tt123": {"imdb_id": "tt999", "superseded_imdb_ids": ["tt123"]}}
        self.assertEqual(identity(film(), reviewed)[0], "tt999")
        movie = film()
        movie["imdb_id"] = "tt456"
        with self.assertRaises(ValueError):
            identity(movie, reviewed)


if __name__ == "__main__":
    unittest.main()
