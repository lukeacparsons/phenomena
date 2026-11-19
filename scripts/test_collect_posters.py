"""Poster identity, cache reuse, actual dimensions and failure isolation."""

from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
import tempfile
import unittest

from collect_posters import allowed_url, collect, sources

try:
    from PIL import Image
except ImportError:
    Image = None

URL = "https://cms.elqueque.com/store/mooby/poster.webp"
NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)


def report(url=URL, film_id="tt123"):
    return {"sessions": [{"id": "mooby:29:1", "film_id": film_id, "title": "Film", "poster_url": url}]}


class PosterSourceTests(unittest.TestCase):
    def test_deduplicates_by_url_without_merging_films_by_title(self):
        urls, missing = sources([report(), report(), report(film_id="tt999"), report(url=None)])
        self.assertEqual(len(urls), 1)
        self.assertEqual(len(urls[URL]), 2)
        self.assertEqual(missing, [])

    def test_rejects_non_public_or_unrecognized_urls(self):
        for url in ["file:///etc/passwd", "http://localhost/a.jpg", "https://example.org/a.jpg",
                    "https://cms.elqueque.com.evil.example/a.jpg", "https://user:password@cms.elqueque.com/a.jpg"]:
            with self.subTest(url=url):
                self.assertFalse(allowed_url(url))
        self.assertTrue(allowed_url(URL))


@unittest.skipIf(Image is None, "Install requirements-posters.txt for image/cache tests")
class PosterCacheTests(unittest.TestCase):
    def image(self, size=(600, 900)):
        output = BytesIO()
        Image.new("RGB", size, (50, 100, 150)).save(output, "PNG")
        return output.getvalue()

    def test_reuses_one_asset_for_all_showtimes_without_redownloading(self):
        body, calls = self.image(), []
        def fetch(url):
            calls.append(url)
            return body
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            first = collect([report(), report()], output, fetch, NOW)
            second = collect([report()], output, fetch, NOW + timedelta(minutes=30))
            self.assertEqual(calls, [URL])
            asset = first["assets"][0]
            self.assertEqual((asset["width"], asset["height"], asset["content_type"]), (600, 900, "image/png"))
            self.assertTrue(asset["meets_target"])
            self.assertTrue(second["assets"][0]["reused_from_cache"])
            self.assertEqual((output / asset["filename"]).read_bytes(), body)

    def test_thumbnail_is_flagged_and_not_upscaled(self):
        with tempfile.TemporaryDirectory() as folder:
            result = collect([report()], Path(folder), lambda url: self.image((137, 204)), NOW)
            self.assertEqual(result["below_target"], 1)
            self.assertEqual(result["assets"][0]["width"], 137)
            self.assertFalse(result["assets"][0]["meets_target"])

    def test_failed_refresh_preserves_last_good_file_and_marks_it_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            output, body = Path(folder), self.image()
            first = collect([report()], output, lambda url: body, NOW)
            result = collect([report()], output, lambda url: b'<html>blocked</html>', NOW + timedelta(days=8))
            asset = result["assets"][0]
            self.assertEqual((result["status"], asset["status"]), ("partial", "stale"))
            self.assertEqual(asset["filename"], first["assets"][0]["filename"])
            self.assertEqual((output / asset["filename"]).read_bytes(), body)

    def test_corrupted_cache_is_refetched_and_repaired(self):
        with tempfile.TemporaryDirectory() as folder:
            output, body = Path(folder), self.image()
            first = collect([report()], output, lambda url: body, NOW)
            path = output / first["assets"][0]["filename"]
            path.write_bytes(b'corrupted')
            result = collect([report()], output, lambda url: body, NOW + timedelta(minutes=1))
            self.assertFalse(result["assets"][0]["reused_from_cache"])
            self.assertEqual(path.read_bytes(), body)

    def test_missing_and_failed_images_do_not_remove_valid_assets(self):
        bad = "https://cms.elqueque.com/missing.jpg"
        def fetch(url):
            if url == bad:
                raise ValueError("HTTP failure")
            return self.image()
        with tempfile.TemporaryDirectory() as folder:
            result = collect([report(), report(bad, "tt456"), report(None, "tt789")], Path(folder), fetch, NOW)
            self.assertEqual(result["counts"], {"ok": 1, "error": 1})
            self.assertEqual(len(result["missing_posters"]), 1)
            self.assertEqual(result["status"], "partial")


if __name__ == "__main__":
    unittest.main()
