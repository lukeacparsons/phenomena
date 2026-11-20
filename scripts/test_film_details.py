from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

from film_details import combine, enrich, parse_fa, parse_rt, parse_wikidata


RT = '''<script type="application/ld+json">{"@type":"Movie","director":[{"name":"Denis Villeneuve"}],"actor":[{"name":"Timothée Chalamet"}],"genre":["Sci-Fi"],"contentRating":"PG-13"}</script>
<div data-qa="item"><dt data-qa="item-label">Screenwriter</dt><dd><a data-qa="item-value">Eric Roth</a></dd></div>
<div data-qa="item"><dt data-qa="item-label">Runtime</dt><dd data-qa="item-value">2h 35m</dd></div>
<div data-qa="item"><dt data-qa="item-label">Release Date (Theaters)</dt><dd data-qa="item-value">Oct 22, 2021, Wide</dd></div>
<div data-qa="item"><dt data-qa="item-label">Rerelease Date (Theaters)</dt><dd data-qa="item-value">Nov 13, 2026</dd></div>'''
FA = '''<h1 id="main-title">Dune</h1><dl><dt>Guion</dt><dd><div><span><a href="/es/name.php?name-id=1">Eric Roth</a></span><span><a href="/es/name.php?name-id=2">Jon Spaihts</a></span><i>Novelas:</i><span><a href="/es/name.php?name-id=3">Frank Herbert</a></span></div></dd>
<dt>Reparto</dt><dd><a href="/es/name.php?name-id=4"><img alt="Timothée Chalamet"><div>Timothée Chalamet</div></a><a href="/es/fullcredits.php?movie_id=1">Ver todos los créditos</a></dd>
<dt>Género</dt><dd><span itemprop="genre">Ciencia ficción</span></dd><dt>Duración</dt><dd>155 min.</dd><dt>Año</dt><dd>2021</dd></dl>'''


def binding(prop="P57", item="Q1", **extra):
    return {k: {"value": v} for k, v in {"imdb": "tt1160419", "item": "http://www.wikidata.org/entity/" + item,
        "property": "http://www.wikidata.org/prop/direct/" + prop, "value": "http://www.wikidata.org/entity/Q2",
        "valueLabel": "Denis Villeneuve", **extra}.items()}


class FilmDetailsTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        credential_patch = patch('tmdb_languages.credentials', return_value={})
        credential_patch.start()
        self.addCleanup(credential_patch.stop)

    def test_rt_credits_genre_and_territory_specific_release(self):
        facts = parse_rt(RT)
        self.assertEqual(facts["directors"], ["Denis Villeneuve"])
        self.assertEqual(facts["writers"], ["Eric Roth"])
        self.assertEqual(facts["cast"], ["Timothée Chalamet"])
        self.assertEqual(facts["genres"], ["Sci-Fi"])
        self.assertEqual(facts["runtime_minutes"], 155)
        self.assertEqual(facts["release_dates"], [{"date": "2021-10-22", "region": "United States", "kind": "theatrical"}])

    def test_source_author_is_not_mislabelled_as_screenwriter(self):
        facts = parse_fa(FA)
        self.assertEqual(facts["writers"], ["Eric Roth", "Jon Spaihts"])
        self.assertEqual(facts["source_authors"], ["Frank Herbert"])
        self.assertEqual(facts["cast"], ["Timothée Chalamet"])
        self.assertEqual(facts["genres"], ["Ciencia ficción"])

    def test_invalid_or_ambiguous_pages_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_rt(RT + '<script type="application/ld+json">{"@type":"Movie"}</script>')
        for parse in (parse_rt, parse_fa):
            with self.assertRaises(ValueError):
                parse('<html>Access denied</html>')

    def test_synopsis_uses_the_verified_film_record(self):
        rt = parse_rt(RT.replace('"@type":"Movie"', '"@type":"Movie","description":"A journey across a desert planet."'))
        fa = parse_fa(FA.replace('</dl>', '<dt>Sinopsis</dt><dd>Un viaje por un planeta desértico.</dd></dl>'))
        self.assertEqual(rt['synopsis'], 'A journey across a desert planet.')
        self.assertEqual(fa['synopsis'], 'Un viaje por un planeta desértico.')
        combined = combine({'rotten_tomatoes': {'facts': rt, 'url': 'https://example.com/rt', 'status': 'ok'},
                            'filmaffinity': {'facts': fa, 'url': 'https://example.com/fa', 'status': 'ok'}})
        self.assertEqual(combined['synopsis'], rt['synopsis'])
        self.assertEqual(combined['synopses'], [rt['synopsis'], fa['synopsis']])

    def test_rt_synopsis_uses_story_text_and_rejects_seo_boilerplate(self):
        seo = 'Discover reviews, ratings, and trailers for La Bola Negra on Rotten Tomatoes. Stay updated with critic and audience scores today!'
        page = RT.replace('"@type":"Movie"', '"@type":"Movie","description":' + json.dumps(seo))
        self.assertNotIn('synopsis', parse_rt(page))
        facts = parse_rt(page + '<rt-text data-qa="synopsis-value">Three lives in 1932, 1937 and 2017.</rt-text>')
        self.assertEqual(facts['synopsis'], 'Three lives in 1932, 1937 and 2017.')
        from browser_programme import browser_programme
        p = browser_programme({'films': [{'id': 'story', 'details': {'synopsis': seo},
            'sessions': [{'synopsis': 'Una obra de Federico García Lorca.'}]}]})
        self.assertEqual(p['films'][0]['synopsis'], 'Una obra de Federico García Lorca.')
        self.assertNotIn('Discover reviews', json.dumps(p))

    def test_story_topics_are_kept_separate_from_genres(self):
        page = FA.replace('</dl>', '<dt>Género</dt><dd><span itemprop="genre">Drama</span> | <a href="/es/movietopic.php?topic=607659">Guerra Civil Española</a></dd></dl>')
        facts = parse_fa(page)
        self.assertEqual(facts['genres'], ['Drama'])
        self.assertEqual(facts['topics'], ['Guerra Civil Española'])
        combined = combine({'filmaffinity': {'facts': facts, 'url': 'https://example.com/fa', 'status': 'ok'}})
        self.assertEqual(combined['topics'], ['Guerra Civil Española'])
        self.assertIn('Guerra Civil Española', combined['search_aliases'])

    def test_wikidata_dates_keep_precision_and_country(self):
        rows = [binding("P577", value="2021-01-01T00:00:00Z", precision="9"),
                binding("P577", value="2021-09-01T00:00:00Z", precision="10", placeLabel="Spain"),
                binding("P577", value="2021-09-17T00:00:00Z", precision="11", placeLabel="Spain")]
        dates = parse_wikidata(rows)["tt1160419"]["facts"]["release_dates"]
        self.assertEqual([d["date"] for d in dates], ["2021", "2021-09", "2021-09-17"])
        self.assertEqual(dates[-1]["region"], "Spain")

    def test_ambiguous_wikidata_id_is_rejected(self):
        self.assertEqual(parse_wikidata([binding(), binding(item="Q3")]), {})

    def test_wikidata_colour_is_a_factual_attribute(self):
        facts = parse_wikidata([binding('P462', valueLabel='black-and-white')])['tt1160419']['facts']
        self.assertEqual(facts['colours'], ['black-and-white'])

    def test_english_facts_preserve_translated_genres_for_search(self):
        wd = parse_wikidata([binding("P136", valueLabel="science fiction film", esLabel="película de ciencia ficción", caLabel="pel·lícula de ciència-ficció")])
        sources = {"rotten_tomatoes": {"facts": parse_rt(RT), "url": "https://example.com/rt", "status": "ok"},
                   "filmaffinity": {"facts": parse_fa(FA), "url": "https://example.com/fa", "status": "ok"},
                   "wikidata": {**wd["tt1160419"], "status": "ok"}}
        facts = combine(sources)
        self.assertEqual(facts["writers"], ["Eric Roth", "Jon Spaihts"])
        self.assertEqual(facts["genres"], ["Science fiction"])
        self.assertIn("science fiction film", facts["search_aliases"])
        self.assertIn("Ciencia ficción", facts["search_aliases"])
        self.assertIn("pel·lícula de ciència-ficció", facts["search_aliases"])

    def test_voice_cast_is_collected_and_generic_duplicate_release_removed(self):
        wd = parse_wikidata([binding("P725", valueLabel="Yuriko Ishida")])
        self.assertEqual(wd["tt1160419"]["facts"]["cast"], ["Yuriko Ishida"])
        date = {"date": "2021-10-22", "region": "United States"}
        sources = {"wikidata": {"facts": {"release_dates": [{**date, "kind": "release"}]}, "url": "https://example.com/wd", "status": "ok"},
                   "rotten_tomatoes": {"facts": {"release_dates": [{**date, "kind": "theatrical"}, {**date, "kind": "streaming"}]}, "url": "https://example.com/rt", "status": "ok"}}
        self.assertEqual(len(combine(sources)["release_dates"]), 2)

    def test_explicit_original_language_overrides_broader_catalogue_list(self):
        sources = {
            "wikidata": {"url": "https://www.wikidata.org/entity/Q133341572", "status": "ok",
                         "facts": {"languages": ["Spanish", "English"], "search_aliases": ["español", "espanyol", "English", "inglés"]}},
            "rotten_tomatoes": {"url": "https://www.rottentomatoes.com/m/wild_horse_nine", "status": "ok",
                                "facts": {"languages": ["English"]}}}
        facts = combine(sources)
        self.assertEqual(facts["languages"], ["English"])
        self.assertEqual(facts["language_selection"]["source"], "rotten_tomatoes")
        self.assertEqual(facts["language_reports"][0]["languages"], ["Spanish", "English"])
        for alias in ("Spanish", "español", "espanyol"):
            self.assertNotIn(alias, facts["search_aliases"])
        self.assertIn("inglés", facts["search_aliases"])

    def test_multiple_explicit_original_languages_are_not_reduced_to_first(self):
        facts = combine({"rotten_tomatoes": {"url": "https://example.com/rt", "status": "ok",
                          "facts": {"languages": ["Korean", "English"]}}})
        self.assertEqual(facts["languages"], ["Korean", "English"])
        self.assertEqual(facts["language_selection"]["evidence"], "explicit_original_language")

    def test_catalogue_languages_are_labelled_as_reports_not_primary_language(self):
        facts = combine({"wikidata": {"url": "https://example.com/wd", "status": "ok",
                          "facts": {"languages": ["Spanish", "English"]}}})
        self.assertEqual(facts["languages"], ["Spanish", "English"])
        self.assertEqual(facts["language_selection"]["evidence"], "catalogue_language_list")

    def test_publisher_regional_language_labels_keep_language_search_aliases(self):
        facts = combine({"wikidata": {"url": "https://example.com/wd", "status": "ok",
                            "facts": {"languages": ["English"], "search_aliases": ["inglés", "anglès"]}},
                         "rotten_tomatoes": {"url": "https://example.com/rt", "status": "ok",
                            "facts": {"languages": ["British English"]}}})
        self.assertEqual(facts["languages"], ["English"])
        self.assertIn("inglés", facts["search_aliases"])
        self.assertEqual(facts["language_reports"][1]["languages"], ["British English"])

    def test_country_and_title_alone_do_not_supply_original_language(self):
        facts = combine({"wikidata": {"url": "https://example.com/wd", "status": "ok",
                          "facts": {"countries": ["Spain"], "original_title": "Un título español"}}})
        self.assertEqual(facts["languages"], [])
        self.assertNotIn("language_selection", facts)

    def test_producers_are_retained_but_only_other_credits_are_searchable(self):
        wd = parse_wikidata([binding("P162", valueLabel="Brad Pitt")])["tt1160419"]
        self.assertEqual(wd["facts"]["producers"], ["Brad Pitt"])
        self.assertNotIn("Brad Pitt", wd["facts"].get("search_aliases", []))
        sources = {
            "wikidata": {"facts": {"producers": ["Brad Pitt", "Dede Gardner"], "search_aliases": ["BRÁD PITT", "Dede Gardner"]},
                         "url": "https://example.com/wd", "status": "ok"},
            "rotten_tomatoes": {"facts": {"producers": ["Brad Pitt"], "cast": ["Matt Damon"]},
                                "url": "https://example.com/rt", "status": "ok"}}
        facts = combine(sources)
        self.assertEqual(facts["producers"], ["Brad Pitt", "Dede Gardner"])
        self.assertEqual(facts["search_aliases"], ["Matt Damon"])
        sources["rotten_tomatoes"]["facts"]["cast"].append("Brad Pitt")
        self.assertIn("BRÁD PITT", combine(sources)["search_aliases"])

    def test_company_list_excludes_individual_producer(self):
        html = '<h1 id="main-title">Film</h1><dl><dt>Compañías</dt><dd><a href="/es/name.php?name-id=1">Studio</a><i>Productor:</i><a href="/es/name.php?name-id=2">A Person</a></dd></dl>'
        self.assertEqual(parse_fa(html)["studios"], ["Studio"])

    def test_coproduction_and_distribution_are_separate_explicit_credits(self):
        html = '<h1 id="main-title">Film</h1><dl><dt>País</dt><dd>Francia</dd><dt>Compañías</dt><dd>Coproducción Francia-Italia; <a href="/es/name.php?name-id=1">Studio</a><i>Distribuidora:</i><a href="/es/name.php?name-id=2">A24</a><i>Productor:</i><a href="/es/name.php?name-id=3">A Person</a></dd></dl>'
        facts = parse_fa(html)
        self.assertEqual(facts['countries'], ['France', 'Italy'])
        self.assertEqual(facts['country_evidence'], 'explicit_coproduction')
        self.assertEqual(facts['studios'], ['Studio'])
        self.assertEqual(facts['distributors'], ['A24'])
        rt = parse_rt(RT + '<div data-qa="item"><dt data-qa="item-label">Distributor</dt><dd data-qa="item-value">A24</dd></div>')
        self.assertEqual(rt['distributors'], ['A24'])
        self.assertNotIn('A24', rt['producers'])

    def test_country_claims_require_evidence_and_rejected_aliases_do_not_leak(self):
        sources = {'wikidata': {'url': 'https://www.wikidata.org/entity/Q1', 'status': 'ok',
            'facts': {'countries': ['United States', 'Italy', 'The Gambia'], 'search_aliases': ['Italia', 'Italy', 'United States']}},
            'filmaffinity': {'url': 'https://example.com/film', 'status': 'ok', 'facts': {'countries': ['Estados Unidos']}}}
        facts = combine(sources)
        self.assertEqual(facts['countries'], ['United States'])
        self.assertEqual(facts['country_status']['excluded'], ['Italy', 'The Gambia'])
        self.assertNotIn('Italia', facts['search_aliases'])
        self.assertNotIn('Italy', facts['search_aliases'])
        self.assertEqual(facts['country_provenance'][0]['sources'][0]['source'], 'filmaffinity')
        self.assertEqual(combine({'wikidata': sources['wikidata']})['countries'], [])
        self.assertEqual(combine({'wikidata': sources['wikidata']})['country_status']['state'], 'unknown')

    def test_referenced_country_and_reviewed_coproduction_are_preserved(self):
        wd = parse_wikidata([binding('P495', valueLabel='Italy', referenceURL='https://example.com/credits')])['tt1160419']
        facts = combine({'wikidata': {**wd, 'status': 'ok'}})
        self.assertEqual(facts['countries'], ['Italy'])
        self.assertEqual(facts['country_provenance'][0]['sources'][0]['source_url'], 'https://example.com/credits')
        facts = combine({}, 'tt0212712')
        self.assertIn('Italy', facts['countries'])
        self.assertEqual(facts['country_provenance'][-1]['sources'][0]['source'], 'BFI')

    def test_cache_and_failed_refresh_retain_verified_facts(self):
        now = datetime(2026, 11, 19, tzinfo=timezone.utc)
        film = {"id": "film:1", "imdb_id": "tt1160419", "release_year": 2021}
        data = {"films": [film]}
        mappings = {"tt1160419": {"rotten_tomatoes": "https://www.rottentomatoes.com/m/dune_2021", "identity_source": "https://www.wikidata.org/entity/Q1"}}
        calls = []
        def fetch(url):
            calls.append(url)
            return json.dumps({"results": {"bindings": [binding()]}}).encode() if "wikidata" in url else RT.encode()
        with tempfile.TemporaryDirectory() as directory:
            enrich(data, Path(directory), mappings, fetch, now)
            self.assertEqual(film["details"]["directors"], ["Denis Villeneuve"])
            calls.clear()
            enrich(data, Path(directory), mappings, fetch, now + timedelta(hours=1))
            self.assertEqual(calls, [])
            def fail(url):
                raise OSError("Offline")
            enrich(data, Path(directory), mappings, fail, now + timedelta(days=8))
            self.assertEqual(film["details"]["directors"], ["Denis Villeneuve"])
            self.assertTrue(all(s["status"] == "stale" for s in film["details"]["sources"]))
            self.assertTrue(all(s["checked_at"] == now.isoformat() for s in film["details"]["sources"]))

    def test_missing_identity_does_not_borrow_other_film_details(self):
        data = {"films": [{"id": "double-bill", "details": {"directors": ["Wrong director"]}}]}
        with tempfile.TemporaryDirectory() as directory:
            enrich(data, Path(directory), {}, lambda url: self.fail("Unexpected request"), datetime.now(timezone.utc))
        self.assertNotIn('directors', data['films'][0]['details'])
        self.assertEqual(data['films'][0]['details']['language_status']['state'], 'unresolved')


if __name__ == "__main__":
    unittest.main()
