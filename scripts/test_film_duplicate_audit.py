"""Regression coverage for the five BTS cards and review-only approximate matches."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from film_duplicate_audit import duplicate_candidates, main
from film_grouping import deduplicate_programme
from programme_store import update_programme
from site_identity import LOCALES, new_registry, path_for, resolve, update_registry
from test_film_grouping import film


def bts_programme():
    return json.loads(Path(__file__).with_name('fixtures').joinpath('bts-duplicate-cards.json').read_text())


class DuplicateAuditTests(unittest.TestCase):
    def test_bts_five_cards_become_two_with_every_booking_and_old_link(self):
        data = bts_programme()
        original = copy.deepcopy(data)
        sessions = {s['id']: s for f in data['films'] for s in f['sessions']}
        registry = update_registry(new_registry(), data, [], data['generated_at'])
        paths = {f['id']: {lang: path_for(resolve(registry, 'films', f['id']), lang) for lang in LOCALES}
                 for f in data['films']}
        summary = deduplicate_programme(data)
        self.assertEqual(summary['merged'], 3)
        self.assertEqual({f['id']: len(f['sessions']) for f in data['films']},
                         {'imdb:tt50486016': 10, 'imdb:tt50488328': 6})
        self.assertEqual({s['id']: s for f in data['films'] for s in f['sessions']}, sessions)
        kaohsiung = next(f for f in data['films'] if f['id'] == 'imdb:tt50486016')
        self.assertIn('KAOHSIUNG', kaohsiung['title'])
        self.assertEqual(kaohsiung['ratings']['imdb']['url'], 'https://www.imdb.com/title/tt50486016/')
        merged_registry = update_registry(registry, data, [], data['generated_at'])
        for old in original['films']:
            match = next(f for f in data['films'] if old['id'] in [f['id'], *f.get('merged_ids', [])])
            record = resolve(merged_registry, 'films', match['id'])
            self.assertEqual(resolve(merged_registry, 'films', old['id']), record)
            for lang, path in paths[old['id']].items():
                self.assertEqual(merged_registry['redirects'].get(path, path), path_for(record, lang))
        self.assertEqual(duplicate_candidates(data), [])
        before = copy.deepcopy(data)
        deduplicate_programme(data)
        self.assertEqual(data, before)

    def test_unreviewed_bts_variants_are_reported_but_never_fuzzy_merged(self):
        data = bts_programme()
        before = copy.deepcopy(data)
        candidates = duplicate_candidates(data, reviewed={})
        self.assertEqual(len(candidates), 4)
        self.assertTrue(any('truncated_title' in c['reasons'] for c in candidates))
        self.assertEqual(data, before)
        deduplicate_programme(data, reviewed={})
        self.assertEqual(len(data['films']), 5)

    def test_missing_descriptors_and_minor_typos_work_for_other_events(self):
        data = {'films': [film('cinema:1', 'An Evening at the Theatre: Live Viewing', 'a', runtime_minutes=110),
                          film('cinema:2', 'An Evening at the Theatre', 'b', runtime_minutes=110),
                          film('cinema:3', 'An Evening at the Theater', 'c', runtime_minutes=110)]}
        self.assertEqual(len(duplicate_candidates(data, reviewed={})), 3)

    def test_editions_remakes_sequels_and_conflicting_facts_are_not_candidates(self):
        base = film('cinema:1', 'A very long concert title 2026', 'a', runtime_minutes=120,
                    release_year=2026, details={'directors': ['Director One']})
        variants = [film('edition:live', base['title'], 'b'),
                    film('cinema:2', 'A very long concert title 2025', 'c'),
                    film('cinema:3', base['title'], 'd', runtime_minutes=180),
                    film('cinema:4', base['title'], 'e', release_year=1990),
                    film('cinema:5', base['title'], 'f', details={'directors': ['Director Two']})]
        for other in variants:
            with self.subTest(other=other['id']):
                self.assertEqual(duplicate_candidates({'films': [base, other]}, reviewed={}), [])
        a = film('imdb:tt0000001', base['title'], 'a')
        b = film('imdb:tt0000002', base['title'], 'b')
        self.assertEqual(duplicate_candidates({'films': [a, b]}, reviewed={}), [])

    def test_metadata_transactions_apply_confirmed_merges_and_update_both_projections(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'screenings.json'
            path.write_text(json.dumps(bts_programme()))
            with patch('sys.argv', ['film_duplicate_audit', '--input', str(path), '--check']), patch('builtins.print'):
                self.assertEqual(main(), 1, 'A stale five-card snapshot still needs the confirmed merges applied')
            update_programme(path, lambda data: data)
            for name in ('screenings.json', 'programme.json'):
                saved = json.loads((path.parent / name).read_text())
                self.assertEqual(len(saved['films']), 2)
                self.assertEqual(sum(len(f['sessions']) for f in saved['films']), 16)
            audit = json.loads((path.parent / 'film-duplicates.json').read_text())
            self.assertEqual(audit['candidate_count'], 0)
            with patch('sys.argv', ['film_duplicate_audit', '--input', str(path), '--check']), patch('builtins.print'):
                self.assertEqual(main(), 0)

    def test_audit_is_written_and_check_fails_until_identity_is_reviewed(self):
        data = {'cinemas': [], 'films': [film('cinema:1', 'An Evening at the Theatre: Live Viewing', 'a'),
                                        film('cinema:2', 'An Evening at the Theatre', 'b')]}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'screenings.json'
            with patch('builtins.print') as logged:
                update_programme(path, lambda _: data)
                self.assertIn('film_duplicate_candidates', logged.call_args.args[0])
            self.assertEqual(json.loads((path.parent / 'film-duplicates.json').read_text())['candidate_count'], 1)
            with patch('sys.argv', ['film_duplicate_audit', '--input', str(path), '--check']), patch('builtins.print'):
                self.assertEqual(main(), 1)
            data['films'].pop()
            update_programme(path, lambda _: data)
            self.assertEqual(json.loads((path.parent / 'film-duplicates.json').read_text())['candidate_count'], 0)
            with patch('sys.argv', ['film_duplicate_audit', '--input', str(path), '--check']), patch('builtins.print'):
                self.assertEqual(main(), 0)


if __name__ == '__main__':
    unittest.main()
