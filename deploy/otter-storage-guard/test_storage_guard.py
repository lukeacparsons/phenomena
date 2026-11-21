import fcntl
import gzip
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import host_guard as guard
from cleanup_retry import reason_to_cleanup


class DiskTests(unittest.TestCase):
    def test_thresholds_include_absolute_free_space(self):
        self.assertEqual(guard.disk_level(74, 20 * guard.GIB), 0)
        self.assertEqual(guard.disk_level(75, 20 * guard.GIB), 1)
        self.assertEqual(guard.disk_level(85, 20 * guard.GIB), 2)
        self.assertEqual(guard.disk_level(50, 9 * guard.GIB), 1)
        self.assertEqual(guard.disk_level(50, 4 * guard.GIB), 2)

    def test_alert_escalation_cooldown_and_recovery_margin(self):
        now = 100000
        old = {'alert_level': 1, 'alert_sent_at': now - 20}
        self.assertFalse(guard.alert_decision(old, 1, now, []))
        self.assertTrue(guard.alert_decision(old, 2, now, []))
        self.assertFalse(guard.alert_decision(old, 0, now, [{'used_percent': 74, 'available_bytes': 20 * guard.GIB}]))
        self.assertTrue(guard.alert_decision(old, 0, now, [{'used_percent': 69, 'available_bytes': 20 * guard.GIB}]))

    def test_preflight_refuses_either_disk(self):
        with patch.object(guard, 'disks', return_value=[{'mount': '/mnt/volume', 'available_bytes': 4 * guard.GIB}]):
            with self.assertRaisesRegex(RuntimeError, 'Build refused'):
                guard.preflight({})


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config = {'legacy_stage_parents': [str(self.root / 'stages')],
                       'build_root': str(self.root / 'jobs'), 'queue_root': str(self.root / 'queue')}
        for p in self.config['legacy_stage_parents'] + [self.config['build_root'], self.config['queue_root']]:
            Path(p).mkdir()
        self.now = time.time()

    def tearDown(self):
        self.tmp.cleanup()

    def old(self, p, days=8):
        for f in [*p.rglob('*'), p] if p.is_dir() else [p]:
            if not f.is_symlink():
                os.utime(f, (self.now - days * 86400,) * 2)

    def stage(self, name='ojo-test-stage-20261020'):
        p = self.root / 'stages' / name
        p.mkdir()
        (p / 'source').mkdir()
        (p / 'source' / 'input.txt').write_text('generated build input')
        (p / 'release.json').write_text('{}')
        self.old(p)
        return p

    def test_only_old_named_payloads_removed_receipts_and_unknown_dirs_kept(self):
        p = self.stage()
        unknown = self.stage('application-data')
        recent = self.stage('ojo-recent-stage-20261121')
        os.utime(recent / 'source' / 'input.txt', None)
        with patch.object(guard, 'references', return_value=[]):
            result = guard.cleanup_payloads(self.config, [], apply=True, now=self.now)
        self.assertEqual(len(result['removed']), 1)
        self.assertFalse((p / 'source').exists())
        self.assertTrue((p / 'release.json').exists())
        self.assertTrue((unknown / 'source').exists())
        self.assertTrue((recent / 'source').exists())

    def test_open_files_and_bind_mounts_are_protected(self):
        p = self.stage()
        for refs in [[str(p / 'source' / 'input.txt')], [str(p)]]:
            with patch.object(guard, 'references', return_value=refs):
                result = guard.cleanup_payloads(self.config, [], apply=True, now=self.now)
                self.assertFalse(result['removed'])
                self.assertTrue((p / 'source').exists())

    def test_symlink_is_never_followed(self):
        p = self.stage()
        outside = self.root / 'valuable'
        outside.mkdir()
        (outside / 'data').write_text('preserve')
        (p / 'source.tar').symlink_to(outside, target_is_directory=True)
        with patch.object(guard, 'references', return_value=[]):
            guard.cleanup_payloads(self.config, [], apply=True, now=self.now)
        self.assertEqual((outside / 'data').read_text(), 'preserve')
        self.assertTrue((p / 'source.tar').is_symlink())

    def test_live_queue_lock_and_helper_skip_cleanup(self):
        p = self.stage()
        with (Path(self.config['queue_root']) / 'queue.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = guard.cleanup_payloads(self.config, [], apply=True)
            self.assertIn('active', result['skipped'])
        helper = {'Config': {'Image': 'coollabsio/coolify-helper:1.0'}, 'State': {'Status': 'running'}}
        result = guard.cleanup_payloads(self.config, [helper], apply=True)
        self.assertIn('Coolify', result['skipped'])
        self.assertTrue((p / 'source').exists())

    def test_dry_run_and_tree_change_never_delete(self):
        p = self.stage()
        with patch.object(guard, 'references', return_value=[]):
            result = guard.cleanup_payloads(self.config, [], now=self.now)
            self.assertEqual(len(result['candidates']), 1)
            meta = guard.tree_metadata(p / 'source')
            with patch.object(guard, 'tree_metadata', side_effect=[meta, {**meta, 'inode': meta['inode'] + 1}]):
                result = guard.cleanup_payloads(self.config, [], apply=True, now=self.now)
            self.assertFalse(result['removed'])
        self.assertTrue((p / 'source').exists())

    def test_queue_keeps_newest_two_and_pending_bundle(self):
        bundles = Path(self.config['queue_root']) / 'bundles'
        bundles.mkdir()
        paths = []
        for i in range(5):
            p = bundles / f'{i}-abcdef012345-12345678'
            (p / 'artifact').mkdir(parents=True)
            (p / 'artifact' / 'bundle').write_text('compiled')
            self.old(p, 20 - i)
            paths.append(p)
        (Path(self.config['queue_root']) / 'queue-state.json').write_text(json.dumps({'pending': {'bundle': str(paths[0])}}))
        with patch.object(guard, 'references', return_value=[]):
            result = guard.cleanup_payloads(self.config, [], apply=True, now=self.now)
        self.assertEqual(len(result['removed']), 2)
        for i in [0, 3, 4]:
            self.assertTrue((paths[i] / 'artifact').exists())

    def test_multiple_attempts_of_current_release_do_not_evict_rollback(self):
        bundles = Path(self.config['queue_root']) / 'bundles'
        bundles.mkdir()
        for seq, suffix in [(176, '11111111'), (177, '22222222'), (177, '33333333')]:
            p = bundles / f'{seq}-abcdef012345-{suffix}'
            (p / 'artifact').mkdir(parents=True)
            (p / 'artifact' / 'bundle').write_text('compiled')
            self.old(p)
        with patch.object(guard, 'references', return_value=[]):
            result = guard.cleanup_payloads(self.config, [], apply=True, now=self.now)
        self.assertEqual(result['removed'], [])


class RotationTests(unittest.TestCase):
    def test_completed_build_log_retention_preserves_receipt_and_other_files(self):
        with tempfile.TemporaryDirectory() as d:
            job = Path(d) / 'job'
            job.mkdir()
            receipt = {'status': 'failed', 'completed_at': time.time() - 31 * 86400}
            (job / 'receipt.json').write_text(json.dumps(receipt))
            (job / 'build.log').write_text('old diagnostics')
            (job / 'valuable.txt').write_text('keep')
            guard.rotate_build_logs({'build_root': d}, time.time())
            self.assertFalse((job / 'build.log').exists())
            self.assertTrue((job / 'receipt.json').exists())
            self.assertTrue((job / 'valuable.txt').exists())

    def test_rotation_bounds_size_and_keeps_three_copies(self):
        with tempfile.TemporaryDirectory() as d:
            path, archive = Path(d) / 'worker.log', Path(d) / 'archive' / 'worker.log'
            for i in range(5):
                path.write_bytes((f'line-{i}\n' * 100).encode())
                guard.rotate_file(path, archive, limit=100)
                self.assertEqual(path.stat().st_size, 0)
            self.assertEqual(len(list(archive.parent.glob('*.gz'))), 3)
            self.assertLessEqual(len(gzip.open(str(archive) + '.1.gz').read()), 100)

    def test_log_symlink_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / 'real').write_bytes(b'x' * 1000)
            (p / 'link').symlink_to(p / 'real')
            with self.assertRaises(OSError):
                guard.rotate_file(p / 'link', p / 'archive', limit=100)
            self.assertEqual((p / 'real').stat().st_size, 1000)


