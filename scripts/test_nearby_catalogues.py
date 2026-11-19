"""Guard venue, session, language and partial-refresh boundaries."""
from copy import deepcopy
from datetime import datetime, date
import json
import unittest

from nearby_catalogues import (cinema_shop_sessions, collect_cinema_shop, cinebaix_sessions,
                               ocine_film_sessions, capri_event, CAPRI_PROGRAMME)
from cultural_catalogues import (elizalde_event, caixa_event, institut_event, ohlala_sessions,
                                 collect_programme_monitor)
from explore_premium_showtimes import yelmo_sessions
from cinesa_showtimes import cinesa_sessions, venue_for_cinema, SourceError
from test_premium_showtimes import yelmo_fixture, yelmo_variant
from test_cinesa_showtimes import fixture as cinesa_fixture
from build_cinema_preview import assemble
from programme_expansion import ADDITIONAL_IDS
from refresh_nearby_preview import merge_expansion

NOW=datetime.fromisoformat('2026-11-19T12:00:00+01:00')


def shop(title='Film (VOSE)',code='SANTCUGAT'):
    # The live template omits the second opening <tr>.
    return f'''<div class="OLCT_movieTimesInnerWrapper"><h3><a href="?s={code}&eventCode=50">{title}</a></h3>
      <table><tr><th>20 novembre 2026</th><td><a href="?s={code}&perfCode=100">19:30</a></td></tr>
      <th>3 desembre 2026</th><td><a href="?s={code}&perfCode=101">20:00</a></td></tr></table></div>'''


