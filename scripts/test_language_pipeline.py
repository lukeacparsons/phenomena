"""Language coverage must not trade identity, provenance, or multilingual accuracy for counts."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from language_names import parse_languages, language_code
from language_evidence import resolve, session_reports, review_report
from language_sources import discover
from cinema_languages import enrich, matches, page_facts
from film_identity import parse_source, source_urls, keys
from original_audio import a1_audio
from tmdb_languages import lookup, lookup_source, enrich as tmdb_enrich
from film_grouping import merge

NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)


def claim(source, raw, **extra):
    return {'source': source, 'raw': raw, 'source_url': 'https://example.org/' + source,
            'evidence': 'explicit_original_language', 'status': 'ok', 'checked_at': NOW.isoformat(), **extra}


class LanguagePipelineTests(unittest.TestCase):
    def test_multilingual_lists_preserve_swedish_and_unknown_labels(self):
        self.assertEqual(parse_languages('Suec, francès i anglès')['codes'], ['sv', 'fr', 'en'])
        value = parse_languages('English, Unfamiliar language')
        self.assertEqual(value['unknown'], ['Unfamiliar language'])
        self.assertFalse(value['complete'])
        details = resolve({}, [claim('cinema', 'English, Unfamiliar language')], NOW)
        self.assertEqual(details['languages'], [])
        self.assertIn('unrecognised_language_labels', details['language_status']['issues'])

    def test_mandarin_and_cantonese_are_distinct(self):
        self.assertEqual(parse_languages('Chinese, mandarí, cantonès')['codes'], ['zh', 'cmn', 'yue'])
        self.assertEqual(language_code('fra'), 'fr')

    def test_source_disagreement_does_not_create_a_language_union(self):
        details = resolve({}, [claim('rotten_tomatoes', 'English'), claim('wikidata', 'English, Spanish')], NOW)
        self.assertEqual(details['languages'], ['English'])
        self.assertEqual(details['language_status']['state'], 'conflict')
        self.assertEqual(len(details['language_reports']), 2)
        details = resolve({}, [claim('cinema', 'French'), claim('tmdb', 'English')], NOW)
        self.assertEqual(details['languages'], ['French'])
        self.assertEqual(details['language_status']['state'], 'conflict')

    def test_original_and_other_spoken_languages_remain_separate(self):
        get = Mock(side_effect=[{'movie_results': [{'id': 100}]}, {'id': 100, 'imdb_id': 'tt1234567',
            'original_language': 'en', 'spoken_languages': [{'iso_639_1': 'en'}, {'iso_639_1': 'es'}]}])
        result = lookup('tt1234567', get, NOW)
        self.assertEqual(result['codes'], ['en'])
        self.assertEqual(result['spoken_languages'], ['English', 'Spanish'])
        self.assertEqual(get.call_args_list[0].kwargs, {'external_source': 'imdb_id'})

    def test_tmdb_must_confirm_exact_imdb_identity(self):
        get = Mock(side_effect=[{'movie_results': [{'id': 100}]}, {'id': 100, 'imdb_id': 'tt9999999', 'original_language': 'en'}])
        with self.assertRaises(ValueError): lookup('tt1234567', get, NOW)
        self.assertEqual(lookup('tt1234567', Mock(return_value={'movie_results': [{'id': 1}, {'id': 2}]}), NOW)['status'], 'ambiguous')

    def test_imdb_free_tmdb_match_requires_published_director_and_year(self):
        facts={'titles':['Example'],'directors':['Correct Director'],'years':[2025],'runtimes':[95],'sources':['https://cinema.example/film']}
        movie={'id':100,'imdb_id':'tt1234567','original_language':'sv','runtime':95,
               'credits':{'crew':[{'name':'Correct Director','job':'Director'}]}}
        candidates={'results':[{'id':100,'title':'Example','release_date':'2025-10-01'}]}
        get=Mock(side_effect=[candidates,movie])
        result=lookup_source(facts,get,NOW)
        self.assertEqual(result['codes'],['sv'])
        self.assertEqual(result['identity_evidence']['matched'],['title','director','release_year'])
        movie['credits']['crew'][0]['name']='Wrong Director'
        self.assertEqual(lookup_source(facts,Mock(side_effect=[candidates,movie]),NOW)['status'],'unmatched')
        get=Mock(side_effect=AssertionError('Title-only matching is forbidden'))
        self.assertEqual(lookup_source({'titles':['Example']},get,NOW)['status'],'needs_identity_evidence')

    def test_subtitle_and_age_rating_text_do_not_become_language_labels(self):
        html='<p>Versió original en francès subtitulada al català / No recomenada a menors de 7 anys.</p>'
        facts=parse_source(html)
        self.assertEqual(facts['languages'],['fr'])
        self.assertEqual(facts['language_unknown'],[])

    def test_tmdb_cache_keeps_facts_and_does_not_log_sensitive_errors(self):
        films = [{'id': 'imdb:tt1234567', 'imdb_id': 'tt1234567'}]
        get = Mock(side_effect=[{'movie_results': [{'id': 100}]}, {'id': 100, 'imdb_id': 'tt1234567', 'original_language': 'en'}])
        with tempfile.TemporaryDirectory() as directory:
            tmdb_enrich(films, directory, NOW, get=get)
            tmdb_enrich(films, directory, NOW + timedelta(minutes=10), get=get)
            self.assertEqual(get.call_count, 2)
            result = tmdb_enrich(films, directory, NOW + timedelta(days=2), get=Mock(side_effect=OSError('secret-token')))
        record = result['films']['tt1234567']
        self.assertEqual(record['codes'], ['en'])
        self.assertEqual(record['checked_at'], NOW.isoformat())
        self.assertEqual(record['status'], 'stale')
        self.assertNotIn('secret-token', json.dumps(result))

    def test_vo_and_subtitle_language_alone_never_establish_original_language(self):
        film = {'sessions': [{'provider': 'cinesa', 'original_audio': True, 'source_version': 'VOSE', 'subtitles': 'Español'}]}
        self.assertEqual(session_reports(film), [])
        details = resolve({}, [], NOW)
        self.assertEqual(details['language_status']['state'], 'unresolved')

    def test_yelmo_legacy_label_is_recovered_without_borrowing_subtitle_language(self):
        film = {'sessions': [{'provider': 'yelmo', 'original_audio': True, 'language': None,
                 'source_version': 'COREANO SUBTITULADO EN INGLÉS (VOSI)',
                 'original_audio_evidence': 'explicit_original_version'}]}
        details = resolve({}, session_reports(film), NOW)
        self.assertEqual(details['languages'], ['Korean'])

    def test_a1_original_field_survives_collection(self):
        session = a1_audio({'version': 'VOSE', 'language': 'Sueco', 'woriginalversio': 'Sueco', 'subtitles_lang': 'Castellano'})
        self.assertEqual(session['original_language_raw'], 'Sueco')
        self.assertEqual(session['screening_audio'], 'Sueco')
        self.assertEqual(session['subtitles'], 'Español')

    def test_native_feed_original_does_not_need_imdb(self):
        film = {'id': 'girona:9', 'title': 'Example', 'sessions': [{'provider': 'girona', 'film_id': '9', 'title': 'Example'}]}
        body = json.dumps({'result': [{'title_id': 9, 'title_name': 'Example', 'title_slug': 'example', 'woriginalversio': 'Sueco'}]}).encode()
        with tempfile.TemporaryDirectory() as directory:
            reports, _ = discover([film], directory, Mock(return_value=body), NOW)
        self.assertEqual(resolve({}, reports[film['id']], NOW)['languages'], ['Swedish'])
        self.assertIn('https://www.cinemesgirona.cat/example', source_urls(film))

    def test_festival_prefix_matches_but_sequel_is_preserved(self):
        self.assertEqual(keys(['[Circles - Lesbian Film Festival] La belle année']), keys(['La belle année']))
        self.assertNotEqual(keys(['La belle année 2']), keys(['La belle année']))

    def test_filmoteca_structured_fields_help_identity_without_inventing_language(self):
        html = '<h1>Roma, città aperta</h1><div><span class="table-section-title">Direcció</span>Roberto Rossellini</div><div><span class="table-section-title">Any</span>1945</div>'
        facts = parse_source(html)
        self.assertEqual(facts['directors'], ['Roberto Rossellini'])
        self.assertEqual(facts['years'], [1945])
        self.assertEqual(facts['languages'], [])

    def test_filmoteca_translated_or_truncated_booking_title_uses_exact_booking_id(self):
        html='<h1>Roma, città aperta</h1><a href="https://euromus.cultura.gencat.cat/filmoteca/venda/index.jsp?codiActiv=1025&amp;codiCicle=6">Tickets</a>'
        facts=page_facts(html)
        film={'title':'Roma, città aperta / Roma, ciutat oberta','sessions':[{'provider':'filmoteca','film_id':'1025:6'}]}
        self.assertTrue(matches(film,facts))
        film['sessions'][0]['film_id']='999:6'
        self.assertFalse(matches(film,facts))

    def test_texas_audio_label_excludes_subtitles_and_related_film_names(self):
        html='<h1>Example</h1><div class="info-extra"><div class="duration">ANGLÈS SUBTITULAT AL CATALÀ / VOSC</div></div><h2>Spanish film</h2>'
        facts=parse_source(html)
        self.assertEqual(facts['languages'],['en'])
        self.assertEqual(facts['language_evidence'],['original_version_audio'])
        self.assertEqual(parse_source(html.replace('VOSC','DOBLAT'))['languages'],[])

    def test_festival_structured_title_director_year_are_read_without_biography(self):
        html='<dl><dt>Título internacional</dt><dd>Example</dd><dt>Año</dt><dd>2026</dd><dt>Duración</dt><dd>95 min</dd></dl><div class="director-info"><h2>A Person y B Person</h2><p>English biography</p></div>'
        facts=parse_source(html)
        self.assertEqual(facts['titles'],['Example'])
        self.assertEqual(facts['years'],[2026])
        self.assertEqual(facts['directors'],['A Person','B Person'])
        self.assertEqual(facts['languages'],[])

    def test_language_enrichment_survives_imdb_free_catalogue_rebuild(self):
        film = {'id': 'cinema:1', 'title': 'Example', 'sessions': [{'provider': 'cinema', 'film_url': 'https://example.org/film'}]}
        with tempfile.TemporaryDirectory() as directory:
            data = {'films': [deepcopy(film)]}
            enrich(data, Path(directory), Mock(return_value=b'<h1>Example</h1><p>Idioma original: Sueco</p>'), NOW, reviewed={})
            data = {'films': [deepcopy(film)]}
            enrich(data, Path(directory), Mock(side_effect=OSError()), NOW + timedelta(days=2), reviewed={})
            self.assertEqual(data['films'][0]['details']['languages'], ['Swedish'])
            review = json.loads((Path(directory)/'language-review.json').read_text())
            self.assertEqual(review['regressions'], [])
            self.assertIn('stale_source', review['queue'][0]['issues'])

    def test_no_dialogue_is_explicit_and_unresolved_programmes_stay_in_queue(self):
        details = resolve({}, [claim('cinema', 'sense diàlegs')], NOW)
        self.assertEqual(details['language_status']['state'], 'no_spoken_language')
        self.assertEqual(details['languages'], ['No spoken language'])
        film = {'id': 'double-bill', 'title': 'Two films', 'details': resolve({}, [], NOW)}
        report = review_report([film], {}, NOW, tmdb_status='configured')
        self.assertEqual(report['queue'][0]['next_action'], 'resolve_film_or_programme_identity')

    def test_merging_duplicate_films_retains_disagreeing_language_evidence(self):
        films=[{'id':'a','title':'Example','sessions':[], 'details':resolve({},[claim('cinema','French')],NOW)},
               {'id':'b','title':'Example','sessions':[], 'details':resolve({},[claim('tmdb','English')],NOW)}]
        result=merge(films,imdb='tt1234567')
        self.assertEqual(len(result['details']['language_reports']),2)
        self.assertEqual(result['details']['language_status']['state'],'conflict')
        self.assertEqual(len(result['details']['languages']),1)


if __name__ == '__main__': unittest.main()
