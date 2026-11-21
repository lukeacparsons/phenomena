"""Collection runs independently of page visits and retains honest stale data."""

from datetime import datetime, timezone
from contextlib import closing
import json
import sqlite3
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock

from availability_cache import AvailabilityCache
from premium_availability import ScreeningAvailabilityUnavailable


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.programme = Path(self.tmp.name) / "screenings.json"
        self.cache_path = Path(self.tmp.name) / "availability.json"
        self.now = datetime(2026, 11, 19, 12, tzinfo=timezone.utc).timestamp()
        self.fetcher = Mock()
        self.fetcher.__enter__ = Mock(return_value=self.fetcher)
        self.fetcher.__exit__ = Mock(return_value=False)
        self.fetcher.fetch.side_effect = lambda row: self.value(0)
        self.bulk = Mock(return_value={})
        self.write_rows(self.row("one"))

    def row(self, sid, provider="mooby", **extra):
        return {"id": provider + ":" + sid, "provider": provider,
                "starts_at": "2026-11-20T19:00:00+01:00", **extra}

    def value(self, count):
        return {"kind": "ordinary", "available": count,
                "checked_at": datetime.fromtimestamp(self.now, timezone.utc).isoformat()}

    def write_rows(self, *rows):
        self.programme.write_text(json.dumps({"films": [{"sessions": rows}]}))

    def manager(self):
        return AvailabilityCache(self.programme, self.cache_path, interval=900, clock=lambda: self.now,
                                 fetcher_factory=lambda: self.fetcher, phenomena_fetcher=self.bulk)

    def test_collects_without_visits_and_respects_freshness_across_restart(self):
        self.write_rows(self.row("one"), self.row("two", "unsupported"),
                        self.row("past", starts_at="2026-11-18T19:00:00+01:00"))
        cache = self.manager()
        cache.refresh()
        self.assertEqual(cache.snapshot()["sessions"]["mooby:one"]["available"], 0)
        self.assertEqual(self.fetcher.fetch.call_count, 1)
        for _ in range(10):
            cache.snapshot()
        self.manager().refresh()
        self.assertEqual(self.fetcher.fetch.call_count, 1)
        self.now += 901
        cache.refresh()
        self.assertEqual(self.fetcher.fetch.call_count, 2)

    def test_failed_refresh_preserves_count_and_original_time_then_recovers(self):
        cache = self.manager()
        cache.refresh()
        previous = cache.snapshot()["sessions"]["mooby:one"]
        self.now += 901
        self.fetcher.fetch.side_effect = ValueError("unavailable")
        cache.refresh()
        self.assertEqual(cache.snapshot()["sessions"]["mooby:one"], previous)
        self.assertIn("mooby:one", cache.snapshot()["errors"])
        cache.refresh()
        self.assertEqual(self.fetcher.fetch.call_count, 2)
        self.now += 901
        self.fetcher.fetch.side_effect = lambda row: self.value(12)
        cache.refresh()
        self.assertFalse(cache.snapshot()["errors"])
        self.assertEqual(cache.snapshot()["sessions"]["mooby:one"]["available"], 12)

    def test_unknown_failure_is_not_zero_and_repeated_errors_stop_requests(self):
        self.write_rows(*(self.row(str(i)) for i in range(12)))
        self.fetcher.fetch.side_effect = ValueError("blocked")
        cache = self.manager()
        cache.refresh()
        self.assertEqual(self.fetcher.fetch.call_count, 5)
        self.assertEqual(cache.snapshot()["sessions"], {})
        self.assertEqual(len(cache.snapshot()["errors"]), 12)
        with closing(sqlite3.connect(cache.history.path)) as db:
            self.assertEqual(dict(db.execute('SELECT status,count(*) FROM observation_history GROUP BY status')),
                             {'error': 5, 'skipped': 7})

    def test_unallocated_screenings_do_not_block_later_seat_maps(self):
        self.write_rows(*(self.row(str(i), 'verdi') for i in range(7)))
        previous = self.value(17)
        self.cache_path.write_text(json.dumps({'sessions': {'verdi:0': previous}}))
        self.now += 901
        self.fetcher.fetch.side_effect = [
            *(ScreeningAvailabilityUnavailable('Unallocated screening') for _ in range(6)),
            self.value(24),
        ]
        cache = self.manager()
        cache.refresh()
        self.assertEqual(self.fetcher.fetch.call_count, 7)
        self.assertEqual(cache.snapshot()['sessions']['verdi:0'], previous)
        self.assertEqual(cache.snapshot()['sessions']['verdi:6']['available'], 24)
        self.assertEqual(len(cache.snapshot()['errors']), 6)
        self.assertNotIn('verdi:1', cache.snapshot()['sessions'])
        with closing(sqlite3.connect(cache.history.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM observation_history WHERE status='unavailable'").fetchone()[0], 6)

    def test_reload_programme_picks_up_new_sessions_and_removes_old_ones(self):
        cache = self.manager()
        cache.refresh()
        self.write_rows(self.row("new"))
        cache.refresh()
        self.assertEqual(set(cache.snapshot()["sessions"]), {"mooby:new"})

    def test_phenomena_uses_one_bulk_request_and_missing_sessions_stay_unknown(self):
        self.write_rows(self.row("one", "phenomena"), self.row("two", "phenomena"))
        self.bulk.return_value = {"phenomena:one": self.value(42)}
        cache = self.manager()
        cache.refresh()
        self.bulk.assert_called_once()
        self.fetcher.fetch.assert_not_called()
        self.assertEqual(cache.snapshot()["sessions"]["phenomena:one"]["available"], 42)
        self.assertIn("phenomena:two", cache.snapshot()["errors"])
        self.assertNotIn("phenomena:two", cache.snapshot()["sessions"])

    def test_bad_programme_does_not_erase_cached_seats(self):
        cache = self.manager()
        cache.refresh()
        previous = cache.snapshot()["sessions"]
        self.programme.write_text("broken")
        with self.assertRaises(ValueError):
            cache.refresh()
        self.assertEqual(cache.snapshot()["sessions"], previous)

    def test_slow_later_request_does_not_hide_completed_counts(self):
        self.write_rows(self.row('one'), self.row('two'))
        entered, release = threading.Event(), threading.Event()
        def fetch(row):
            if row['id'] == 'mooby:two':
                entered.set()
                release.wait(2)
            return self.value(12)
        self.fetcher.fetch.side_effect = fetch
        cache = self.manager()
        thread = threading.Thread(target=cache.refresh)
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            saved = json.loads(self.cache_path.read_text())
            self.assertEqual(saved['sessions']['mooby:one']['available'], 12)
            self.assertNotIn('mooby:two', saved['sessions'])
        finally:
            release.set()
            thread.join(timeout=3)
        self.assertFalse(thread.is_alive())

    def test_read_only_preview_shutdown_cannot_overwrite_managed_cache(self):
        cache = self.manager()
        saved = {'sessions': {'mooby:one': self.value(25)}}
        self.cache_path.write_text(json.dumps(saved))
        cache.stop()
        self.assertEqual(json.loads(self.cache_path.read_text()), saved)


if __name__ == "__main__":
    unittest.main()