class NearbyTests(unittest.TestCase):
    def test_shop_preserves_each_date_in_malformed_table(self):
        rows,excluded=cinema_shop_sessions(shop(),'sant-cugat-cinemas')
        self.assertEqual(excluded,0)
        self.assertEqual([(r['date'],r['time']) for r in rows],[('2026-11-20','19:30'),('2026-12-03','20:00')])
        self.assertEqual(len({r['id'] for r in rows}),2)

    def test_shop_does_not_inherit_previous_films_version(self):
        rows,excluded=cinema_shop_sessions(shop()+shop('Spanish title'),'sant-cugat-cinemas')
        self.assertEqual(len(rows),2);self.assertEqual(excluded,2)
        with self.assertRaises(ValueError):cinema_shop_sessions(shop(code='MONTCADA'),'sant-cugat-cinemas')
        with self.assertRaises(ValueError):cinema_shop_sessions(shop().replace('19:30','29:90'),'sant-cugat-cinemas')

    def test_shop_accepts_verified_sant_cugat_booking_migration_only(self):
        migrated = shop().replace('href="?s=SANTCUGAT&perfCode=',
            'href="https://santcugat.admit-one.eu/?p=tickets&s=SANTCUGAT&perfCode=')
        rows, excluded = cinema_shop_sessions(migrated, 'sant-cugat-cinemas')
        self.assertEqual(len(rows), 2)
        self.assertEqual(excluded, 0)
        self.assertTrue(all(r['booking_url'].startswith('https://santcugat.admit-one.eu/') for r in rows))
        for bad in [migrated.replace('santcugat.admit-one.eu', 'another.admit-one.eu'),
                    migrated.replace('p=tickets&s=SANTCUGAT', 'p=tickets&s=MONTCADA'),
                    migrated.replace('https://santcugat', 'http://santcugat'),
                    migrated.replace('s=SANTCUGAT', 's=MONTCADA')]:
            with self.subTest(html=bad), self.assertRaises(ValueError):
                cinema_shop_sessions(bad, 'sant-cugat-cinemas')
        with self.assertRaises(ValueError):
            cinema_shop_sessions(migrated.replace('s=SANTCUGAT', 's=MONTCADA'), 'cinemes-montcada')

    def test_shop_native_spanish_requires_exact_performance_and_theatre(self):
        event={'code':50,'theater_id':50,'version':'CASTELLANO','language':'Castellano',
               'woriginalversio':'Castellano','wprovinceversio':'Original',
               'performances':[{'code':100,'time':'202611201930'}]}
        rows,excluded=cinema_shop_sessions(shop('Film'),'sant-cugat-cinemas',[event])
        self.assertEqual([r['version'] for r in rows],['VO']);self.assertEqual(excluded,1)
        for change in [{'theater_id':39},{'woriginalversio':'English'},{'wprovinceversio':'Doblada'},
                       {'performances':[{'code':100,'time':'202612031930'}]}]:
            self.assertEqual(cinema_shop_sessions(shop('Film'),'sant-cugat-cinemas',[{**event,**change}])[0],[])
        self.assertEqual(cinema_shop_sessions(shop('Film (DOBLADA VOSE)'),'sant-cugat-cinemas',[event])[0],[])

    def test_optional_editorial_failure_keeps_explicit_shop_versions(self):
        class HTTP:
            def get(self,url):return shop()
            def json(self,url):raise TimeoutError()
        result=collect_cinema_shop(HTTP(),NOW,'sant-cugat-cinemas')
        self.assertEqual(result['count'],2)
        self.assertEqual(result['coverage']['metadata_status'],'unavailable_explicit_versions_only')

    def test_cinebaix_qualifies_each_session_including_unsubtitled_native(self):
        sessions=''.join(f'''<div class="field-collection-item-field-sessions" about="/session/{i}">
          <div class="field-name-field-tipus-projeccio">{version}</div>
          <span class="date-display-single" content="2026-11-20T19:30:00+01:00"></span>
          <div class="field-name-field-sessio-sala">Sala 2</div></div>'''
          for i,version in enumerate(['VOSE','VOE','VOC','DOE','DOC']))
        html=f'<div class="cartellera-peli"><h2>Film</h2><a href="/pellicula/film">Film</a>{sessions}</div>'
        rows,excluded=cinebaix_sessions(html)
        self.assertEqual(len(rows),3);self.assertEqual(excluded,2)
        self.assertTrue(all(r['original_audio'] and r['availability']=='unknown' for r in rows))
        self.assertEqual(rows[0]['starts_at'],'2026-11-20T19:30:00+01:00')

    def test_ocine_does_not_apply_parent_or_bare_o_version_to_dubbed_children(self):
        session={'data':'2026-11-20T00:00:00','hora':'19:30:00','planificacio':81,'sala':2}
        film={'id':50,'titol':'Film','esGrup':True,'propietatsDesc':['Versió VOSE'],
              'subPelicules':[{'id':51,'titol':'Film','versio':'O','propietatsDesc':['2D'],'sessions':[session]},
              {'id':52,'titol':'Film (VOSE)','versio':'O','propietatsDesc':['Versió VOSE'],
               'sessions':[{**session,'planificacio':82}]}]}
        rows,excluded=ocine_film_sessions(film,NOW)
        self.assertEqual(excluded,1);self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['source_variant_id'],52)
        self.assertEqual(rows[0]['availability'],'unknown')

    def test_capri_language_is_verified_against_reviewed_original(self):
        url='https://quefer.elprat.cat/activitats/cineclub-ernest-cole-lost-and-found'
        html='<h1>Cineclub: Ernest Cole: Lost and found</h1> Cinema CAPRI Raoul Peck 2024 Idioma: anglès Durada: 105 El 16.12.2026 de 19:30 a 21:30'
        rows,_=capri_event(html,url)
        self.assertEqual(rows[0]['starts_at'],'2026-12-16T19:30:00+01:00')
        self.assertEqual(rows[0]['version'],'VO')
        for bad in [html.replace('anglès','castellà'),html.replace('Raoul Peck','Other Director'),html.replace('2024','2025')]:
            self.assertEqual(capri_event(bad,url)[0],[])
        self.assertEqual(capri_event(html.replace('El 16.12.2026','Del 16.12.2026 al 17.12.2026'),url)[0],[])
        unrelated='<h1>Other film</h1> Cinema CAPRI El 16.12.2026 de 19:30 a 21:30 Activitats relacionades VOSE'
        self.assertEqual(capri_event(unrelated,url+'other')[0],[])

    def test_yelmo_nearby_identity_and_booking_route(self):
        for key,vista,cinema in [('premium-castelldefels','814','yelmo-castelldefels'),('premium-sant-cugat','784','yelmo-sant-cugat')]:
            payload=yelmo_fixture();venue=payload['d']['Cinemas'][0]
            venue.update(Key=key,VistaId=vista)
            yelmo_variant(payload)['Showtimes'][0]['VistaCinemaId']=vista
            rows,warnings=yelmo_sessions(payload,venue=key,premium_only=False,original_only=True)
            self.assertFalse(warnings);self.assertEqual(rows[0]['cinema_id'],cinema)
            self.assertIn(vista,rows[0]['booking_url'])
            yelmo_variant(payload)['Showtimes'][0]['VistaCinemaId']='1350'
            with self.assertRaises(ValueError):yelmo_sessions(payload,venue=key,premium_only=False,original_only=True)

    def test_barnasud_site_is_explicit(self):
        self.assertEqual(venue_for_cinema('cinesa-barnasud'),'barnasud')
        payload=cinesa_fixture()
        for show in payload['showtimes']:
            show['siteId']='040'
            show['id']=show['id'].replace('032-','040-')
        rows=cinesa_sessions(payload,date(2026,11,20),'barnasud',premium_only=False,original_only=True)
        self.assertTrue(rows);self.assertTrue(all(r['cinema_id']=='cinesa-barnasud' for r in rows))
        payload['showtimes'][0]['siteId']='032'
        with self.assertRaises(SourceError):cinesa_sessions(payload,date(2026,11,20),'barnasud',premium_only=False,original_only=True)


