import unittest
from datetime import datetime, timezone
from browser_programme import browser_programme
from search_evidence import session_evidence, confirmed_no_subtitles, public_venue_answers
from film_details import parse_wikidata
from site_identity import update_registry, new_registry


class SearchEvidenceTests(unittest.TestCase):
    def test_session_labels_preserve_the_exact_performance_scope(self):
        row = {'id': 'one', 'source_url': 'https://cinema.example/one', 'title': 'Restored edition + Q&A',
               'schedule_fetched_at': '2026-11-21T12:00:00Z', 'raw_attributes': '2D,nosubt,English'}
        facts = session_evidence(row)
        self.assertEqual({f['value'] for f in facts}, {'restored', 'q&a'})
        self.assertTrue(all(f['session_id'] == 'one' and f['source_url'] == row['source_url'] for f in facts))
        self.assertTrue(confirmed_no_subtitles(row))
        self.assertFalse(confirmed_no_subtitles({'subtitles': None, 'version': 'VO'}))
        self.assertEqual(session_evidence({**row, 'title': 'Film', 'synopsis': 'The plot involves a director Q&A.'}), [])

    def test_public_projection_keeps_price_provenance_without_raw_provider_records(self):
        row = {'id': 'one', 'starts_at': '2099-01-01T18:00:00+01:00', 'source_url': 'https://cinema.example/',
               'price_data': {'amount': 8, 'kind': 'general_admission', 'fees': 'unknown'},
               'raw_attributes': '2D,nosubt,English', 'secret_provider_state': 'not public'}
        projected = browser_programme({'films': [{'id': 'film', 'sessions': [row]}]})['films'][0]['sessions'][0]
        self.assertEqual(projected['price_data'], row['price_data'])
        self.assertTrue(projected['subtitles_confirmed_none'])
        self.assertNotIn('raw_attributes', projected)
        self.assertNotIn('secret_provider_state', projected)

    def test_venue_answers_retain_scope_conflicts_and_source_urls(self):
        research = {'sources': {'source': {'title': 'Official FAQ', 'url': 'https://cinema.example/faq'}},
                    'claims': {'claim': {'value': 'Step-free entrance.', 'source_ids': ['source'],
                                         'scope': 'Entrance only.', 'status': 'published', 'observed_on': '2026-11-21'}},
                    'venues': [{'id': 'one', 'name': 'Cinema', 'answers': [{'question_id': 'accessibility',
                        'claim_ids': ['claim'], 'conflicting_claim_ids': ['claim'], 'unresolved': ['Room route unknown.']}]}]}
        answer = public_venue_answers(research)[0]['answers'][0]
        self.assertTrue(answer['passages'][0]['conflicting'])
        self.assertEqual(answer['passages'][0]['scope'], 'Entrance only.')
        self.assertEqual(answer['unresolved'], ['Room route unknown.'])
        research['sources'] = {}
        self.assertEqual(public_venue_answers(research), [])

    def test_award_and_nomination_are_separate_sourced_facts(self):
        def row(prop, label):
            return {k: {'value': v} for k, v in {'imdb': 'tt1234567', 'item': 'http://www.wikidata.org/entity/Q123',
                'property': 'http://www.wikidata.org/prop/direct/' + prop, 'valueLabel': label}.items()}
        parsed = parse_wikidata([row('P166', "Palme d'Or"), row('P1411', 'Academy Award for Best Picture')])
        facts = parsed['tt1234567']['facts']['search_facts']
        self.assertEqual([f['field'] for f in facts], ['award', 'nomination'])
        self.assertTrue(all(f['source_url'] == 'https://www.wikidata.org/entity/Q123' for f in facts))

    def test_identity_history_survives_removal_from_the_current_programme(self):
        film = {'id': 'film', 'title': 'Example', 'sessions': [{'id': 'old', 'starts_at': '2026-11-20T18:00:00+01:00'}]}
        first = update_registry(new_registry(), {'films': [film]}, [], '2026-11-21T12:00:00Z')
        film['sessions'] = [{'id': 'new', 'starts_at': '2026-11-22T18:00:00+01:00'}]
        second = update_registry(first, {'films': [film]}, [], '2026-11-21T13:00:00Z')
        record = next(iter(second['entities'].values()))
        self.assertEqual([s['id'] for s in record['screenings']], ['old', 'new'])
        self.assertEqual(len(next(iter(first['entities'].values()))['screenings']), 1)


if __name__ == '__main__':
    unittest.main()
