import copy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from build_public_site import build, language_name, validate_programme
from public_http import resolve_url
from site_identity import new_registry, update_registry, resolve, path_for, slugify
from site_research import ResearchTranslations

NOW = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)


def programme():
    return {'generated_at': NOW.isoformat(), 'timezone': 'Europe/Madrid', 'coverage': [],
            'cinemas': [{'id': 'phenomena', 'name': 'Phenomena Experience', 'url': 'https://phenomena-experience.com'}],
            'films': [{'id': 'source:1984', 'title': 'Dune (1984)', 'release_year': 1984, 'imdb_id': 'tt0087182',
                       'details': {'directors': ['David Lynch'], 'languages': ['English']},
                       'sessions': [{'id': 'session:one', 'cinema_id': 'phenomena', 'starts_at': '2026-11-20T19:00:00+01:00',
                                     'date': '2026-11-20', 'time': '19:00', 'version': 'VOSE', 'subtitles': 'Español',
                                     'booking_url': 'https://cinema.example/tickets', 'source_url': 'https://cinema.example/programme',
                                     'schedule_fetched_at': NOW.isoformat()}]}]}


class IdentityTests(unittest.TestCase):
    def test_exact_provider_imdb_evidence_merges_published_aliases(self):
        old = {'id': 'sant-cugat-cinemas:103892', 'title': 'Dos fiscales (VOSE)', 'sessions': []}
        current = {'id': 'imdb:tt35521200', 'imdb_id': 'tt35521200', 'title': old['title'], 'sessions': []}
        registry = update_registry(new_registry(), {'films': [old, current]}, [], NOW.isoformat())
        paths = {path_for(resolve(registry, 'films', film['id'])) for film in (old, current)}
        current['sessions'] = [{'provider': 'sant-cugat-cinemas', 'film_id': '103892', 'imdb_id': 'tt35521200'}]
        merged = update_registry(registry, {'films': [current]}, [], NOW.isoformat())
        winner = path_for(resolve(merged, 'films', current['id']))
        self.assertEqual(resolve(merged, 'films', old['id']), resolve(merged, 'films', current['id']))
        self.assertEqual(merged['redirects'][(paths - {winner}).pop()], winner)
        current['imdb_id'] = 'tt99999999'
        current['sessions'][0]['imdb_id'] = current['imdb_id']
        with self.assertRaisesRegex(ValueError, 'Conflicting provider film identity'):
            update_registry(merged, {'films': [current]}, [], NOW.isoformat())

    def test_normalisation_preserves_identity_words_and_accents(self):
        self.assertEqual(slugify('Kinépolis Splau'), 'kinepolis-splau')
        self.assertEqual(slugify('L’Hospitalet de Llobregat'), 'lhospitalet-de-llobregat')
        self.assertEqual(slugify('Dune: Part Two'), 'dune-part-two')
        with self.assertRaises(ValueError):
            slugify('東京')

    def test_titles_years_and_provider_enrichment_do_not_move_published_pages(self):
        data = programme()
        registry = update_registry(new_registry(), data, [], NOW.isoformat())
        before = path_for(resolve(registry, 'films', 'source:1984'))
        self.assertEqual(before, '/en/films/dune-1984/')
        data['films'][0].update(id='imdb:tt0087182', merged_ids=['source:1984'], title='A corrected title', release_year=1985)
        after = update_registry(registry, data, [], (NOW + timedelta(days=1)).isoformat())
        self.assertEqual(path_for(resolve(after, 'films', 'imdb:tt0087182')), before)
        self.assertEqual(resolve(after, 'films', 'source:1984'), resolve(after, 'films', 'imdb:tt0087182'))

    def test_collision_and_adaptations_stay_separate(self):
        data = programme()
        data['films'] += [{'id': 'b', 'title': 'Dune', 'release_year': 2021, 'sessions': []},
                          {'id': 'c', 'title': 'Dune', 'release_year': 2021, 'sessions': []}]
        registry = update_registry(new_registry(), data, [], NOW.isoformat())
        paths = [path_for(resolve(registry, 'films', f['id'])) for f in data['films']]
        self.assertEqual(len(set(paths)), 3)
        self.assertIn('/en/films/dune-2021/', paths)

    def test_merge_preserves_old_urls_and_expired_film(self):
        data = programme()
        data['films'].append({'id': 'other', 'title': 'Another title', 'sessions': []})
        registry = update_registry(new_registry(), data, [], NOW.isoformat())
        old = {path_for(resolve(registry, 'films', k)) for k in ('source:1984', 'other')}
        data['films'] = [{**data['films'][0], 'merged_ids': ['other']}]
        registry = update_registry(registry, data, [], (NOW + timedelta(days=1)).isoformat())
        winner = path_for(resolve(registry, 'films', 'other'))
        loser = (old - {winner}).pop()
        self.assertEqual(registry['redirects'][loser], winner)
        registry = update_registry(registry, {'films': []}, [], (NOW + timedelta(days=2)).isoformat())
        self.assertEqual(path_for(resolve(registry, 'films', 'source:1984')), winner)

    def test_retired_slugs_cannot_be_reassigned_and_length_includes_collision_token(self):
        data = programme()
        registry = update_registry(new_registry(), data, [], NOW.isoformat())
        registry['redirects']['/en/films/retired/'] = '/en/films/dune-1984/'
        data['films'].append({'id': 'new-film', 'title': 'Retired', 'sessions': []})
        registry = update_registry(registry, data, [], NOW.isoformat())
        self.assertNotEqual(path_for(resolve(registry, 'films', 'new-film')), '/en/films/retired/')
        with self.assertRaises(ValueError):
            update_registry(new_registry(), {'films': [{'id': 'a', 'title': 'a' * 100},
                {'id': 'b', 'title': 'a' * 100}]}, [], NOW.isoformat())


