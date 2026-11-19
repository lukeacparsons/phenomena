from datetime import datetime
import unittest

from discovery_content import select_sessions, weekend_dates


def session(sid, starts='2026-11-20T20:00:00+01:00', **facts):
    return {'id': sid, 'starts_at': starts, **facts}


def select(sessions, kind, now='2026-11-19T12:00:00+00:00'):
    data = {'films': [{'id': 'film', 'title': 'An English film', 'details': {'languages': ['English'], 'countries': ['England']}, 'sessions': sessions}]}
    return {key: [s['id'] for _, s in rows] for key, rows in select_sessions(data, kind, datetime.fromisoformat(now)).items()}


class SelectionTests(unittest.TestCase):
    def test_classics_require_reviewed_edition_venue_and_season_not_age_or_format(self):
        import copy
        now = datetime.fromisoformat('2026-11-19T12:00:00Z')
        film = {'id': 'dune', 'title': 'Dune', 'release_year': 1984, 'sessions': [
            session('reviewed', cinema_id='phenomena', film_id='3045'),
            session('other-venue', cinema_id='cinesa-diagonal-mar', film_id='3045'),
            session('unknown-edition', cinema_id='phenomena', film_id='unknown', formats=['4K']),
            session('other-season', '2027-01-01T00:00:00+01:00', cinema_id='phenomena', film_id='3045'),
            session('last-day', '2026-12-31T22:59:00Z', cinema_id='phenomena', film_id='3045'),
            session('expired', '2026-11-19T12:00:00Z', cinema_id='phenomena', film_id='3045')]}
        before = copy.deepcopy(film)
        groups = select_sessions({'films': [film]}, 'classics', now)
        self.assertEqual([s['id'] for _, s in groups['revivals']], ['reviewed', 'last-day'])
        self.assertEqual(film, before)  # Never attach a season's format to a session.
        film['release_year'] = 2021
        self.assertFalse(any(select_sessions({'films': [film]}, 'classics', now).values()))
        film['release_year'] = None
        self.assertFalse(any(select_sessions({'films': [film]}, 'classics', now).values()))

    def test_eixample_membership_is_exact_and_uses_seven_madrid_days(self):
        sessions = [session('phenomena', cinema_id='phenomena'), session('arenas', cinema_id='mooby-arenas'),
                    session('gracia', cinema_id='verdi'), session('substring', cinema_id='eixample-nearby'),
                    session('outside', '2026-11-25T23:00:00Z', cinema_id='cinemes-girona'),
                    session('inside', '2026-11-25T22:59:00Z', cinema_id='cinemes-girona')]
        self.assertEqual(select(sessions, 'eixample'), {'sagrada-familia': ['phenomena'], 'dreta': ['inside'],
                         'antiga-esquerra': [], 'sant-antoni': [], 'nova-esquerra': ['arenas']})

    def test_discount_examples_are_limited_per_venue_without_price_assignment(self):
        import copy
        sessions = [session('later', '2026-11-21T20:00:00+01:00', cinema_id='verdi'),
                    session('first', cinema_id='verdi'), session('second', '2026-11-20T21:00:00+01:00', cinema_id='verdi'),
                    session('texas', cinema_id='espai-texas'), session('unreviewed', cinema_id='phenomena'),
                    session('outside', '2026-11-25T23:00:00Z', cinema_id='espai-texas')]
        before = copy.deepcopy(sessions)
        self.assertEqual(select(sessions, 'discounts'), {'discount-screenings': ['first', 'texas', 'second']})
        self.assertEqual(sessions, before)

    def test_vosc_requires_catalan_subtitles_independently_of_audio_and_version(self):
        sessions = [session('french', language='French', subtitles='Català'),
                    session('mixed-subtitles', language='English', subtitles='Català, English'),
                    session('audio-only', language='Catalan', subtitles=None),
                    session('version-only', version='VOSC', subtitles=None),
                    session('unknown', subtitles='Otras Lenguas'),
                    session('spanish', subtitles='Español'),
                    session('expired', '2026-11-19T12:00:00Z', subtitles='ca')]
        self.assertEqual(select(sessions, 'vosc'), {'vosc': ['french', 'mixed-subtitles']})

    def test_gracia_uses_reviewed_venues_local_time_and_disjoint_language_groups(self):
        sessions = [session('english', cinema_id='verdi', language='English'),
                    session('mixed', cinema_id='verdi-park', language='English, French'),
                    session('early', '2026-11-20T18:59:00Z', cinema_id='mooby-bosque', language='English'),
                    session('unknown', cinema_id='espai-texas', language=None),
                    session('elsewhere', cinema_id='phenomena', language='English'),
                    session('substring', cinema_id='casa-seat-passeig-de-gracia', language='English'),
                    session('outside', '2026-11-25T23:00:00Z', cinema_id='verdi', language='English'),
                    session('last', '2026-11-25T22:59:00Z', cinema_id='verdi', language='English'),
                    session('expired', '2026-11-19T12:00:00Z', cinema_id='verdi', language='English')]
        self.assertEqual(select(sessions, 'gracia'), {'gracia-english': ['english', 'last'],
                         'gracia-multilingual': ['mixed'], 'gracia-other': ['early', 'unknown']})

    def test_weekend_stays_on_current_friday_sunday_then_rolls_on_monday(self):
        for day in range(16, 23):
            dates = weekend_dates(datetime.fromisoformat(f'2026-11-{day}T12:00:00+01:00'))
            self.assertEqual([str(d) for d in dates], ['2026-11-20', '2026-11-21', '2026-11-22'])
        self.assertEqual(str(weekend_dates(datetime.fromisoformat('2026-11-22T23:00:00Z'))[0]), '2026-11-27')
        self.assertEqual(str(weekend_dates(datetime.fromisoformat('2026-12-31T23:00:00Z'))[0]), '2027-01-01')

    def test_weekend_includes_only_remaining_sessions_inside_madrid_calendar_days(self):
        sessions = [session('before', '2026-11-19T23:59:00+01:00'),
                    session('friday', '2026-11-19T23:00:00Z'),
                    session('saturday', '2026-11-21T20:00:00+01:00'),
                    session('sunday', '2026-11-22T23:59:00+01:00'),
                    session('monday', '2026-11-22T23:00:00Z')]
        self.assertEqual(select(sessions, 'weekend'), {'friday': ['friday'], 'saturday': ['saturday'], 'sunday': ['sunday']})
        self.assertEqual(select(sessions, 'weekend', '2026-11-21T20:00:00+01:00'), {'friday': [], 'saturday': [], 'sunday': ['sunday']})
        # Sunday endpoints remain local midnight across both DST transitions.
        for now, final, monday in [('2026-03-27T12:00:00Z', '2026-03-29T21:59:00Z', '2026-03-29T22:00:00Z'),
                                    ('2026-10-23T12:00:00Z', '2026-10-25T22:59:00Z', '2026-10-25T23:00:00Z')]:
            self.assertEqual(select([session('last', final), session('next', monday)], 'weekend', now),
                             {'friday': [], 'saturday': [], 'sunday': ['last']})

    def test_formats_require_same_session_tags_and_never_infer_from_venue_or_title(self):
        sessions = [session('imax', formats=['IMAX'], version='VOSE'),
                    session('isense', formats=['iSense'], room='IMAX'),
                    session('venue', cinema_id='cinesa-diagonal-mar', big_screen=True),
                    session('title-only', title='35mm IMAX'), session('null', formats=None),
                    session('print', formats=['35mm']), session('large-print', formats=['70mm']),
                    session('both', formats=['35mm', '70mm']),
                    session('combined', formats=['IMAX', '70mm']),
                    session('not-exact', formats=['not IMAX', '135mm']),
                    session('past', '2026-11-19T12:00:00Z', formats=['IMAX', '35mm'])]
        self.assertEqual(select(sessions, 'imax'), {'imax': ['combined', 'imax']})
        self.assertEqual(select(sessions, 'film'), {'35mm': ['print'], '70mm': ['combined', 'large-print'], 'mixed-film': ['both']})
        with self.assertRaises(ValueError):
            select(sessions, 'typo')

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
