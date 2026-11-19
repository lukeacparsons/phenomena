import copy
from datetime import datetime, timezone
from html.parser import HTMLParser
import unittest

from build_public_site import language_name, compact_programme
from complete_programme import render_complete_programme, LABELS
from site_identity import update_registry, new_registry
from test_public_site import programme, NOW
import test_public_site as publication_fixtures


class ProgrammeHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.disclosures, self.sessions, self.times, self.images, self.films = [], [], [], [], []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'details': self.disclosures.append(attrs)
        if tag == 'a' and 'data-programme-session' in attrs: self.sessions.append(attrs)
        if tag == 'time': self.times.append(attrs['datetime'])
        if tag == 'img': self.images.append(attrs)
        if tag == 'article': self.films.append(attrs)


class CompleteProgrammeTests(unittest.TestCase):
    def test_complete_beyond_grid_limits_localized_and_without_inferred_audio(self):
        data = programme()
        original = data['films'][0]
        data['films'] = []
        for number in range(40):
            film = copy.deepcopy(original)
            film.update(id=f'film:{number}', title=f'Film {number} <script>', imdb_id=None)
            film['sessions'] = [{**original['sessions'][0], 'id': f'session:{number}:{day}',
                                 'starts_at': f'2026-11-{day:02}T19:00:00+01:00',
                                 'date': f'2026-11-{day:02}', 'is_sold_out': day == 23}
                                for day in (18, 20, 21, 22, 23)]
            data['films'].append(film)
        registry = update_registry(new_registry(), data, data['cinemas'], NOW.isoformat())
        compact = compact_programme(data, registry, NOW)
        for lang in ('en', 'es', 'ca'):
            with self.subTest(lang=lang):
                html = render_complete_programme(compact, lang, NOW, language_name=language_name)
                parser = ProgrammeHTML(); parser.feed(html)
                self.assertEqual(len(parser.films), 40)
                self.assertEqual(len(parser.sessions), 160)
                self.assertEqual(len({s['href'] for s in parser.sessions}), 160)
                self.assertNotIn('open', parser.disclosures[0])
                self.assertEqual(parser.disclosures[0]['data-sessions'], '160')
                self.assertEqual(parser.images, [])
                self.assertNotIn('2026-11-18', html)
                self.assertNotIn('<script>', html)
                self.assertIn('&lt;script&gt;', html)
                self.assertIn(LABELS[lang][0], html)
                self.assertIn(LABELS[lang][4], html)
                # Film metadata says English; VOSE only proves the subtitle label.
                self.assertNotIn({'en':'English','es':'Inglés','ca':'Anglès'}[lang], html)
                self.assertTrue(all(s['href'].startswith(f'/{lang}/') and '#screening-' in s['href'] for s in parser.sessions))

    def test_session_facts_are_not_lost_when_same_time_has_different_languages_or_rooms(self):
        data = programme()
        first = data['films'][0]['sessions'][0]
        first.update(language='en', room='1', formats=['35mm'])
        data['films'][0]['sessions'].append({**first, 'id': 'session:two', 'language': 'ca', 'room': '2', 'formats': ['70mm']})
        registry = update_registry(new_registry(), data, data['cinemas'], NOW.isoformat())
        compact = compact_programme(data, registry, NOW)
        html = render_complete_programme(compact, 'en', NOW, language_name=language_name)
        for expected in ('English', 'Catalan', 'Spanish', 'Sala: 1', 'Sala: 2', '35mm', '70mm'):
            self.assertIn(expected, html)
        self.assertEqual(html.count('<li>'), 2)
        expired = render_complete_programme(compact, 'en', datetime(2027, 1, 1, tzinfo=timezone.utc), language_name=language_name)
        self.assertIn('data-sessions="0"', expired)
        self.assertNotIn('data-programme-session', expired)


class CompleteProgrammePublicationTest(unittest.TestCase):
    def test_full_programme_is_inside_main_in_initial_html_and_outside_grid(self):
        # Reuse the publication fixture without inheriting its entire test suite.
        fixture = publication_fixtures.PublicationTests()
        fixture.setUp()
        try:
            fixture.publish()
            for lang in ('en', 'es', 'ca'):
                html = (fixture.root / 'site/current/public' / lang / 'index.html').read_text()
                start = html.index('<details class="complete-programme"')
                end = html.index('</details>', start)
                self.assertLess(html.index('</div></section>', html.index('id="grid"')), start)
                self.assertLess(end, html.index('</main>'))
                self.assertLess(end, html.index('<footer'))
                parser = ProgrammeHTML(); parser.feed(html[start:end + len('</details>')])
                self.assertEqual(len(parser.sessions), 1)
                self.assertNotIn('open', parser.disclosures[0])
                self.assertIn('content-visibility:auto', html)
                self.assertNotIn('href="/complete-programme.css"', html)
        finally:
            fixture.tearDown()


if __name__ == '__main__':
    unittest.main()
