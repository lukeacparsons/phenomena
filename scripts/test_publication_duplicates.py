"""A suspected duplicate cannot replace a good release or pass the uploader."""

import copy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from build_public_site import build
from film_duplicate_audit import DuplicateFilmsError, duplicate_candidates
from publish_hetzner import publish
from public_build import build as watched_build
from test_film_duplicate_audit import bts_programme
from test_film_grouping import film


NOW = datetime(2026, 11, 20, 22, tzinfo=timezone.utc)


class PublicationDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = bts_programme()
        self.data['cinemas'] = [{'id': cid, 'name': cid, 'url': 'https://cinema.example'}
                               for cid in sorted({s['cinema_id'] for f in self.data['films'] for s in f['sessions']})]
        self.docs = self.root / 'docs'
        self.docs.mkdir()
        (self.docs / 'cinema-dossiers.json').write_text(json.dumps({'cinemas': [], 'sources': {}}))
        (self.docs / 'auditoriums.json').write_text(json.dumps({'rooms': [], 'sources': {}}))
        self.input = self.root / 'screenings.json'
        self.output = self.root / '.site'
        self.registry = self.root / 'registry.json'

    def build(self, data):
        self.input.write_text(json.dumps(data))
        return build(programme_path=self.input, output=self.output, registry_path=self.registry,
                     docs=self.docs, now=NOW)

    def test_unknown_bts_variants_block_before_any_publication_or_registry_change(self):
        good = copy.deepcopy(self.data)
        good['films'] = [f for f in good['films'] if f['id'] == 'imdb:tt50486016']
        self.build(good)
        previous = (self.output / 'current').resolve()
        registry = self.registry.read_bytes()
        programme = (previous / 'public/programme.json').read_bytes()
        # Simulate a new event with no event-specific mappings yet.
        with patch('film_grouping.reviewed_identities', return_value={}), \
             patch('film_duplicate_audit.reviewed_identities', return_value={}), \
             patch('build_public_site.prepare_images') as images:
            with self.assertRaisesRegex(DuplicateFilmsError, '4 unresolved pairs'):
                self.build(self.data)
            images.assert_not_called()
        self.assertEqual((self.output / 'current').resolve(), previous)
        self.assertEqual(self.registry.read_bytes(), registry)
        self.assertEqual((previous / 'public/programme.json').read_bytes(), programme)
        report = json.loads((self.output / 'film-duplicates.json').read_text())
        self.assertEqual(report['status'], 'blocked')
        self.assertEqual(report['candidate_count'], 4)
        self.assertEqual(json.loads(self.input.read_text()), self.data, 'Collector evidence stays untouched')
        # A reviewed resolution unblocks the same input without disabling the gate.
        self.build(self.data)
        current = json.loads((self.output / 'current/public/programme.json').read_text())
        self.assertEqual({f['id']: len(f['sessions']) for f in current['films']},
                         {'imdb:tt50486016': 10, 'imdb:tt50488328': 6})
        self.assertEqual(json.loads((self.output / 'film-duplicates.json').read_text())['status'], 'ok')

    def test_manual_upload_rejects_an_older_ungrouped_artifact_before_network_access(self):
        release = self.output / 'releases/old'
        (release / 'public').mkdir(parents=True)
        (release / 'public/programme.json').write_text(json.dumps(self.data))
        (release / 'manifest.json').write_text(json.dumps({'built_at': NOW.isoformat()}))
        (self.output / 'current').symlink_to('releases/old')
        with patch('publish_hetzner.ROOT', self.root), patch('publish_hetzner.subprocess.run') as network:
            with self.assertRaisesRegex(DuplicateFilmsError, 'rebuild required: True'):
                publish({})
            network.assert_not_called()
        report = json.loads((self.root / 'output/hetzner-publisher/film-duplicates.json').read_text())
        self.assertEqual(report['confirmed_merges'], 3)
        self.assertFalse((self.root / 'output/hetzner-publisher/last-release.json').exists())

    def test_distinct_review_only_clears_the_exact_id_and_title_pair(self):
        left = film('source:one', 'An Evening at the Theatre', 'a')
        right = film('source:two', 'An Evening at the Theater', 'b')
        data = {'films': [left, right]}
        review = [{'films': [{'id': f['id'], 'title': f['title']} for f in data['films']],
                   'reviewed_at': '2026-11-20', 'reason': 'Different productions confirmed on the source pages',
                   'source_urls': ['https://cinema.example/one', 'https://cinema.example/two']}]
        path = self.root / 'distinct-pairs.json'
        path.write_text(json.dumps(review))
        self.assertEqual(len(duplicate_candidates(data)), 1)
        with patch('film_duplicate_audit.DISTINCT_PAIRS', path):
            self.assertEqual(duplicate_candidates(data), [])
            right['id'] = 'source:three'
            self.assertEqual(len(duplicate_candidates(data)), 1)
            right['id'] = 'source:two'
            right['title'] += ': Live Viewing'
            self.assertEqual(len(duplicate_candidates(data)), 1)

    def test_an_incomplete_distinct_review_cannot_silence_a_candidate(self):
        path = self.root / 'distinct-pairs.json'
        path.write_text(json.dumps([{'films': []}]))
        with patch('film_duplicate_audit.DISTINCT_PAIRS', path):
            with self.assertRaisesRegex(ValueError, 'require two IDs/titles'):
                duplicate_candidates({'films': []})

    def test_watcher_logs_the_review_report_path_when_the_build_is_rejected(self):
        reason = 'Film identity check blocked publication. Review .site/film-duplicates.json\n'
        failure = subprocess.CalledProcessError(1, 'builder', stderr=reason)
        output = io.StringIO()
        with patch('public_build.subprocess.run', side_effect=failure), patch('sys.stderr', output):
            with self.assertRaises(subprocess.CalledProcessError):
                watched_build(output=self.output)
        self.assertIn('.site/film-duplicates.json', output.getvalue())


if __name__ == '__main__':
    unittest.main()
