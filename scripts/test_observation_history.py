from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from availability_cache import AvailabilityCache
from crawler_run import CrawlRun
from observation_history import ObservationHistory, micros


NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)


def row(**extra):
    return {'id': 'mooby:123', 'provider': 'mooby', 'provider_session_id': '123',
            'cinema_id': 'balmes', 'film_id': '456', 'title': 'Film', 'room': '1',
            'starts_at': (NOW + timedelta(days=1)).isoformat(), 'original_audio': True, **extra}


def seats(count=42, checked=NOW):
    return {'kind': 'ordinary', 'available': count, 'capacity': 100, 'checked_at': checked.isoformat()}


def price(amount=8, checked=NOW):
    return {'amount': amount, 'currency': 'EUR', 'kind': 'published_event_price',
            'source_url': 'https://example.com/film', 'checked_at': checked.isoformat()}


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.history = ObservationHistory(self.root)

    def query(self, sql='SELECT * FROM observation_history ORDER BY collected_at_us, id'):
        with closing(sqlite3.connect(self.history.path)) as db:
            db.row_factory = sqlite3.Row
            return [dict(r) for r in db.execute(sql)]

    def test_unchanged_checks_share_states_but_preserve_every_timestamp(self):
        # Includes repeated cached upstream timestamps, and repeated counts with
        # fresh timestamps. Both are legitimate checks, not new copies of JSON.
        for i in range(96):
            at = NOW + timedelta(minutes=15*i)
            self.history.record_availability(row(), seats(42, NOW if i < 48 else at), collected_at=at.isoformat())
        self.assertEqual(self.query('SELECT count(*) AS n FROM samples')[0]['n'], 96)
        self.assertEqual(self.query('SELECT count(*) AS n FROM states')[0]['n'], 1)
        self.assertEqual(self.query('SELECT count(*) AS n FROM screenings')[0]['n'], 1)
        samples = self.query()
        self.assertEqual(len({s['collected_at_us'] for s in samples}), 96)
        self.assertEqual(samples[47]['checked_at_us'], micros(NOW.isoformat()))
        self.assertEqual(samples[-1]['checked_at_us'], micros(at.isoformat()))

    def test_changes_released_seats_and_zero_are_retained_with_screening_context(self):
        for i, count in enumerate([42, 39, 40, 0]):
            at = NOW + timedelta(minutes=i*15)
            self.history.record_availability(row(), seats(count, at), collected_at=at.isoformat())
        records = self.query()
        self.assertEqual([json.loads(r['value_json'])['available'] for r in records], [42, 39, 40, 0])
        self.assertEqual(json.loads(records[-1]['context_json'])['cinema_id'], 'balmes')
        self.assertTrue(all(r['status'] == 'ok' for r in records))

    def test_room_changes_get_new_dimensions_without_rewriting_old_history(self):
        for i, room in enumerate(['1', '2']):
            self.history.record_availability(row(room=room), seats(), collected_at=(NOW+timedelta(minutes=i)).isoformat())
        self.assertEqual([json.loads(r['context_json'])['room'] for r in self.query()], ['1', '2'])

    def test_seed_is_idempotent_preserves_original_times_and_does_not_invent_missing_times(self):
        programme = {'films': [{'sessions': [row(price_data=price(), seat_data=seats())]}]}
        cache = {'sessions': {'mooby:123': seats(30, NOW+timedelta(minutes=15))}}
        for _ in range(2):
            ObservationHistory(self.root).seed(programme, cache)
        records = self.query()
        self.assertEqual(len(records), 3)
        self.assertTrue(all(r['origin'] == 'bootstrap' for r in records))
        self.assertTrue(all(r['collected_at_us'] == r['checked_at_us'] for r in records))
        self.history.seed({'films': [{'sessions': [row(price_data={'amount': 8}, seat_data={'available': 12})]}]})
        self.assertEqual(len(self.query()), 3)

    def test_restart_seed_does_not_duplicate_real_observations(self):
        self.history.record_availability(row(), seats(), collected_at=NOW.isoformat())
        self.history.seed({'films': [{'sessions': [row(seat_data=seats())]}]})
        self.assertEqual(len(self.query()), 1)

    def test_source_and_assembled_context_share_the_same_identity(self):
        source = row(room='01', version='vose')
        self.history.record_availability(source, seats(), collected_at=NOW.isoformat())
        published = row(room='1', version='VOSE', starts_at=source['starts_at'].replace('12:00:00+00:00', '13:00:00+01:00'))
        self.history.seed({'films': [{'sessions': [{**published, 'seat_data': seats()}]}]})
        self.assertEqual(len(self.query()), 1)

    def test_catalogue_prices_ranges_options_and_unknowns_are_preserved(self):
        fare = {'currency': 'EUR', 'minimum': 6, 'maximum': 10, 'options': [{'label': 'GENERAL', 'amount': 10}],
                'fees': 'unknown', 'source_url': 'https://example.com/prices'}
        for i, data in enumerate([fare, fare, None]):
            at = NOW + timedelta(hours=i)
            report = {'fetched_at': at.isoformat(), 'sessions': [row(**({'price_data': data} if data else {}))]}
            self.history.record_catalogue(report, collected_at=at.isoformat())
        records = self.query()
        self.assertEqual([r['status'] for r in records], ['ok', 'ok', 'not_reported'])
        self.assertEqual(json.loads(records[0]['value_json']), fare)
        self.assertIsNone(records[-1]['value_json'])
        self.assertEqual(self.query('SELECT count(*) AS n FROM states')[0]['n'], 1)

    def test_accepted_sources_are_logged_immediately_and_failed_sources_do_not_refresh_prices(self):
        run = CrawlRun(self.root, None, NOW, monotonic=lambda: 0)
        run.collect(['balmes'], lambda: {'provider': 'mooby', 'fetched_at': NOW.isoformat(),
                                        'sessions': [row(price_data=price(), seat_data=seats())]})
        self.assertEqual(len(self.query()), 2)  # Before finish/publication.
        run.collect(['balmes'], Mock(side_effect=TimeoutError()))
        self.assertEqual(len(self.query()), 2)
        # A replay of the same acquired report is idempotent.
        self.history.record_catalogue(run.reports[0], collected_at=NOW.isoformat())
        self.assertEqual(len(self.query()), 2)

    def test_storage_failure_is_not_misreported_as_provider_failure(self):
        run = CrawlRun(self.root, None, NOW, monotonic=lambda: 0)
        with patch.object(run.history, 'record_catalogue', side_effect=sqlite3.OperationalError('disk full')):
            with self.assertRaises(sqlite3.OperationalError):
                run.collect(['balmes'], lambda: {'fetched_at': NOW.isoformat(), 'sessions': [row(price_data=price())]})
        self.assertFalse(run.reports)
        self.assertFalse(run.failures)

    def test_independent_concurrent_writers_do_not_lose_checks(self):
        def write(i):
            history = ObservationHistory(self.root)
            history.record_availability(row(), seats(), collected_at=(NOW+timedelta(seconds=i)).isoformat())
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(write, range(40)))
        self.assertEqual(len(self.query()), 40)
        self.assertEqual(self.query('PRAGMA integrity_check'), [{'integrity_check': 'ok'}])

    def test_separate_processes_share_a_new_database(self):
        code = '''import sys
from observation_history import ObservationHistory
h=ObservationHistory(sys.argv[1])
for i in range(20):
    h.record_availability({'id':sys.argv[2]}, {'available':42,'checked_at':'2026-11-21T12:00:00Z'},
                          collected_at=f'2026-11-21T12:00:{i:02d}Z')
'''
        children = [subprocess.Popen([sys.executable, '-c', code, str(self.root), str(i)],
                                     cwd=Path(__file__).parent, stderr=subprocess.PIPE) for i in range(4)]
        for child in children:
            _, stderr = child.communicate(timeout=15)
            self.assertEqual(child.returncode, 0, stderr.decode())
        self.assertEqual(len(self.query()), 80)

    def test_seat_cache_retains_history_after_expiry_and_failures_are_not_new_counts(self):
        programme = self.root / 'screenings.json'
        programme.write_text(json.dumps({'films': [{'sessions': [row()]}]}))
        fetcher = Mock()
        fetcher.__enter__ = Mock(return_value=fetcher)
        fetcher.__exit__ = Mock(return_value=False)
        clock = [NOW.timestamp()]
        fetcher.fetch.return_value = seats()
        cache = AvailabilityCache(programme, self.root/'availability.json', clock=lambda: clock[0],
                                  fetcher_factory=lambda: fetcher)
        self.assertFalse(self.history.path.exists())  # Read-only previews don't write.
        cache.refresh()
        clock[0] += 901
        fetcher.fetch.side_effect = ValueError('secret-bearing URL')
        cache.refresh()
        records = self.query()
        self.assertEqual([r['status'] for r in records], ['ok', 'error'])
        self.assertIsNone(records[1]['checked_at_us'])
        self.assertEqual(json.loads(records[1]['value_json']), {'reason': 'ValueError'})
        self.assertEqual(cache.snapshot()['sessions'][row()['id']], seats())
        programme.write_text('{"films":[]}')
        cache.refresh()
        self.assertFalse(cache.snapshot()['sessions'])
        self.assertEqual(len(self.query()), 2)

    def test_history_commit_failure_cannot_advance_latest_seat_cache(self):
        programme = self.root/'screenings.json'
        programme.write_text(json.dumps({'films': [{'sessions': [row()]}]}))
        cache = AvailabilityCache(programme, self.root/'availability.json', clock=lambda: NOW.timestamp())
        with patch.object(cache.history, 'record_availability', side_effect=sqlite3.OperationalError('disk full')):
            with self.assertRaises(sqlite3.OperationalError):
                cache._record(row(), seats())
        self.assertFalse(cache.snapshot()['sessions'])

    def test_backup_and_filtered_csv_export(self):
        self.history.record_availability(row(), seats(), collected_at=NOW.isoformat())
        script = str(Path(__file__).with_name('observation_history.py'))
        command = [sys.executable, script, '--data-dir', str(self.root)]
        csv = subprocess.check_output([*command, 'export', '--session', row()['id'], '--metric', 'availability'], text=True)
        self.assertEqual(len(csv.splitlines()), 2)
        self.assertIn(NOW.isoformat(), csv)
        backup = self.root/'backup.sqlite3'
        subprocess.run([*command, 'backup', str(backup)], check=True)
        with closing(sqlite3.connect(backup)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM samples').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
