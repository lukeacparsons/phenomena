"""Regressions for original-vs-dubbed variants and expanded source identities."""
from copy import deepcopy
from datetime import datetime, date, timezone
import json
import unittest

from original_audio import original_audio, a1_audio, original_language_registry
from catalogue_sources import (filmoteca_sessions, filmax_sessions, renoir_sessions,
                               texas_calendar, texas_session, malda_sessions, malda_home_sessions,
                               collect_malda, collect_a1, collect_zumzeig)
from explore_premium_showtimes import mooby_sessions
from cinesa_showtimes import cinesa_sessions, venue_for_cinema
from kinepolis_showtimes import splau_sessions
from test_premium_showtimes import mooby_fixture, mooby_html
from test_cinesa_showtimes import fixture as cinesa_fixture
from test_kinepolis_showtimes import fixture as splau_fixture

NOW = datetime.fromisoformat('2026-11-19T12:00:00+01:00')


class OriginalAudioTests(unittest.TestCase):
    def test_subtitles_do_not_decide_original_audio(self):
        for version in ('VOSE', 'VOSC', 'VOSI', 'VO', 'VOE', 'VOCATALAN', 'V.O. SUB. CASTELLANO',
                        'Versión Original Castellano', 'Versió original en català'):
            with self.subTest(version=version):
                self.assertTrue(original_audio(version)['original_audio'])
        self.assertEqual(original_audio('VOSC')['subtitles'], 'Català')
        self.assertEqual(original_audio('VOSI')['subtitles'], 'English')
        self.assertIsNone(original_audio('VO')['subtitles'])

    def test_native_spanish_requires_proof_and_dubbing_always_wins(self):
        self.assertIsNone(original_audio('ESPAÑOL', audio='es'))
        self.assertEqual(original_audio('ESP', audio='Espanyol,', original='es')['version'], 'VO')
        self.assertIsNone(original_audio('ESP', audio='es', original='en'))
        self.assertIsNone(original_audio('VOSE', audio='es', original='en'))
        for label in ['DOBLADA ESP VOSE', 'DOB. CAT', 'Versió doblada', 'VDE', 'VDC']:
            self.assertIsNone(original_audio(label, audio='es', original='es'))

    def test_a1_dubbed_spanish_is_not_original_castellano(self):
        event = {'version':'CASTELLANO', 'language':'Castellano', 'woriginalversio':'Inglés',
                 'wprovinceversio':'Doblada', 'wfeatureversion':'Doblada Castellano'}
        self.assertIsNone(a1_audio(event))
        event.update(woriginalversio='Castellano', wprovinceversio='Original', wfeatureversion='Original Castellano')
        self.assertEqual(a1_audio(event)['version'], 'VO')
        self.assertIsNone(a1_audio({'locale_title':'An Original Story', 'version':''}))
        self.assertIsNone(a1_audio({'locale_title':'Unmarked film', 'version':'', 'woriginalversio':'Inglés'}))

    def test_registry_rejects_internal_ids_and_conflicting_original_languages(self):
        data = {'result':[{'imdbid':'tt116914','woriginalversio':'Castellano'},
                          {'imdbid':'tt1234567','woriginalversio':'Castellano'},
                          {'imdbid':'tt1234567','woriginalversio':'Inglés'}]}
        self.assertEqual(original_language_registry([data]), {})

    def test_mooby_spanish_original_survives_but_dubbed_variant_does_not(self):
        shops = mooby_fixture(); event = shops['29']['events'][0]
        event.update(version='ESP',language='Castellano',subtitles_lang='')
        dubbed = deepcopy(event); dubbed['version']='DOBLADA ESP';shops['29']['events'].append(dubbed)
        rows = mooby_sessions(mooby_html(shops), premium_only=False, original_only=True,
                              original_languages={event['imdbid']:'es'})
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['version'],'VO')
        self.assertTrue(rows[0]['original_audio'])

    def test_cinesa_vo_is_accepted_but_unmarked_version_is_not(self):
        payload=cinesa_fixture();payload['showtimes'][0]['attributeIds']=['vo']
        self.assertEqual(cinesa_sessions(payload,date(2026,11,20),premium_only=False,original_only=True)[0]['version'],'VO')
        payload['showtimes'][0]['attributeIds']=['imax']
        self.assertEqual(cinesa_sessions(payload,date(2026,11,20),premium_only=False,original_only=True),[])
        self.assertEqual(venue_for_cinema('cinesa-diagonal'),'diagonal')
        self.assertEqual(venue_for_cinema('cinesa-som-multiespai'),'som-multiespai')
        with self.assertRaises(StopIteration):venue_for_cinema('unconfigured')

    def test_kinepolis_unsubtitled_original_audio_is_accepted(self):
        data=splau_fixture()
        for section in ['current_movies','future_movies']:
            film=data[section]['films'][0]
            film.update(audioLanguage='ES',originalAudioLanguage='ES',spokenLanguage=[])
            session=data[section]['sessions'][0]
            session.update(rawSessionAttributes='2D,Spanish,nosubt',sessionSubtitles=[])
        rows,_=splau_sessions(data,premium_only=False,original_only=True)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['version'],'VO')
        for section in ['current_movies','future_movies']:data[section]['films'][0]['originalAudioLanguage']='EN'
        self.assertEqual(splau_sessions(data,premium_only=False,original_only=True)[0],[])