class PublicationTests(unittest.TestCase):
    def test_homepage_covers_quiet_cinemas_and_separates_directory_only_venues(self):
        from html import escape
        from site_content import COPY, PUBLISHER

        self.data['cinemas'] += [
            {'id': 'quiet', 'name': 'Quiet & Covered', 'url': 'https://cinema.example/quiet'},
            {'id': 'links-only', 'name': 'Programme Links Only', 'url': 'https://cinema.example/links',
             'catalogue_mode': 'programme_links_only'}]
        dossier = json.loads((self.docs / 'cinema-dossiers.json').read_text())
        dossier['cinemas'].append({'id': 'research-only', 'name': 'Research Only',
                                   'official_url': 'https://cinema.example/research'})
        (self.docs / 'cinema-dossiers.json').write_text(json.dumps(dossier))
        self.write_input()
        self.publish()
        root = self.root / 'site/current/public'
        for lang, section, about in [('en', 'cinemas', 'about'), ('es', 'cines', 'acerca-de'), ('ca', 'cinemes', 'sobre-nosaltres')]:
            html = (root / lang / 'index.html').read_text()
            footer = html.split('<details class="site-information">', 1)[1].split('</details>', 1)[0]
            collected = footer.split('<ul id="collected-cinemas"', 1)[1].split('</ul>', 1)[0]
            directory = footer.split('<ul id="directory-cinemas"', 1)[1].split('</ul>', 1)[0]
            self.assertIn('Phenomena Experience', collected)
            self.assertIn('Quiet &amp; Covered', collected)
            self.assertIn(f'/{lang}/{section}/quiet-covered/', collected)
            self.assertEqual(collected.count('<li>'), 2)
            self.assertEqual(directory.count('<li>'), 2)
            for name in ('Programme Links Only', 'Research Only'):
                self.assertIn(name, directory)
                self.assertNotIn(name, collected)
            self.assertNotIn('homepage-information', html.split('</main>', 1)[0])
            self.assertIn(escape(COPY[lang]['coverage_answer'].format(count=2)), footer)
            self.assertIn(PUBLISHER['name'], footer)
            self.assertIn('mailto:' + PUBLISHER['email'], footer)
            for key in ('commitment', 'booking_benefit_text', 'refresh_answer'):
                self.assertIn(escape(COPY[lang][key]), footer)
                self.assertIn(escape(COPY[lang][key]), (root / lang / about / 'index.html').read_text())

    def test_session_context_is_in_the_closed_footer_with_evidence_backed_metadata(self):
        from html.parser import HTMLParser
        from discovery_content import PATHS

        class Context(HTMLParser):
            def __init__(self):
                super().__init__()
                self.footer = False
                self.closed = False
                self.inside = False
                self.in_closed_footer = False
                self.links = []
                self.ids = []
                self.description = ''
            def handle_starttag(self, tag, attrs):
                a = dict(attrs)
                if 'id' in a: self.ids.append(a['id'])
                if tag == 'meta' and a.get('name') == 'description': self.description = a['content']
                if tag == 'footer': self.footer = True
                if tag == 'details' and self.footer: self.closed = 'open' not in a
                if tag == 'section' and a.get('class') == 'screening-context':
                    self.inside = True
                    self.in_closed_footer = self.footer and self.closed
                if tag == 'a' and self.inside: self.links.append(a.get('href'))
            def handle_endtag(self, tag):
                if tag == 'section': self.inside = False
                if tag == 'footer': self.footer = False

        self.data['films'][0]['sessions'][0].update(language='EN', formats=['IMAX'])
        self.write_input(); self.publish()
        root = self.root / 'site/current/public'
        for lang, films, cinemas, audio in [('en', 'films', 'cinemas', 'English'),
                                           ('es', 'peliculas', 'cines', 'Inglés'),
                                           ('ca', 'pellicules', 'cinemes', 'Anglès')]:
            for path in [f'{lang}/{films}/dune-1984/index.html', f'{lang}/{cinemas}/phenomena-experience/index.html']:
                html = (root / path).read_text()
                p = Context(); p.feed(html)
                self.assertTrue(p.in_closed_footer)
                self.assertEqual(len(p.ids), len(set(p.ids)))
                self.assertIn(PATHS['english'][lang], p.links)
                self.assertIn(PATHS['imax'][lang], p.links)
                self.assertNotIn(PATHS['subtitles'][lang], p.links)
                self.assertTrue(any('#screening-' in href for href in p.links))
                self.assertLess(html.index('</main>'), html.index('class="screening-context"'))
                if '/dune-' in path: self.assertIn(audio, p.description)

        # Film metadata does not turn missing session audio into English from the film's facts.
        del self.data['films'][0]['sessions'][0]['language']
        self.write_input(); self.publish()
        p = Context(); p.feed((root / 'en/films/dune-1984/index.html').read_text())
        self.assertNotIn('English', p.description)
        self.assertNotIn(PATHS['english']['en'], p.links)

        self.publish(now=NOW + timedelta(days=3))
        p = Context(); p.feed((root / 'en/films/dune-1984/index.html').read_text())
        self.assertIn('No upcoming screenings', p.description)
        self.assertEqual(p.links, [])
        html = (root / 'en/cinemas/phenomena-experience/index.html').read_text()
        self.assertIn('Phenomena Experience: venue information and programme | VO Barna', html)

    def test_date_pages_keep_exact_sessions_and_complete_html_with_localized_metadata(self):
        from date_listings import DAY_PATHS, date_view, render_date_view
        import re
        session = self.data['films'][0]['sessions'][0]
        self.data['films'][0]['sessions'] += [dict(session, id='tonight', starts_at='2026-11-19T23:59:00+01:00', date='2026-11-19', time='23:59')]
        # More films than the first grid batch: all must remain readable in HTML.
        for i in range(28):
            self.data['films'].append({'id': f'extra:{i}', 'title': f'Extra {i}', 'sessions': [dict(session, id=f'extra:{i}')]})
        self.write_input(); self.publish()
        root = self.root / 'site/current/public'
        manifest = json.loads((self.root / 'site/current/manifest.json').read_text())
        for lang in ('en', 'es', 'ca'):
            for kind, day in [('today','2026-11-19'),('tomorrow','2026-11-20')]:
                path = DAY_PATHS[kind][lang]
                view = date_view(path, {}, NOW)
                html = render_date_view(root, manifest, view)
                self.assertEqual(html, (root / path.lstrip('/') / 'index.html').read_text())
                self.assertIn(f'data-listing-date="{day}"', html)
                self.assertIn(f'<link rel="canonical" href="https://vobarna.com{path}">', html)
                self.assertIn('<meta name="robots" content="index,follow">', html)
                for other in ('en','es','ca'):
                    self.assertIn(f'hreflang="{other}" href="https://vobarna.com{DAY_PATHS[kind][other]}"', html)
                starts = re.findall(r'<time datetime="(2026-11-\d\dT[^\"]+)"', html)
                # Snapshot timestamps may be Nov 19; screening timestamps retain offsets.
                self.assertTrue(all(stamp.startswith(day) for stamp in starts if stamp.endswith('+01:00')))
                if kind == 'tomorrow':
                    self.assertIn('Extra 27', html)
                    self.assertIn('data-sessions="29"', html)
            html = render_date_view(root, manifest, date_view(f'/{lang}/', {'date':['2026-11-20']}, NOW))
            self.assertIn('noindex,follow', html)
            self.assertIn(f'canonical" href="https://vobarna.com/{lang}/?date=2026-11-20"', html)
            self.assertNotIn('?date=', (root / 'sitemap.xml').read_text())
            empty = render_date_view(root, manifest, date_view(f'/{lang}/', {'date':['2026-12-31']}, NOW))
            self.assertIn('data-listing-date="2026-12-31"', empty)
            self.assertNotIn('class="card"', empty)
        for instant, day in [('2026-11-19T23:00:00Z','2026-11-20'),('2026-03-29T22:00:00Z','2026-03-30'),('2026-10-25T23:00:00Z','2026-10-26')]:
            self.assertEqual(date_view(DAY_PATHS['today']['en'], {}, datetime.fromisoformat(instant))['date'], day)
        self.assertEqual(resolve_url('/en/?date=2026-02-30', manifest), (404, None))
        self.assertEqual(resolve_url('/en/showtimes/today/', manifest, now=NOW), (200, '/en/showtimes/today/'))

    def test_discovery_pages_are_readable_localized_and_linked_only_in_closed_footer(self):
        from discovery_content import PATHS, COPY as DISCOVERY_COPY
        import hashlib
        from html.parser import HTMLParser

        class FooterLinks(HTMLParser):
            def __init__(self):
                super().__init__()
                self.footer = False
                self.closed = 0
                self.links = []
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == 'footer': self.footer = True
                if tag == 'details' and self.footer and 'open' not in attrs: self.closed += 1
                if tag == 'a' and attrs.get('href') in {p for paths in PATHS.values() for p in paths.values()}:
                    self.links.append((self.footer, self.closed > 0))
            def handle_endtag(self, tag):
                if tag == 'details' and self.footer: self.closed -= 1
                if tag == 'footer': self.footer = False

        original = self.data['films'][0]['sessions'][0]
        original.update(language='EN', subtitles='English, Català', formats=['IMAX', '35mm'], film_id='3045')
        self.write_input()
        self.publish()
        root = self.root / 'site/current/public'
        anchor = '#screening-' + hashlib.sha256(original['id'].encode()).hexdigest()[:16]
        for lang in ('en', 'es', 'ca'):
            home = (root / lang / 'index.html').read_text()
            links = FooterLinks(); links.feed(home)
            self.assertEqual(links.links, [(True, True)] * len(PATHS))
            from date_listings import DAY_PATHS
            self.assertIn(f'href="{DAY_PATHS["today"][lang]}"', home)
            self.assertIn(f'href="{DAY_PATHS["tomorrow"][lang]}"', home)
            for kind, paths in PATHS.items():
                self.assertIn('https://vobarna.com' + paths['en'], (root / 'llms.txt').read_text())
                html = (root / paths[lang].lstrip('/') / 'index.html').read_text()
                self.assertIn(f'<html lang="{lang}">', html)
                self.assertIn(f'<link rel="canonical" href="https://vobarna.com{paths[lang]}">', html)
                for other in ('en', 'es', 'ca'):
                    self.assertIn(f'hreflang="{other}" href="https://vobarna.com{paths[other]}"', html)
                self.assertIn(paths[lang], (root / 'sitemap.xml').read_text())
                self.assertIn('index,follow', html)
                if kind == 'discounts':
                    self.assertEqual(html.count('class="comparison-room discount-offer content-block"'), 6)
                    self.assertIn('datetime="2026-11-19"', html)
                    self.assertNotIn('data-discovery-film=', html)
                    self.assertNotIn('"@type": "Offer"', html)
                    self.assertIn('https://www.cinesrenoir.com/precios/barcelona/', html)
                    continue
                if kind == 'gracia':
                    self.assertIn(DISCOVERY_COPY[lang]['none'], html)
                    self.assertIn('id="guide-information"', html)
                    self.assertNotIn('data-discovery-film=', html)
                    continue
                self.assertIn(anchor, html)
                self.assertIn('class="screening-action" aria-label=', html)
                self.assertIn('https://cinema.example/programme', html)
                self.assertIn('https://cinema.example/tickets', html)
                self.assertIn('Phenomena Experience', html)
                self.assertIn(DISCOVERY_COPY[lang]['count'].format(films=1, sessions=1), html)
                if kind == 'weekend':
                    for date in ('2026-11-20', '2026-11-21', '2026-11-22'):
                        self.assertIn(date, html)
                if kind == 'film':
                    self.assertIn('id="35mm"', html)
                    self.assertIn('id="70mm"', html)
                    self.assertIn(DISCOVERY_COPY[lang]['format_none'], html)
                    self.assertIn(DISCOVERY_COPY[lang]['film_edition_body'], html)
                    self.assertIn(f'href="{paths[lang]}#70mm"', html)
                if kind == 'classics':
                    self.assertIn('Dune (1984)', html)
                    self.assertIn('https://phenomena-experience.com/index?pag=cartelera', html)
                    self.assertIn(DISCOVERY_COPY[lang]['classics_edition_body'], html)
                if kind == 'eixample':
                    self.assertIn('id="sagrada-familia"', html)
                    self.assertIn('Carrer de Sant Antoni Maria Claret, 168', html)
        from date_listings import DAY_PATHS
        for kind, paths in DAY_PATHS.items():
            for lang, path in paths.items():
                html = (root / path.lstrip('/') / 'index.html').read_text()
                self.assertIn(path, (root / 'sitemap.xml').read_text())
                self.assertIn('index,follow', html)
                self.assertIn(f'data-date-kind="{kind}"', html)
        # Empty evergreen guides retain the explanation and useful indexable HTML.
        original['subtitles'] = 'Español'
        self.write_input(); self.publish()
        html = (root / PATHS['subtitles']['en'].lstrip('/') / 'index.html').read_text()
        self.assertIn(DISCOVERY_COPY['en']['none'], html)
        self.assertIn('VOSI</th>', html)
        self.assertIn('index,follow', html)
        self.assertNotIn('data-discovery-film=', html)
        html = (root / PATHS['vosc']['en'].lstrip('/') / 'index.html').read_text()
        self.assertIn(DISCOVERY_COPY['en']['vosc_answer'], html)
        self.assertNotIn('data-discovery-film=', html)

    def test_subtitle_pages_rebuild_foreign_multilingual_and_event_sections(self):
        from copy import deepcopy
        from discovery_content import PATHS, COPY as D
        base = deepcopy(self.data['films'][0])
        films = []
        for fid, title, audio in [('spanish', 'Spanish film', 'Spanish'),
                                  ('mixed', 'Multilingual film', None),
                                  ('event', 'BTS WORLD TOUR: LIVE VIEWING', 'Korean')]:
            film = deepcopy(base)
            film.update(id=fid, title=title)
            film.pop('imdb_id', None)
            film['sessions'][0].update(id='session-' + fid, language=audio, subtitles='English', version='VOSI')
            if fid == 'mixed':
                film['details'] = {'language_status': {'state': 'conflict'}, 'language_reports': [{
                    'status': 'ok', 'evidence': 'explicit_original_language',
                    'source_url': film['sessions'][0]['source_url'], 'languages': ['Swedish', 'French', 'English']}]}
            films.append(film)
        self.data['films'] = films
        self.write_input(); self.publish()
        root = self.root / 'site/current/public'
        for lang, path in PATHS['subtitles'].items():
            html = (root / path.lstrip('/') / 'index.html').read_text()
            self.assertLess(html.index('id="subtitles-foreign"'), html.index('id="subtitles-multilingual"'))
            self.assertLess(html.index('id="subtitles-multilingual"'), html.index('id="subtitles-events"'))
            self.assertEqual(html.count('data-discovery-film='), 3)
            self.assertIn(D[lang]['derived_audio'], html)
            self.assertIn('3', html.split('"numberOfItems": ')[1].split(',')[0])
            self.assertIn('class="screening-action"', html)
            self.assertIn(path, (root / 'sitemap.xml').read_text())
        # Programme changes are sufficient; no hand-maintained title list or new URL.
        films[0]['sessions'][0]['subtitles'] = 'Spanish'
        self.write_input(); self.publish()
        html = (root / PATHS['subtitles']['en'].lstrip('/') / 'index.html').read_text()
        self.assertNotIn('data-discovery-film="spanish"', html)
        self.assertIn(D['en']['subtitles-foreign_none'], html)
        self.assertEqual(html.count('data-discovery-film='), 2)

    def test_gracia_renders_matching_sessions_and_reviewed_entrances(self):
        import copy
        from discovery_content import PATHS
        venue = copy.deepcopy(self.data['cinemas'][0])
        venue.update(id='verdi', name='Verdi')
        self.data['cinemas'].append(venue)
        session = copy.deepcopy(self.data['films'][0]['sessions'][0])
        session.update(id='verdi-evening', cinema_id='verdi', language='English',
                       starts_at='2026-11-20T20:00:00+01:00', time='20:00')
        self.data['films'][0]['sessions'].append(session)
        self.write_input(); self.publish()
        html = (self.root / 'site/current/public' / PATHS['gracia']['en'].lstrip('/') / 'index.html').read_text()
        self.assertIn('1 films or events · 1 screenings', html)
        self.assertIn('id="gracia-english"', html)
        self.assertIn('Carrer de Verdi, 32', html)
        self.assertIn('https://barcelona.cines-verdi.com/donde-estamos', html)
        self.assertIn('data-ticket-screening="verdi-evening"', html)
        self.assertNotIn('id="gracia-other"', html)

    def test_room_comparison_preserves_approximate_dimensions_and_unknown_seating(self):
        rooms = {'sources': {'source': {'title': 'Room source', 'url': 'https://cinema.example/room', 'checked_on': '2026-11-19'}},
                 'rooms': [{'id': 'phenomena:1', 'cinema_id': 'phenomena', 'room': '1',
                            'screen': {'width_m': 15, 'height_m': 6.2, 'height_approximate': True, 'source_ids': ['source']},
                            'projection': [{'value': 'Laser projection', 'source_ids': ['source']}]}]}
        (self.docs / 'auditoriums.json').write_text(json.dumps(rooms))
        self.publish()
        html = (self.root / 'site/current/public/en/guides/cinema-screen-sound-formats/index.html').read_text()
        self.assertIn('Width 15 m × height ≈6.2 m', html)
        self.assertIn('<dt>Seating and allocation</dt><dd>Not confirmed</dd>', html)
        self.assertIn('id="compare-phenomena-1"', html)
        self.assertIn('https://cinema.example/room', html)
        self.assertIn('cannot establish the biggest screen', html)
        self.assertIn('https://vobarna.com/en/guides/cinema-screen-sound-formats/',
                      (self.root / 'site/current/public/llms.txt').read_text())

    def test_discovery_actions_and_thin_archive_policy(self):
        self.data['films'].append({'id': 'thin', 'title': 'Unresolved archive', 'sessions': []})
        self.data['films'][0]['sessions'][0]['language'] = 'Otras Lenguas'
        self.write_input()
        self.publish()
        root = self.root / 'site/current/public'
        self.assertIn('/en/cinemas/', (root / 'llms.txt').read_text())
        self.assertIn('noindex,follow', (root / 'en/films/unresolved-archive/index.html').read_text())
        self.assertNotIn('/en/films/unresolved-archive/', (root / 'sitemap.xml').read_text())
        film = (root / 'en/films/dune-1984/index.html').read_text()
        self.assertIn('id="filmPage"', film)
        self.assertIn('class="card-showtime"', film)
        self.assertIn('href="https://cinema.example/tickets"', film)
        self.assertIn('class="dialog-section showtimes-summary reading-wash" id="showtimes"', film)
        # Missing facts stay out of the primary layout; the closed explanation
        # can explicitly distinguish unknown session audio from film metadata.
        self.assertNotIn('Not confirmed', film.split('</main>')[0])
        self.assertIn('Screening audio: Not confirmed', film.split('</main>')[1])
        self.assertNotIn('class="screenings"', film)
        payload = json.loads(film.split('<script type="application/json" id="film-dialog-data">')[1].split('</script>')[0])
        self.assertIsNone(payload['film']['sessions'][0]['language'])
        self.assertTrue(payload['film']['sessions'][0]['url_fragment'].startswith('screening-'))
        directory = (root / 'en/cinemas/index.html').read_text()
        self.assertIn('id="cinemaSearch"', directory)
        self.assertIn('aria-controls="cinemaList"', directory)
        self.assertIn('Phenomena Experience', directory)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.docs = self.root / 'docs'
        self.docs.mkdir()
        self.data = programme()
        self.input = self.root / 'screenings.json'
        self.write_input()
        (self.docs / 'cinema-dossiers.json').write_text(json.dumps({'cinemas': [{'id': 'phenomena', 'name': 'Phenomena Experience',
            'official_url': 'https://cinema.example', 'location': {'formatted_address': 'Barcelona'}}], 'sources': {}, 'researched_on': '2026-11-19'}))
        (self.docs / 'auditoriums.json').write_text(json.dumps({'rooms': [], 'sources': {}}))

    def tearDown(self):
        self.temp.cleanup()

    def write_input(self):
        self.input.write_text(json.dumps(self.data))

    def publish(self, now=NOW):
        return build(programme_path=self.input, docs=self.docs, output=self.root / 'site', registry_path=self.root / 'registry.json', now=now)

    def test_raw_html_locales_schema_and_no_imported_aggregate_rating(self):
        self.publish()
        root = self.root / 'site/current/public'
        en = (root / 'en/films/dune-1984/index.html').read_text()
        self.assertIn('David Lynch', en)
        self.assertIn('2026-11-20T19:00:00+01:00', en)
        self.assertIn('https://cinema.example/tickets', en)
        self.assertIn('ScreeningEvent', en)
        self.assertNotIn('AggregateRating', en)
        self.assertIn('https://vobarna.com/es/peliculas/dune-1984/', en)
        es = (root / 'es/peliculas/dune-1984/index.html').read_text()
        self.assertRegex(es, r'<html\b[^>]*\blang="es"(?:\s|>)')
        self.assertIn('<h2 class="film-showtimes-heading">Sesiones</h2>', es)
        self.assertIn('href="/en/films/dune-1984/"', es)
        self.assertIn('dune-1984', (root / 'en/index.html').read_text())

    def test_publisher_and_correction_contact_are_visible_and_match_schema(self):
        self.publish()
        root = self.root / 'site/current/public'
        for lang, section in [('en', 'about'), ('es', 'acerca-de'), ('ca', 'sobre-nosaltres')]:
            html = (root / lang / section / 'index.html').read_text()
            body = html.split('<body', 1)[1]
            self.assertIn('Luke Parsons', body)
            self.assertIn('href="mailto:vobarna@luke.ac"', body)
            graph = json.loads(html.split('<script type="application/ld+json">')[1].split('</script>')[0])['@graph']
            publisher = next(node for node in graph if node['@type'] == 'Person')
            self.assertEqual(publisher['name'], 'Luke Parsons')
            self.assertEqual(publisher['email'], 'vobarna@luke.ac')
            self.assertEqual(graph[0]['publisher']['@id'], publisher['@id'])
        home = (root / 'en/index.html').read_text()
        graph = json.loads(home.split('<script type="application/ld+json">')[1].split('</script>')[0])['@graph']
        self.assertEqual(next(node for node in graph if node['@type'] == 'WebSite')['publisher']['@id'], publisher['@id'])

    def test_research_translation_preserves_facts_sources_and_language(self):
        room = {'id': 'phenomena:1', 'cinema_id': 'phenomena', 'room': '1',
                'capacity': {'published': [{'value': 419, 'meaning': 'Published seats'}]},
                'projection': [{'value': 'Laser projection', 'source_ids': ['equipment']}],
                'notes': ['Model power/brightness ratings are not auditorium measurements.']}
        (self.docs / 'auditoriums.json').write_text(json.dumps({'rooms': [room], 'sources': {
            'equipment': {'title': 'Original source title', 'url': 'https://cinema.example/technical', 'accessed_on': '2026-11-19'}}}))
        self.publish()
        for lang, section, projection, seats, caveat in [
                ('es', 'cines', 'Proyección láser', 'Asientos publicados', 'no son mediciones realizadas en la sala'),
                ('ca', 'cinemes', 'Projecció làser', 'Seients publicats', 'no són mesures fetes a la sala')]:
            html = (self.root / f'site/current/public/{lang}/{section}/phenomena-experience/index.html').read_text()
            for expected in [projection, seats, caveat, '419', 'https://cinema.example/technical', '2026-11-19', 'Original source title']:
                self.assertIn(expected, html)
            self.assertNotRegex(html.split('<main', 1)[1].split('</main>')[0], r'\slang="en"')
            self.assertNotIn('Model power/brightness', html)
            guide_section = 'guias/formatos-pantalla-sonido-cine' if lang == 'es' else 'guies/formats-pantalla-so-cinema'
            guide = (self.root / f'site/current/public/{lang}/{guide_section}/index.html').read_text()
            self.assertIn(projection, guide)
        previous = (self.root / 'site/current').resolve()
        room['projection'][0]['value'] = 'Changed source evidence awaiting translation'
        (self.docs / 'auditoriums.json').write_text(json.dumps({'rooms': [room], 'sources': {}}))
        with self.assertRaisesRegex(ValueError, 'Missing es research translation'):
            self.publish()
        self.assertEqual((self.root / 'site/current').resolve(), previous)

    def test_translation_catalogue_has_both_locales_for_each_source(self):
        catalogue = ResearchTranslations()
        for source, translations in catalogue.entries.items():
            self.assertEqual(set(translations), {'es', 'ca'}, source)
            self.assertTrue(all(isinstance(value, str) and value.strip() for value in translations.values()), source)
            self.assertEqual(catalogue.translate(source, 'en'), source)

    def test_language_labels_translate_codes_and_multilingual_audio_without_guessing(self):
        self.assertEqual(language_name('Japonés, Inglés, Francés', 'ca'), 'Japonès, Anglès, Francès')
        self.assertEqual(language_name('Castellano', 'ca'), 'Castellà')
        self.assertEqual(language_name('EN', 'es'), 'Inglés')
        self.assertEqual(language_name('Inglés,', 'en'), 'English')
        self.assertEqual(language_name('Portuguese', 'es'), 'Portugués')
        self.assertEqual(language_name('Unknown source wording', 'ca'), 'Unknown source wording')

    def test_archive_survives_a_new_build_without_the_film(self):
        self.publish()
        self.data['films'] = []
        self.write_input()
        self.publish(NOW + timedelta(days=3))
        html = (self.root / 'site/current/public/en/films/dune-1984/index.html').read_text()
        self.assertIn('David Lynch', html)
        self.assertIn('No upcoming screenings', html)
        self.assertNotIn('cinema.example/tickets', html)
        import hashlib
        prefix = hashlib.sha256(b'session:one').hexdigest()[:2]
        root = self.root / 'site/current/public'
        self.assertNotIn('screenings', json.loads((root / 'routes.json').read_text()))
        shard = json.loads((root / f'route-data/screenings/{prefix}.json').read_text())
        self.assertTrue(shard['session:one']['en'].startswith('/en/films/dune-1984/#screening-'))

    def test_cinema_without_verified_sessions_keeps_its_permanent_programme_link(self):
        self.data['cinemas'][0]['programme_url']='https://cinema.example/regular-programme'
        self.data['films']=[]
        self.write_input()
        self.publish()
        html=(self.root/'site/current/public/en/cinemas/phenomena-experience/index.html').read_text()
        self.assertIn('https://cinema.example/regular-programme',html)
        self.assertIn('Current programme',html)
        self.assertIn('No upcoming screenings',html)

    def test_lastmod_only_changes_when_page_content_changes(self):
        self.publish()
        first = json.loads((self.root / 'site/current/manifest.json').read_text())
        self.publish(NOW + timedelta(minutes=5))
        second = json.loads((self.root / 'site/current/manifest.json').read_text())
        self.assertEqual(first['pages']['/en/films/dune-1984/']['lastmod'], second['pages']['/en/films/dune-1984/']['lastmod'])

    def test_discovery_freshness_ignores_rebuilds_but_tracks_schedule_changes(self):
        from discovery_content import PATHS
        self.data['films'][0]['sessions'][0].update(language='English', formats=['IMAX'])
        self.write_input(); self.publish()
        first = json.loads((self.root / 'site/current/manifest.json').read_text())
        self.publish(NOW + timedelta(minutes=5))
        second = json.loads((self.root / 'site/current/manifest.json').read_text())
        for paths in PATHS.values():
            for path in paths.values():
                self.assertEqual(first['pages'][path], second['pages'][path])
        self.data['films'][0]['sessions'][0].update(starts_at='2026-11-20T20:00:00+01:00', time='20:00')
        self.write_input(); self.publish(NOW + timedelta(minutes=10))
        third = json.loads((self.root / 'site/current/manifest.json').read_text())
        path = PATHS['imax']['en']
        self.assertNotEqual(second['pages'][path]['lastmod'], third['pages'][path]['lastmod'])
        publication = json.loads((self.root / 'site/current/public/indexnow.json').read_text())
        self.assertEqual(set(publication['pages']), {p for p, i in third['pages'].items() if i['index']})

    def test_metadata_distinguishes_home_film_pages_and_guides(self):
        import re
        for i in range(26):
            self.data['films'].append({'id': f'archive:{i}', 'title': f'Archive {i}', 'sessions': []})
        self.write_input(); self.publish()
        root = self.root / 'site/current/public'
        for lang, films, guides in [('en', 'films', 'guides'), ('es', 'peliculas', 'guias'), ('ca', 'pellicules', 'guies')]:
            descriptions = []
            for path in [f'{lang}/', f'{lang}/{films}/', f'{lang}/{films}/page/2/', f'{lang}/{guides}/']:
                html = (root / path / 'index.html').read_text()
                descriptions.append(re.search(r'<meta name="description" content="([^"]+)"', html).group(1))
            self.assertEqual(len(set(descriptions)), 4)

    def test_share_previews_are_in_raw_html_for_each_page_and_expire_truthfully(self):
        from html import unescape
        from PIL import Image
        import re
        self.publish()
        root = self.root / 'site/current/public'
        def social(path):
            html = (root / path / 'index.html').read_text()
            return {key: unescape(value) for key, value in re.findall(r'<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"', html)}
        images = set()
        for lang, films, cinemas in [('en', 'films', 'cinemas'), ('es', 'peliculas', 'cines'), ('ca', 'pellicules', 'cinemes')]:
            for path in (f'{lang}/', f'{lang}/{films}/dune-1984/', f'{lang}/{cinemas}/phenomena-experience/'):
                tags = social(path)
                self.assertLessEqual(len(tags['og:description']), 160)
                self.assertEqual(tags['twitter:description'], tags['og:description'])
                self.assertEqual(tags['og:url'], 'https://vobarna.com/' + path)
                images.add(tags['og:image'])
                with Image.open(root / tags['og:image'].removeprefix('https://vobarna.com/')) as image:
                    self.assertEqual(image.size, (1200, 630))
        self.assertEqual(len(images), 9)
        self.assertEqual(social('webmcp/')['twitter:card'], 'summary_large_image')
        before = social('en/films/dune-1984/')
        self.assertNotIn('English', before['og:description'])
        self.publish(now=NOW + timedelta(days=3))
        expired = social('en/films/dune-1984/')
        self.assertIn('No upcoming screenings', expired['og:description'])
        self.assertNotEqual(before['og:image'], expired['og:image'])

    def test_restart_preserves_published_lastmod_and_today_link_is_not_a_content_change(self):
        import os
        self.publish()
        checkpoint = self.root / 'checkpoint'; checkpoint.mkdir()
        published = json.loads((self.root / 'site/current/public/indexnow.json').read_text())
        (checkpoint / 'published-pages.json').write_text(json.dumps(published))
        with patch.dict(os.environ, {'INDEXNOW_STATE_DIR': str(checkpoint)}):
            build(programme_path=self.input, docs=self.docs, output=self.root / 'restart',
                  registry_path=self.root / 'registry.json', now=NOW + timedelta(days=1))
        restarted = json.loads((self.root / 'restart/current/manifest.json').read_text())
        path = '/en/about/'
        self.assertEqual(published['pages'][path], restarted['pages'][path])

    def test_failed_build_does_not_replace_active_publication(self):
        self.publish()
        old = (self.root / 'site/current').resolve()
        with patch('build_public_site.validate_build', side_effect=ValueError('bad link')):
            with self.assertRaises(ValueError):
                self.publish()
        self.assertEqual((self.root / 'site/current').resolve(), old)

    def test_untrusted_text_is_escaped_and_unsafe_booking_is_not_linked(self):
        self.data['films'][0]['title'] = '</script><script>alert(1)</script>'
        self.data['films'][0]['sessions'][0]['booking_url'] = 'javascript:alert(1)'
        self.write_input()
        self.publish()
        registry = json.loads((self.root / 'registry.json').read_text())
        path = path_for(resolve(registry, 'films', 'source:1984'))
        html = (self.root / 'site/current/public' / path.lstrip('/') / 'index.html').read_text()
        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertNotIn('href="javascript:', html)

    def test_unknown_routes_and_legacy_identity_links(self):
        self.publish()
        manifest = json.loads((self.root / 'site/current/manifest.json').read_text())
        self.assertEqual(resolve_url('/cinemas.html?film=source%3A1984', manifest), (301, '/en/films/dune-1984/'))
        self.assertEqual(resolve_url('/en/?film=source%3A1984&q=dune', manifest), (301, '/en/films/dune-1984/'))
        self.assertEqual(resolve_url('/ES/index.html?film=source%3A1984', manifest), (301, '/es/peliculas/dune-1984/'))
        self.assertEqual(resolve_url('/ca/?film=missing', manifest), (404, None))
        self.assertEqual(resolve_url('/en/?q=dune', manifest), (200, '/en/'))
        self.assertEqual(resolve_url('/cinemas.html?film=missing', manifest), (404, None))
        self.assertEqual(resolve_url('/en/films/missing/', manifest), (404, None))
        self.assertEqual(resolve_url('/EN/FILMS/DUNE-1984', manifest), (301, '/en/films/dune-1984/'))
        self.assertEqual(resolve_url('/en/films/dune-1984/index.html', manifest), (301, '/en/films/dune-1984/'))

    def test_naive_time_cannot_enter_published_showtimes(self):
        self.data['films'][0]['sessions'][0]['starts_at'] = '2026-11-20T19:00:00'
        with self.assertRaises(ValueError):
            validate_programme(self.data)


if __name__ == '__main__':
    unittest.main()
