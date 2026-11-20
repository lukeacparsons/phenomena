"""Runtime failure tests: scheduling, publication, heartbeat and cancellation."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import threading
import urllib.request
import urllib.error
from functools import partial
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

from build_cinema_preview import CINEMAS, refresh_catalogues
from crawler_health import POLICY
from crawler_monitor import publish_health
from crawler_sources import collect_sources
from public_refresh import last_collection_time, stop_process
from test_crawler_robustness import programme, session, report, NOW
from serve_preview import Handler
from install_crawler_service import configuration


class RuntimeTests(unittest.TestCase):
    def test_long_lived_publisher_uses_current_generator_on_each_build(self):
        import public_build
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'scripts').mkdir()
            generator = root / 'scripts/build_public_site.py'
            # Both calls use the same already imported wrapper; only its child
            # generator changes, as happens during a deployment.
            with patch.object(public_build, 'ROOT', root):
                for count in (1217, 1226):
                    generator.write_text(f'import json; print(json.dumps({{"pages": {count}}}))\n')
                    self.assertEqual(public_build.build(output=root / 'site')['pages'], count)

    def test_service_uses_the_tested_node_and_checkout(self):
        config = configuration(Path('/example/checkout'), '/example/node/bin/node')
        self.assertTrue(config['EnvironmentVariables']['PATH'].startswith('/example/node/bin:'))
        self.assertEqual(config['ProgramArguments'][0], '/example/checkout/.venv/bin/python')
        self.assertTrue(config['KeepAlive'])

    def test_preview_reads_updates_from_managed_cache_without_provider_requests(self):
        class QuietHandler(Handler):
            def log_message(self, *args):
                pass
        with tempfile.TemporaryDirectory() as folder, patch('serve_preview.STATIC', Path(folder)):
            path = Path(folder) / 'preview-data'
            path.mkdir()
            server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
            server.no_background = True
            server.public_site = False
            server.availability = Mock()
            server.availability.snapshot.return_value = {'sessions': {'one': {'available': 99}}}
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for count in [12, 7]:
                    (path / 'availability.json').write_text(json.dumps({'sessions': {'one': {'available': count}}}))
                    with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/preview/availability?session=one') as response:
                        self.assertEqual(json.load(response)['available'], count)
                with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/preview/health') as response:
                    self.assertEqual(len(json.load(response)['cinemas']), len(CINEMAS))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_all_cinemas_have_a_collection_job_and_monitoring_policy(self):
        registered = []
        run = Mock(now=NOW, previous=None)
        run.collect.side_effect = lambda ids, collector: registered.extend(ids)
        collect_sources(Mock(), run)
        expected = [c['id'] for c in CINEMAS]
        self.assertEqual(sorted(registered), sorted(expected))
        self.assertEqual(sorted(c['id'] for c in json.loads(POLICY.read_text())['cinemas']), sorted(expected))
        self.assertEqual(len(registered), len(set(registered)))

    def test_private_history_and_sqlite_sidecars_are_not_served_by_legacy_preview(self):
        class QuietHandler(Handler):
            def log_message(self, *args):
                pass
        with tempfile.TemporaryDirectory() as folder, patch('serve_preview.STATIC', Path(folder)):
            root = Path(folder)
            private = root / 'preview-data/history'
            private.mkdir(parents=True)
            for name in ('observations.sqlite3', 'observations.sqlite3-wal', 'observations.sqlite3-shm'):
                (private / name).write_text('private')
            (root / 'linked.sqlite3').symlink_to(private / 'observations.sqlite3')
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=folder))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for path in ('/preview-data/history/observations.sqlite3', '/preview-data/%68istory/observations.sqlite3-wal',
                             '/preview-data/history/observations.sqlite3-shm', '/linked.sqlite3'):
                    for method in ('GET', 'HEAD'):
                        request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}{path}', method=method)
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            urllib.request.urlopen(request)
                        self.assertEqual(error.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_metadata_file_writes_cannot_postpone_collection(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'screenings.json'
            data = programme()
            data['generated_at'] = datetime.now(timezone.utc).isoformat()
            path.write_text(json.dumps(data))
            os.utime(path, None)
            self.assertEqual(last_collection_time(path), NOW.timestamp())
            finish = NOW + timedelta(minutes=40)
            (path.parent / 'crawl-attempts.json').write_text(json.dumps({'last_run': {'finished_at': finish.isoformat(), 'status': 'partial'}}))
            self.assertEqual(last_collection_time(path), finish.timestamp())

    def test_invalid_or_future_attempt_does_not_defer_retries(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'screenings.json'
            path.write_text(json.dumps(programme()))
            future = datetime.now(timezone.utc) + timedelta(days=30)
            (path.parent / 'crawl-attempts.json').write_text(json.dumps({'last_run': {'finished_at': future.isoformat()}}))
            self.assertEqual(last_collection_time(path), NOW.timestamp())

    def test_cancel_terminates_and_reaps_real_child(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], start_new_session=True)
        stop_process(process)
        self.assertIsNotNone(process.returncode)

    def test_timeout_escalates_to_kill_and_reaps(self):
        process = Mock(pid=987654)
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('test', 5), -9]
        with patch('public_refresh.os.killpg') as kill:
            stop_process(process)
        self.assertEqual(kill.call_count, 2)
        self.assertEqual(process.wait.call_count, 2)

    def test_failed_heartbeat_keeps_last_success_and_retries(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            ok = Mock()
            first = publish_health(path, runner=ok)
            self.assertEqual(first['status'], 'ok')
            command = ok.call_args.args[0]
            self.assertIn('--remote', command)
            self.assertIn('vobarna:crawler-health', command)
            failed = Mock(side_effect=subprocess.TimeoutExpired('hidden command', 60))
            second = publish_health(path, runner=failed)
            self.assertEqual(second['status'], 'error')
            self.assertEqual(second['last_success'], first['last_success'])
            third = publish_health(path, runner=ok)
            self.assertEqual(third['status'], 'ok')
            self.assertNotIn('error', third)

    def test_partial_refresh_commits_before_optional_artwork_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'screenings.json'
            # Use live-relative dates so the real refresh clock sees future rows.
            future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
            old = programme([session('a', starts_at=future), session('b', starts_at=future)])
            path.write_text(json.dumps(old))
            def sources(http, run, **kwargs):
                run.collect(['a'], Mock(side_effect=TimeoutError()))
                run.collect(['b'], lambda: report('b', [session('b', 'new', starts_at=future)], fetched_at=run.now.isoformat()))
            with patch('crawler_sources.collect_sources', side_effect=sources), patch('build_cinema_preview.collect_posters', side_effect=ValueError('artwork failure')):
                code = refresh_catalogues(path.parent)
            fresh = json.loads(path.read_text())
            rows = {r['id']: r for f in fresh['films'] for r in f['sessions']}
            self.assertEqual(code, 2)
            self.assertIn('b:new', rows)
            self.assertNotIn('b:1', rows)
            self.assertEqual(rows['a:1'], next(r for f in old['films'] for r in f['sessions'] if r['id']=='a:1'))
            self.assertEqual(json.loads((path.parent / 'crawl-attempts.json').read_text())['last_run']['status'], 'partial')

    def test_total_failure_preserves_snapshot_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'screenings.json'
            original = json.dumps(programme())
            path.write_text(original)
            def sources(http, run, **kwargs):
                run.collect(['a'], Mock(side_effect=TimeoutError()))
            with patch('crawler_sources.collect_sources', side_effect=sources), self.assertRaises(ValueError):
                refresh_catalogues(path.parent)
            self.assertEqual(path.read_text(), original)
            self.assertEqual(json.loads((path.parent / 'crawl-attempts.json').read_text())['last_run']['status'], 'publication_failed')


if __name__ == '__main__':
    unittest.main()
