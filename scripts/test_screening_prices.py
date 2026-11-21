from datetime import datetime, timezone
import json
import unittest

from screening_prices import (euros, a1_prices, schema_prices, texas_prices, institut_prices,
                              explicit_free, card_prices, display_price)
from explore_premium_showtimes import Document, mooby_sessions
from test_premium_showtimes import mooby_fixture, mooby_html
from nearby_catalogues import cinema_shop_sessions
from test_nearby_catalogues import shop
from catalogue_sources import filmax_sessions, malda_sessions
from browser_programme import browser_programme
from build_cinema_preview import assemble


class ScreeningPriceTests(unittest.TestCase):
    def test_minor_units_preserve_fare_range_without_claiming_a_standard_price(self):
        result=a1_prices({'data':{'tickets':{'prices':['600','750','600']}}},'https://cinema.example/api')
        self.assertNotIn('price_eur',result)
        self.assertEqual((result['price_data']['minimum'],result['price_data']['maximum']),(6,7.5))
        self.assertEqual(result['price_data']['scope'],'session')
        self.assertEqual(result['price_data']['fees'],'unknown')

    def test_malda_handles_two_weeks_and_does_not_borrow_a_later_films_price_or_version(self):
        html='''<div class="sinopsi"><h2>DEL 13 AL 19 DE NOVIEMBRE DE 2026</h2>
        <p>JUEVES 19 19:00h – First (VOSE) 21:00h – Second (VOE) Precio: 9€</p>
        <h2>DEL 20 AL 26 DE NOVIEMBRE DE 2026</h2>
        <p>VIERNES 20 18:00h – Private hire 20:00h – Third (VOE) ENTRADA GRATUITA HASTA LLENAR EL AFORO.</p></div>'''
        rows=malda_sessions(html)
        self.assertEqual([(r['date'],r['time'],r['title']) for r in rows],
                         [('2026-11-19','19:00','First'),('2026-11-19','21:00','Second'),('2026-11-20','20:00','Third')])
        self.assertNotIn('price_data',rows[0])
        self.assertEqual(rows[1]['price_eur'],9)
        self.assertEqual(rows[2]['price_eur'],0)
        with self.assertRaises(ValueError):malda_sessions(html.replace('VIERNES 20','VIERNES 27'))

    def test_missing_bad_and_placeholder_amounts_stay_unknown(self):
        for value in [None,True,-1,float('nan'),'NaN','1.234','1,000.00',{},'free']:
            self.assertIsNone(euros(value))
        for raw in [[],['0','750'],['600',None],['6.00'],True]:
            self.assertEqual(a1_prices({'data':{'tickets':{'prices':raw}}},'source'),{})
        self.assertEqual(a1_prices({'data':{'tickets':[]}},'source'),{})
        self.assertEqual(euros('7,50'),7.5)

    def test_schema_prices_do_not_convert_placeholder_zero_or_another_currency(self):
        for offer in [{'@type':'Offer','priceCurrency':'EUR','price':'0'},
                      {'@type':'Offer','priceCurrency':'USD','price':'5'},
                      {'@type':'AggregateOffer','priceCurrency':'EUR','lowPrice':'8','highPrice':'5'}]:
            self.assertEqual(schema_prices(offer,'source'),{})
        self.assertEqual(schema_prices({'@type':'Offer','priceCurrency':'EUR','price':'4'},'source')['price_eur'],4)

    def test_texas_general_does_not_become_free_because_a_pass_is_zero(self):
        html='''tarifas_area.push({ id: 1, desc: "GENERAL", precio: 5});
        tarifas_area.push({ id: 21, desc: "ABONAMENT ANUAL CINEMA", precio: 0});'''
        result=texas_prices(html,'source')
        self.assertEqual(result['price_eur'],5)
        self.assertEqual(result['price_data']['options'][1]['amount'],0)
        self.assertEqual(texas_prices(html.replace('GENERAL','SOCIS'),'source'),{})
        self.assertEqual(texas_prices(html+'tarifas_area.push({ id: 2, desc: "GENERAL", precio: 9});','source'),{})

    def test_institut_retains_concessions_and_pack_conditions_without_selecting_them(self):
        article=Document('<article><div class="intro__price">8€ Entrada general<br>7€ Carnet de Biblioteques<br>6€ IF Pass<br>Abono 4 entradas: 25€</div></article>').root
        result=institut_prices(article,'source')
        self.assertEqual(result['price_eur'],8)
        self.assertEqual(len(result['price_data']['options']),3)
        self.assertIn('Abono 4 entradas: 25€',result['price_data']['conditions'])
        self.assertEqual(institut_prices(Document('<p>Entrada general 8€ elsewhere</p>').root,'source'),{})
        single=institut_prices(Document('<div class="intro__price">5,77€</div>').root,'source')
        self.assertEqual(single['price_eur'],5.77)
        self.assertEqual(single['price_data']['kind'],'published_event_price')

    def test_free_requires_explicit_admission_and_card_price_requires_label(self):
        self.assertEqual(explicit_free('Entrada gratuïta amb reserva prèvia.','source')['price_eur'],0)
        self.assertEqual(explicit_free('Aparcament gratuït','source'),{})
        self.assertEqual(card_prices('Film. Preu 9€ NO PACKS','source')['price_eur'],9)
        self.assertEqual(card_prices('Socis 2€','source'),{})
        self.assertEqual(card_prices('Preu 5€ Preu 8€','source'),{})

    def test_nearby_prices_require_the_exact_screening_match(self):
        event={'code':50,'theater_id':50,'version':'VOSE','performances':[
            {'code':100,'time':'202611201930','data':{'tickets':{'prices':['650']}}}]}
        rows,_=cinema_shop_sessions(shop(),'sant-cugat-cinemas',[event])
        self.assertEqual(rows[0]['price_data']['minimum'],6.5)
        self.assertNotIn('price_data',rows[1])

    def test_mooby_integration_preserves_original_audio_and_price_source(self):
        shops=mooby_fixture();performance=shops['29']['events'][0]['performances'][0]
        performance['data']={'tickets':{'prices':['600','1000']}}
        rows=mooby_sessions(mooby_html(shops),premium_only=False,original_only=True)
        priced=[r for r in rows if r.get('price_data')]
        self.assertEqual(len(priced),1)
        self.assertEqual(priced[0]['price_data']['maximum'],10)
        self.assertTrue(priced[0]['original_audio'])

    def test_filmax_prices_belong_to_the_exact_event_not_a_related_film(self):
        movie={'@id':'film','@type':'Movie','name':'Film','sameAs':'tt1234567'}
        event={'@type':'ScreeningEvent','name':'Film (VOSE)','workPresented':{'@id':'film'},
               'startDate':'2026-11-20T20:00:00+01:00','offers':{'@type':'AggregateOffer','priceCurrency':'EUR',
                'lowPrice':'5.50','highPrice':'7.90','url':'https://filmax.admit-one.eu/?p=tickets&perfCode=1'}}
        html='<script type="application/ld+json">'+json.dumps([movie,event,{'@type':'Offer','price':99}])+'</script>'
        row=filmax_sessions(html,'https://cinesfilmax.com/film',{})[0]
        self.assertEqual(row['price_data']['minimum'],5.5)
        now=datetime(2026,11,19,tzinfo=timezone.utc)
        data=assemble([{'provider':'filmax','fetched_at':now.isoformat(),'sessions':[row]}],{'assets':[]},now)
        compact=browser_programme(data)
        price=data['films'][0]['sessions'][0]['price_data']
        self.assertEqual(price['checked_at'],now.isoformat())
        self.assertEqual(price['source_url'],'https://cinesfilmax.com/film')
        self.assertEqual(compact['films'][0]['sessions'][0]['price_data'],price)
        self.assertNotIn('price_eur',compact['films'][0]['sessions'][0])
        self.assertIn('según tarifa',display_price(row,'es'))


if __name__=='__main__':unittest.main()
