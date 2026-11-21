import copy
from datetime import datetime, timezone
import unittest

from screening_context import upcoming, shared_language, shared_version, examples, related_guides


NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)


def pair(**overrides):
    return ({'id': 'film', 'title': 'A film', 'details': {'languages': ['English']}},
            {'id': 'session', 'cinema_id': 'cinema', 'starts_at': '2026-11-21T15:00:00+01:00',
             'version': 'VOSE', **overrides})


class ScreeningContextTests(unittest.TestCase):
    def test_language_claims_require_all_sessions_and_keep_audio_separate(self):
        self.assertIsNone(shared_language([pair(subtitles='English')], 'language'))
        self.assertIsNone(shared_language([pair(language='Other languages')], 'language'))
        self.assertEqual(shared_language([pair(language='EN'), pair(language='English')], 'language'), 'English')
        for value in (None, 'French', 'English, French', 'English, unidentified'):
            self.assertIsNone(shared_language([pair(language='EN'), pair(language=value)], 'language'))
        self.assertEqual(shared_language([pair(language='FR', subtitles='Español')], 'subtitles'), 'Spanish')

    def test_expiry_sorting_and_examples_keep_each_exact_screening(self):
        early = pair(id='early', starts_at='2026-11-21T14:30:00+01:00')
        late = pair(id='late', starts_at='2026-11-21T14:00:00Z')
        expired = pair(id='expired', starts_at=NOW.isoformat())
        rows = upcoming([late, expired, early], NOW)
        self.assertEqual([s['id'] for _, s in rows], ['early', 'late'])
        self.assertEqual(examples(rows, film_page=True), [early])
        many = [(dict(early[0], id=str(i)), dict(early[1], id=str(i))) for i in range(8)]
        self.assertEqual(len(examples(many, film_page=False)), 6)

    def test_version_metadata_does_not_generalize_mixed_or_unconfirmed_labels(self):
        self.assertEqual(shared_version([pair(), pair(version='vose')]), 'VOSE')
        for value in (None, 'VO', 'Dubbed', 'VOSE / dubbed'):
            self.assertIsNone(shared_version([pair(), pair(version=value)]))
        self.assertIsNone(shared_version([]))

    def test_guides_follow_their_actual_language_format_and_date_rules(self):
        source = [pair(subtitles='English', formats=['IMAX', '35mm'])]
        before = copy.deepcopy(source)
        self.assertEqual(related_guides(source, NOW), ['subtitles', 'imax', 'film'])
        self.assertEqual(source, before)
        self.assertEqual(related_guides([pair(language='EN', subtitles='Català')], NOW), ['english', 'vosc'])
        self.assertNotIn('english', related_guides([pair(language='EN', starts_at='2026-12-20T18:00:00+01:00')], NOW))
        self.assertEqual(related_guides([pair(version='VOSE')], NOW), [])


if __name__ == '__main__':
    unittest.main()