class RetryTests(unittest.TestCase):
    def info(self):
        return {'active_deployment': None, 'cleanup_running': False,
                'latest_deployment': {'id': 1, 'at': 9000},
                'latest_cleanup': {'status': 'success', 'started_at': 8000, 'skipped_cache': False}}

    def test_postdeployment_cleanup_and_cooldown(self):
        self.assertIsNotNone(reason_to_cleanup(self.info(), 0, 10000))
        self.assertIsNone(reason_to_cleanup(self.info(), 9900, 10000))

    def test_no_cleanup_during_build_or_running_cleanup(self):
        for key in ['active_deployment', 'cleanup_running']:
            info = self.info()
            info[key] = True
            self.assertIsNone(reason_to_cleanup(info, 0, 10000))

    def test_failed_and_skipped_runs_retry_without_new_deploy(self):
        for key, value in [('status', 'failed'), ('skipped_cache', True)]:
            info = self.info()
            info['latest_cleanup'].update(started_at=9500, **{key: value})
            self.assertIsNotNone(reason_to_cleanup(info, 0, 10000))

    def test_no_repeat_after_success_and_debounce_new_deploy(self):
        info = self.info()
        info['latest_cleanup']['started_at'] = 9500
        self.assertIsNone(reason_to_cleanup(info, 0, 10000))
        info['latest_deployment']['at'] = 9950
        self.assertIsNone(reason_to_cleanup(info, 0, 10000))


if __name__ == '__main__':
    unittest.main()
