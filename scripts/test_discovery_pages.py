from datetime import datetime
import unittest

from discovery_content import select_sessions


def session(sid, starts='2026-11-20T20:00:00+01:00', **facts):
    return {'id': sid, 'starts_at': starts, **facts}


def select(sessions, kind, now='2026-11-19T12:00:00+00:00'):
    data = {'films': [{'id': 'film', 'title': 'An English film', 'details': {'languages': ['English'], 'countries': ['England']}, 'sessions': sessions}]}
    return {key: [s['id'] for _, s in rows] for key, rows in select_sessions(data, kind, datetime.fromisoformat(now)).items()}


class SelectionTests(unittest.TestCase):
    def test_audio_is_session_specific_and_independent_of_subtitles_and_film_metadata(self):
        sessions = [session('french-vose', language='French', subtitles='Español', version='VOSE'),
                    session('english-vosc', language='EN', subtitles='Català', version='VOSC'),
                    session('spanish-vosi', language='Castellano', subtitles='English', version='VOSI'),
                    session('unknown-vose', version='VOSE'),
                    session('generic', language='Otras Lenguas'),
                    session('unrecognised', language='possibly English'),
                    session('multi', language='Japonés, Inglés, Francés'),
                    session('partial', language='English, Klingon'),
                    session('accent', language='Anglès,'), session('spanish-label', language='INGLÉS.')]
        self.assertEqual(select(sessions, 'english'), {'english': ['accent', 'english-vosc', 'spanish-label'], 'multilingual': ['multi', 'partial']})
        self.assertEqual(select(sessions, 'subtitles'), {'subtitles': ['spanish-vosi']})

    def test_today_uses_madrid_instants_and_18_to_midnight_without_duplicates(self):
        sessions = [session('started', '2026-11-19T13:00:00+01:00'),
                    session('afternoon', '2026-11-19T17:59:00+01:00'),
                    session('tonight', '2026-11-19T18:00:00+01:00'),
                    session('late', '2026-11-19T22:59:00Z'),
                    session('tomorrow', '2026-11-19T23:00:00Z')]
        self.assertEqual(select(sessions, 'today'), {'daytime': ['afternoon'], 'tonight': ['tonight', 'late']})
        self.assertEqual(select(sessions, 'today', '2026-11-19T23:00:01Z'), {'daytime': [], 'tonight': []})
        self.assertEqual(select([session('tomorrow', '2026-11-20T00:30:00+01:00')], 'today', '2026-11-19T23:00:00Z'), {'daytime': ['tomorrow'], 'tonight': []})

    def test_calendar_window_and_dst_rollovers(self):
        sessions = [session('day-seven', '2026-11-25T23:59:00+01:00', language='en'),
                    session('day-eight', '2026-11-26T00:00:00+01:00', language='en')]
        self.assertEqual(select(sessions, 'english')['english'], ['day-seven'])
        # Madrid's spring day is 23 hours; its autumn day is 25 hours.
        for now, final, next_day in [('2026-03-28T23:00:00Z', '2026-03-29T21:59:00Z', '2026-03-29T22:00:00Z'),
                                     ('2026-10-24T22:00:00Z', '2026-10-25T22:59:00Z', '2026-10-25T23:00:00Z')]:
            self.assertEqual(select([session('last', final), session('next', next_day)], 'today', now), {'daytime': [], 'tonight': ['last']})


if __name__ == '__main__':
    unittest.main()
