"""Cinema metadata must preserve multilingual audio and venue-specific subtitles."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from cinema_languages import enrich, refresh, page_facts
from film_identity import parse_source

NOW=datetime(2026,11,19,tzinfo=timezone.utc)
MALDA='https://www.cinemamalda.com/la-carn/'
ZUMZEIG='https://zumzeigcine.coop/cinema/films/la-carn-1/'
HTML='''<h1>La Carn(VOCAT)</h1><p>«La Carn» / España: 2026 / Dirección: Joan Porcel / Intérpretes: Lluís Garau /
Drama / 83 min / Versión original en català y castellano, subtitulos en castellano / No recomendada para menores de 18 años.</p>'''
ZHTML='''<h1>La carn</h1><p>Títol original: La carn</p><p>Direcció: Joan Porcel</p><p>Any: 2025</p>
<p>Durada: 83'</p><p>Idioma original: Català, castellà, anglès</p><p>Versió: VO</p>'''


def film():
    return {'id':'zumzeig:38413','title':'La carn','imdb_id':'tt36617713','release_year':2025,
            'details':{'directors':['Joan Porcel'],'runtime_minutes':83,'languages':[],
                       'search_aliases':['Drama'],'sources':[]},
            'sessions':[{'id':'zumzeig:1','provider':'zumzeig','title':'La carn',
                         'original_audio':True,'language':None,'subtitles':None,'version':'VO','source_url':ZUMZEIG}]}


class LanguageTests(unittest.TestCase):
    def test_malda_comma_subtitles_and_multiple_audio_languages(self):
        self.assertEqual(parse_source(HTML)['languages'],['ca','es'])
        self.assertEqual(parse_source(HTML.replace('subtitulos en castellano','subtítulos en inglés'))['languages'],['ca','es'])
        self.assertEqual(parse_source(HTML.replace('català y castellano','francés').replace('subtitulos en castellano','con subtítulos en inglés'))['languages'],['fr'])
        self.assertEqual(page_facts(HTML)['page_titles'],['La Carn'])

    def test_labels_and_conjunctions_preserve_every_original_language(self):
        for label in ['Idioma original: Català, castellà, anglès',
                      'Versión original en català y castellano e inglés',
                      'Versió original en català, castellà i anglès',
                      'Idioma original: Català/castellà/anglès']:
            self.assertEqual(parse_source('<p>'+label+'</p><p>Versión: VO</p>')['languages'],['ca','es','en'],label)

    def test_subtitles_nationality_and_synopsis_language_do_not_establish_audio(self):
        for html in ['<h1>Film (VOSE)</h1><p>Subtítulos en castellano</p>',
                     '<p>País: España / Sinopsis: un profesor de inglés.</p>',
                     '<h1>Original Story</h1><p>Español</p>']:
            self.assertEqual(parse_source(html)['languages'],[])

    def test_source_languages_fill_details_without_changing_other_venue_sessions(self):
        data={'films':[film()]};before=deepcopy(data['films'][0]['sessions'])
        fetch=Mock(side_effect=lambda url:(HTML if url==MALDA else ZHTML).encode())
        with tempfile.TemporaryDirectory() as folder:
            result=enrich(data,Path(folder),fetch,NOW,reviewed={'imdb:tt36617713':[MALDA]})
        f=data['films'][0]
        self.assertEqual(f['details']['languages'],['Catalan','Spanish','English'])
        self.assertEqual(len(f['details']['language_provenance']),2)
        self.assertEqual(f['release_year'],2025)
        self.assertEqual(f['sessions'],before)
        self.assertIn('English',f['details']['search_aliases'])
        self.assertEqual(result['films_with_cinema_languages'],1)

    def test_wrong_page_and_wrong_director_do_not_supply_languages(self):
        for html in [HTML.replace('La Carn','Unrelated film'),HTML.replace('Joan Porcel','Marco Ferreri'),
                     '<h1>Other film</h1><p>Idioma original: Francès</p><aside>La carn</aside>']:
            data={'films':[film()]}
            with tempfile.TemporaryDirectory() as folder:
                enrich(data,Path(folder),lambda url:html.encode(),NOW,reviewed={})
            self.assertEqual(data['films'][0]['details']['languages'],[])

    def test_known_publisher_languages_are_preserved(self):
        f=film();f['details']['languages']=['Catalan'];fetch=Mock(side_effect=AssertionError('No lookup'))
        with tempfile.TemporaryDirectory() as folder:enrich({'films':[f]},Path(folder),fetch,NOW,reviewed={})
        self.assertEqual(f['details']['languages'],['Catalan']);fetch.assert_not_called()

    def test_official_cinema_can_replace_unranked_catalogue_languages(self):
        f=film();f['details'].update(languages=['Spanish','Catalan'],search_aliases=['Spanish','Catalan'],
            language_selection={'source':'wikidata','evidence':'catalogue_language_list'},
            language_reports=[{'source':'wikidata','languages':['Spanish','Catalan']}])
        html=ZHTML.replace('Català, castellà, anglès','Català')
        with tempfile.TemporaryDirectory() as folder:
            enrich({'films':[f]},Path(folder),lambda url:html.encode(),NOW,reviewed={})
        self.assertEqual(f['details']['languages'],['Catalan'])
        self.assertEqual(f['details']['language_selection']['source'],'cinema')
        self.assertNotIn('Spanish',f['details']['search_aliases'])
        self.assertEqual(f['sessions'][0]['version'],'VO')

    def test_page_without_metadata_is_cached_without_being_a_transport_failure(self):
        fetch=Mock(return_value=b'<p>Buy tickets</p>')
        with tempfile.TemporaryDirectory() as folder:
            data={'films':[film()]}
            result=enrich(data,Path(folder),fetch,NOW,reviewed={})
            self.assertFalse(result['has_failures'])
            self.assertEqual(result['pages'][ZUMZEIG]['status'],'unmatched')
            enrich(data,Path(folder),fetch,NOW+timedelta(hours=1),reviewed={})
            self.assertEqual(fetch.call_count,1)

    def test_source_metadata_can_work_without_imdb(self):
        f=film();del f['imdb_id'];del f['details']
        with tempfile.TemporaryDirectory() as folder:enrich({'films':[f]},Path(folder),lambda url:ZHTML.encode(),NOW,reviewed={})
        self.assertEqual(f['details']['languages'],['Catalan','Spanish','English'])

    def test_cache_reused_and_failed_refresh_keeps_original_check_time(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder);fetch=Mock(return_value=ZHTML.encode())
            data={'films':[film()]};enrich(data,output,fetch,NOW,reviewed={})
            enrich(data,output,fetch,NOW+timedelta(hours=1),reviewed={})
            self.assertEqual(fetch.call_count,1)
            result=enrich(data,output,Mock(side_effect=OSError()),NOW+timedelta(days=2),reviewed={})
            source=data['films'][0]['details']['language_provenance'][0]
            self.assertEqual(source['status'],'stale')
            self.assertEqual(source['checked_at'],NOW.isoformat())
            self.assertEqual(data['films'][0]['details']['languages'],['Catalan','Spanish','English'])
            self.assertTrue(result['has_failures'])

    def test_targeted_refresh_preserves_concurrent_sessions_and_other_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'screenings.json';data={'films':[film()]};path.write_text(json.dumps(data))
            def fetch(url):
                latest=json.loads(path.read_text());latest['films'][0]['details']['cast']=['Newly verified actor']
                latest['films'][0]['sessions'][0]['starts_at']='2026-12-01T19:00:00+01:00'
                path.write_text(json.dumps(latest));return (HTML if url==MALDA else ZHTML).encode()
            # Only one source to keep the test's concurrent edit deterministic.
            data['films'][0].pop('imdb_id');path.write_text(json.dumps(data))
            refresh(path,fetch,NOW)
            result=json.loads(path.read_text())['films'][0]
            self.assertEqual(result['details']['cast'],['Newly verified actor'])
            self.assertEqual(result['sessions'][0]['starts_at'],'2026-12-01T19:00:00+01:00')
            self.assertEqual(result['details']['languages'],['Catalan','Spanish','English'])


if __name__=='__main__':unittest.main()