class CatalogueTests(unittest.TestCase):
    def test_zumzeig_discovers_full_programme_and_ignores_placeholder_availability(self):
        external='https://entradas.codetickets.com/entradas/festival/77/festival/web'
        class HTTP:
            def get(self,url,**kwargs):
                if url=='https://zumzeigcine.coop/':return '<a href="/cinema/sessions/">Cartellera</a>'
                if url.endswith('/sessions/'):
                    return '<a href="/cinema/films/one/">One</a><a href="/cinema/films/two/">Two</a>'
                booking=external if '/two/' in url else 'https://www.codetickets.com/portal/zumzeigcooperativa/online/1/11'
                return '<div class="rowcontent">Versió: VOSE Qualificació: 12</div><a href="'+booking+'">Tickets</a>'
            def json(self,url):
                perf={'id':11,'fechaInicial':'2026-11-20T18:00:00+01:00','disponibles':0,'showDisponibles':True}
                if '/1/sesiones' in url:return [{**perf,'disponibles':42}]
                return [{'id':1,'nombre':'One','sesiones':[perf]},
                        {'id':2,'nombre':'Two','urlComprar':external,
                         'sesiones':[{**perf,'id':22,'recinto':'SALA ZUMZEIG'}]}]
        rows=collect_zumzeig(HTTP(),NOW)['sessions']
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]['seat_data']['available'],42)
        self.assertIsNone(rows[1]['seat_data'])
        self.assertEqual(rows[1]['booking_url'],external)

    def test_filmoteca_language_and_room_identity_are_session_specific(self):
        perf={'codiCicle':'7','descrip':'Film','dataCicle':'20/11/2026','horaI':'1800','codiRecinte':'1',
              'codiSala':'1','nomSala':'Chomón','codiIdioma':'10','hihaPlaces':30}
        other={**perf,'codiRecinte':'2','nomSala':'Laya','codiIdioma':'7','hihaPlaces':15}
        ambiguous=[{**perf,'codiCicle':code,'codiIdioma':code} for code in ('2','8','9')]
        payload=[{'codi':'1025','tipus':'C','hihaPlaces':900,'capacidad':'10','cicle':[perf,other,*ambiguous]}]
        rows=filmoteca_sessions(payload,{'10':'VO','8':'VE','9':'VC','7':'VOSE','2':'CAS'},NOW)['sessions']
        self.assertEqual(len(rows),2);self.assertEqual(len({r['id'] for r in rows}),2)
        self.assertEqual([r['seat_data']['available'] for r in rows],[30,15])
        self.assertEqual({r['version'] for r in rows},{'VO','VOSE'})

    def test_filmax_dubbed_audio_cannot_inherit_original_language_from_film(self):
        movie={'@type':'Movie','@id':'movie','name':'Film','sameAs':'https://www.imdb.com/title/tt1234567/'}
        perf={'@type':'ScreeningEvent','name':'Film','workPresented':{'@id':'movie'},
              'startDate':'2026-11-20T18:00:00+01:00','inLanguage':'es',
              'offers':{'url':'https://filmax.admit-one.eu/?p=tickets&perfCode=7'}}
        def html():return '<script type="application/ld+json">'+json.dumps({'@graph':[movie,perf]})+'</script>'
        self.assertEqual(filmax_sessions(html(),'https://cinesfilmax.com/film',{'tt1234567':'en'}),[])
        self.assertEqual(len(filmax_sessions(html(),'https://cinesfilmax.com/film',{'tt1234567':'es'})),1)
        perf['name']='Film (DOBLADA ESP)';self.assertEqual(filmax_sessions(html(),'x',{'tt1234567':'es'}),[])

    def test_renoir_original_spanish_and_mobile_duplicates(self):
        card='''<div class="my-account-content d-lg-block"><a href="/pelicula/film/">Film</a>
        <small>Versión Original Castellano</small><div class="pase-cartelera">sala 03
        <a href="https://www.pillalas.com/pase/barcelona/renoir-floridablanca/film/123/">18:00</a></div></div>'''
        html=card+card.replace('d-lg-block','d-lg-none')
        rows=renoir_sessions(html,'2026-11-20')
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['version'],'VO')
        with self.assertRaises(ValueError):renoir_sessions('Access denied','2026-11-20')

    def test_texas_time_comes_from_calendar_and_must_match_booking(self):
        url='https://espaitexas.koobin.cat/ca/film-vo-20261120-0000'
        html=f'<div id="day_2026-11-20"><a class="event pelicula" href="{url}"><div class="event-time">18:30</div></a></div>'
        starts=next(iter(texas_calendar(html).values()))
        booking="""<h1>FILM (VO)</h1><div>CINE: SALA 2</div><script>
        'eventData': {'id': '123', 'name': 'Film', 'date': '2026-11-20T18:30:00+01:00'},
        'base_event_id': '120'</script>"""
        item=texas_session(booking,starts,url)
        self.assertEqual(item['time'],'18:30');self.assertEqual(item['room'],'2')
        with self.assertRaises(ValueError):texas_session(booking.replace('18:30:00','00:00:00'),starts,url)
        self.assertIsNone(texas_session(booking.replace('(VO)','(DOB. CAT)'),starts,url))

    def test_malda_programme_year_and_original_spanish(self):
        html='<div class="sinopsi"><h2>CARTELERA DEL 13 AL 19 DE NOVIEMBRE DE 2026</h2><p>JUEVES 19 18:00h – EL NIÑO (VOE)</p></div>'
        rows=malda_sessions(html)
        self.assertEqual(rows[0]['starts_at'],'2026-11-19T18:00:00+01:00')
        self.assertEqual(rows[0]['booking_scope'],'box_office')
        with self.assertRaises(ValueError):malda_sessions(html.replace(' DE 2026',''))
        boundary=html.replace('13 AL 19 DE NOVIEMBRE DE 2026','27 AL 2 DE ENERO DE 2027').replace('JUEVES 19','DOMINGO 27')
        self.assertEqual(malda_sessions(boundary)[0]['starts_at'],'2026-12-27T18:00:00+01:00')
        self.assertEqual(malda_sessions(boundary.replace('27 AL','27 DE DICIEMBRE AL'))[0]['date'],'2026-12-27')

    @staticmethod
    def malda_card(title, version, days):
        return ('<a class="movie" href="https://www.cinemamalda.com/film/">'
                f'<h3>{title}<span>({version})</span></h3>'
                '<img data-src="https://www.cinemamalda.com/poster.jpg" src="placeholder.svg">'
                + ''.join(f'<div class="day"><span>{day}</span><span>{time}</span></div>'
                          for day, time in days) + '</a>')

    def test_malda_advance_cards_and_untimed_announcements(self):
        html = '<h2>Cartelera del 13 al 19 de noviembre de 2026</h2>'
        html += self.malda_card('Desastre Producciones', 'VOE', [('Vi 20', '18:00h.')])
        html += self.malda_card('Corren las liebres', 'VOE',
                               [('26 de Noviembre', '18:00h NO PACKS'), ('30 de Noviembre', '20:30h')])
        html += self.malda_card('Carol', 'VOSE', [('25 de diciembre', '')])
        html += self.malda_card('Dubbed', 'DOE', [('Vi 20', '19:00h')])
        rows = malda_home_sessions(html)
        self.assertEqual([(r['date'], r['time']) for r in rows],
                         [('2026-11-20', '18:00'), ('2026-11-26', '18:00'), ('2026-11-30', '20:30')])
        self.assertTrue(all(r['original_audio'] and r['source_version'] == 'VOE' for r in rows))
        self.assertTrue(all(r['booking_scope'] == 'box_office' for r in rows))
        self.assertEqual(rows[0]['poster_url'], 'https://www.cinemamalda.com/poster.jpg')
        with self.assertRaises(ValueError):
            malda_home_sessions(html.replace('Vi 20', 'Ju 20'))
        with self.assertRaises(ValueError):
            malda_home_sessions(html.replace(' de 2026', ''))

    def test_malda_advance_dates_cross_new_year(self):
        html = '<h2>Cartelera del 25 al 31 de diciembre de 2026</h2>'
        html += self.malda_card('Film', 'VOSE', [('Vi 1', '18:00h'), ('5 de enero', '19:00h')])
        self.assertEqual([r['date'] for r in malda_home_sessions(html)], ['2027-01-01', '2027-01-05'])

    def test_malda_weekly_and_home_overlap_keeps_identity_and_rejects_conflicts(self):
        weekly = ('<div class="sinopsi"><h2>DEL 13 AL 19 DE NOVIEMBRE DE 2026</h2>'
                  '<p>JUEVES 19 21:35h – AFFECTION, AFFECTION (VOSCAST)</p></div>')
        home = '<h2>Cartelera del 13 al 19 de noviembre de 2026</h2>'
        home += self.malda_card('Affection Affection', 'VOSCAT', [('Ju 19', '21:35h')])
        class HTTP:
            def get(self, url):
                return weekly if 'cartelera-dia-a-dia' in url else home
        result = collect_malda(HTTP(), NOW)
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['coverage']['homepage_additional_sessions'], 0)
        self.assertEqual(result['sessions'][0]['film_id'], malda_sessions(weekly)[0]['film_id'])
        self.assertEqual(result['sessions'][0]['version'], 'VOSC')
        self.assertEqual(len(result['sessions'][0]['source_urls']), 2)
        home = home.replace('Affection Affection', 'Different film')
        with self.assertRaises(ValueError):
            collect_malda(HTTP(), NOW)

    def test_verdi_shared_feed_routes_each_screening_to_only_one_entrance(self):
        class HTTP:
            def get(self,url):return '<html></html>'
            def json(self,url):return {'result':[{'id':46,'code':'VERDIBCN','shop_url':'https://verdibcn.admit-one.eu/?perfCode=%s&language=%s'}]}
            def booking_room(self,provider,code,url):return {'1':'1','2':'A V.Park','3':'unknown'}[code]
        payload={'result':[{'version':'VOSE','title_id':1,'locale_title':'Film','performances':[
            {'code':str(i),'time':'202611201800'} for i in [1,2,3]]}]}
        result=collect_a1('verdi',payload,HTTP(),NOW)
        self.assertEqual({r['cinema_id'] for r in result['sessions']},{'verdi','verdi-park'})
        self.assertEqual(result['count'],2);self.assertEqual(result['coverage']['excluded_unresolved_room'],1)


if __name__=='__main__':unittest.main()