class CulturalTests(unittest.TestCase):
    def test_elizalde_double_bill_and_performance_filter(self):
        html='<article class="type-cinema"><h1>Doble projecció</h1> 01/12/2026 19:00 Film A VOSE Film B VOSE</article>'
        rows,_=elizalde_event(html,'https://www.casaelizalde.com/cinema/doble/')
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['date'],'2026-12-01')
        self.assertEqual(elizalde_event(html.replace('Film B VOSE','Film B VOSC'),'x')[0],[])
        self.assertEqual(elizalde_event(html.replace('Doble projecció','Projecció performativa'),'x')[0],[])

    def test_caixa_requires_venue_and_single_explicit_date(self):
        event={'@type':'Event','name':'Cortometrajes','location':{'name':'CaixaForum Barcelona'},
               'startDate':'2026-12-17T10:30:00+01:00','endDate':'2026-12-17T13:00:00+01:00'}
        def html(e):return '<script type="application/ld+json">'+json.dumps(e)+'</script>Proyección de cine VOSE'
        self.assertEqual(len(caixa_event(html(event),'x')[0]),1)
        self.assertEqual(caixa_event(html({**event,'location':{'name':'CaixaForum Madrid'}}),'x')[0],[])
        self.assertEqual(caixa_event(html({**event,'endDate':'2026-12-18T13:00:00+01:00'}),'x')[0],[])
        self.assertEqual(caixa_event(html(event)+' Doblada','x')[0],[])

    def test_institut_requires_on_site_cinema_event(self):
        html='<article class="type-event category_event-cine"><h1>Film</h1>Lugar Institut français de Barcelona Ver mapa Sesiones 20 Nov 2026 18:30 Idioma VOSE Duración 90</article>'
        self.assertEqual(institut_event(html,'x')[0][0]['time'],'18:30')
        self.assertEqual(institut_event(html.replace('Institut français de Barcelona','Cinemes Girona'),'x')[0],[])
        self.assertEqual(institut_event(html.replace('category_event-cine','category_event-teatro'),'x')[0],[])

    def test_festival_requires_independent_version_and_venue_evidence(self):
        card='<div class="pelicula">Sede Institut français 20/11/2026 - 18:30<a href="https://www.ohlalafilmfestival.com/es/pelicula/film/">Film</a><a href="https://www.codetickets.com/portal/oh-la-la-festival/online/1">Tickets</a></div>'
        rows,_=ohlala_sessions(card,lambda url:'Subtítulos VOSE Comprar Sinopsis Story')
        self.assertEqual(len(rows),1)
        self.assertEqual(ohlala_sessions(card,lambda url:'Subtítulos Español Comprar Sinopsis Story')[0],[])
        self.assertEqual(ohlala_sessions(card.replace('Institut français','Other cinema'),lambda url:'VOSE')[0],[])

    def test_monitor_links_cannot_become_showtimes(self):
        class HTTP:
            def get(self,url):return '<h1>Can Carol cinema</h1><a href="/events/film/">Film VOSE 20/11/2026 19:00</a>'
        result=collect_programme_monitor(HTTP(),NOW,'can-carol')
        self.assertEqual(result['sessions'],[])
        self.assertEqual(result['coverage']['mode'],'programme_links_only')
        self.assertEqual(len(result['coverage']['discovered_programme_links']),1)


class MergeTests(unittest.TestCase):
    def fixtures(self):
        raw={'id':'old:1','provider':'old','cinema_id':'phenomena','film_id':'1','title':'Example',
             'starts_at':'2026-12-01T19:00:00+01:00','version':'VOSE','original_audio':True}
        previous=assemble([{'provider':'old','fetched_at':'old time','sessions':[raw]}],{'assets':[]},NOW)
        previous['films'][0].update(ratings={'imdb':8},details={'director':'Verified Director'})
        fresh={**raw,'id':'cinebaix:2','provider':'cinebaix','cinema_id':'cinebaix'}
        reports=[{'provider':cid,'cinema_id':cid,'fetched_at':NOW.isoformat(),
                  'sessions':[fresh] if cid=='cinebaix' else []} for cid in sorted(ADDITIONAL_IDS)]
        return previous,assemble(reports,{'assets':[]},NOW)

    def test_merge_keeps_existing_sessions_timestamps_and_metadata(self):
        previous,addition=self.fixtures();unchanged=deepcopy(previous)
        result=merge_expansion(previous,addition)
        self.assertEqual(previous,unchanged)
        self.assertEqual(result['session_count'],2)
        rows={s['id']:s for f in result['films'] for s in f['sessions']}
        self.assertEqual(rows['old:1'],previous['films'][0]['sessions'][0])
        self.assertEqual(result['films'][0]['ratings'],{'imdb':8})
        self.assertEqual(len(result['cinemas']),38)
        again=merge_expansion(result,addition)
        self.assertEqual(again['session_count'],2)
        self.assertEqual(again['films'][0]['ratings'],{'imdb':8})

    def test_incomplete_refresh_is_rejected(self):
        previous,addition=self.fixtures();addition['coverage'].pop()
        with self.assertRaises(ValueError):merge_expansion(previous,addition)


if __name__=='__main__':unittest.main()
