"""Captured booking evidence and negative cases, without network access."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from availability_cache import AvailabilityCache, SUPPORTED
from expanded_availability import (ExpandedAvailabilityFetcher, ScreeningAvailabilityUnavailable,
                                   renoir_availability, texas_availability, texas_identity,
                                   ocine_availability, codetickets_availability, admit_one_unallocated_availability)
from premium_availability import AvailabilityFetcher

FIXTURES = Path(__file__).parent / 'fixtures' / 'availability'


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.rows = fixture('rows.json')

    def test_unallocated_admit_one_inventory_is_cross_checked_and_not_multiplied_by_fares(self):
        for sid, expected in [('222700', 302), ('222720', 218)]:
            data = fixture('verdi-' + sid + '.json')
            html = '// jsSectionData = [];\njsSectionData = ' + json.dumps(data) + ';'
            result = admit_one_unallocated_availability(html)
            self.assertEqual((result['available'], result['kind']), (expected, 'area_counts'))
        for change in ['count', 'missing_seat', 'duplicate', 'selected', 'unknown_state']:
            data = fixture('verdi-222700.json')
            if change == 'count': data[0]['seatTypes']['1']['availableSeats'] = 315
            if change == 'missing_seat': data[0]['seatdata'].pop()
            if change == 'duplicate': data *= 2
            if change == 'selected': data[0]['seatdata'][0]['selected'] = True
            if change == 'unknown_state': data[0]['seatdata'][0]['available'] = 'true'
            with self.subTest(change=change), self.assertRaises(ValueError):
                admit_one_unallocated_availability('jsSectionData = ' + json.dumps(data) + ';')
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            admit_one_unallocated_availability('// jsSectionData = [];')

    def test_renoir_transport_pins_the_response_locale(self):
        fetcher = ExpandedAvailabilityFetcher()
        fetcher.session = Mock()
        fetcher.session.get.return_value.text = (FIXTURES / 'renoir.html').read_text()
        self.assertEqual(fetcher.fetch(self.rows['renoir'])['available'], 161)
        fetcher.session.get.assert_called_once_with(self.rows['renoir']['booking_url'],
                                                   headers={'Accept-Language': 'es-ES,es;q=0.9'})

    def test_renoir_deduplicates_and_separates_accessibility(self):
        html = (FIXTURES / 'renoir.html').read_text()
        result = renoir_availability(html, self.rows['renoir'])
        self.assertEqual((result['available'], result['wheelchair']), (161, 2))
        duplicate = '<button data-seat-id="18013" data-state="normal"></button>'
        self.assertEqual(renoir_availability(html + duplicate, self.rows['renoir'])['available'], 161)
        self.assertEqual(renoir_availability(html.replace('data-state="normal"', 'data-state="vendida"'),
                                          self.rows['renoir'])['available'], 0)

    def test_renoir_rejects_changed_identity_time_room_or_seat_states(self):
        html = (FIXTURES / 'renoir.html').read_text()
        for row in [dict(self.rows['renoir'], room='1'),
                    dict(self.rows['renoir'], starts_at='2026-11-23T15:50:00+01:00'),
                    dict(self.rows['renoir'], starts_at='2026-11-22T16:50:00+01:00'),
                    dict(self.rows['renoir'], provider_session_id='999')]:
            with self.subTest(row=row), self.assertRaises(ValueError):
                renoir_availability(html, row)
        with self.assertRaises(ValueError):
            renoir_availability(html.replace('data-state="normal"', 'data-state="unknown"'), self.rows['renoir'])
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            renoir_availability(html.split('<button data-seat-id=')[0], self.rows['renoir'])

    def test_texas_applies_occupancy_in_both_rooms(self):
        self.assertEqual(texas_availability(fixture('texas-violin.json'), self.rows['texas'])['available'], 80)
        self.assertEqual(texas_availability(fixture('texas-human.json'),
                         dict(self.rows['texas'], provider_session_id='8324'))['available'], 42)

    def test_texas_never_counts_initial_html_after_unrecognized_updates(self):
        source = fixture('texas-violin.json')
        for update in ["\n$('#newSeat').attr('estado','o').attr('class','o').attr('e','o');",
                       "\nsetAllSeatsSold();", "\n$('.a').hide();"]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                texas_availability({**source, 'js': source['js'] + update}, self.rows['texas'])
        for payload in [{**source, 'js': ''}, {**source, 'html': ''},
                        {**source, 'html': source['html'].replace('e="a"', 'e="unknown"')}]:
            with self.assertRaises(ValueError):
                texas_availability(payload, self.rows['texas'])
        with self.assertRaises(ValueError):
            texas_availability(source, dict(self.rows['texas'], provider_session_id='999'))

    def test_texas_reserved_packages_and_inactive_places_are_not_ordinary(self):
        source = fixture('texas-violin.json')
        # Convert four otherwise free places into the provider's non-public categories.
        for state in ['i', 'aba', 'p', 'prt']:
            source['html'] = source['html'].replace('e="a" class="a"', f'e="{state}" class="{state}"', 1)
        self.assertEqual(texas_availability(source, self.rows['texas'])['available'], 76)

    def test_texas_page_identity_before_requesting_the_map(self):
        row = self.rows['texas']
        page = "'eventData': {'id': '8737', 'date': '2026-11-22T16:00:00+01:00'} CINE: SALA 2 " + \
               'action: "aforo_evento", trans_id: "anonymous", pid: "123"'
        self.assertEqual(texas_identity(page, row)['pid'], '123')
        for bad in [page.replace('8737', '999'), page.replace('SALA 2', 'SALA 1'),
                    page.replace('16:00', '17:00')]:
            with self.assertRaises(ValueError):
                texas_identity(bad, row)

    def test_ocine_uses_exact_performance_and_variant_not_booking_limits(self):
        source = fixture('ocine-film.json')
        row = self.rows['ocine-magic']
        result = ocine_availability(source, row)
        self.assertEqual((result['kind'], result['available'], result['capacity']), ('reported_total', 395, 401))
        # A second film/date has 276 ordinary + 2 accessibility places in its map.
        row2 = dict(row, film_id='10771', provider_session_id='174723', source_variant_id=10774,
                    starts_at='2026-12-15T19:15:00+01:00', room='8')
        self.assertEqual(ocine_availability(fixture('ocine-film2.json'), row2)['available'], 278)
        for bad in [dict(row, room='8'), dict(row, source_variant_id=11049), dict(row, film_id='999')]:
            with self.assertRaises(ValueError):
                ocine_availability(source, bad)
        for value in [None, -1, True, '395', 402]:
            modified = deepcopy(source)
            slot = next(s for v in modified['subPelicules'] for s in (v['sessions'] or []) if s['planificacio'] == 178397)
            slot['disponibles'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                ocine_availability(modified, row)

    def test_festival_uses_bookable_zones_not_larger_session_total(self):
        row = self.rows['institut-francais']
        for sid, event, available, hour in [('102656', '38148', 213, '18:30'), ('102663', '38155', 197, '21:00')]:
            data = fixture('institut-' + sid + '.json')
            result = codetickets_availability(data['detail'], data['zones'],
                       dict(row, starts_at='2026-11-26T' + hour + ':00+01:00'), event, sid)
            self.assertEqual(result['available'], available)
            self.assertNotEqual(result['available'], data['detail']['disponibles'])
            self.assertEqual(result['kind'], 'area_counts')

    def test_festival_rejects_wrong_venue_duplicates_and_unknown_zones(self):
        source = fixture('institut-102656.json')
        for change in ['venue', 'identity', 'duplicate', 'unknown', 'empty']:
            d = deepcopy(source)
            if change == 'venue': d['detail']['recinto'] = 'Another cinema'
            if change == 'identity': d['zones']['id'] = 999
            if change == 'duplicate': d['zones']['zonas'] *= 2
            if change == 'unknown': d['zones']['zonas'][0]['estado'] = '9'
            if change == 'empty': d['zones']['zonas'] = []
            with self.subTest(change=change), self.assertRaises(ValueError):
                codetickets_availability(d['detail'], d['zones'], self.rows['institut-francais'], '38148', '102656')

    def test_transport_requests_only_public_pages_and_map_reads(self):
        fetcher = ExpandedAvailabilityFetcher()
        fetcher.session = Mock()
        fetcher.session.get.return_value.json.return_value = fixture('ocine-film.json')
        one = fetcher.fetch(self.rows['ocine-magic'])
        two = fetcher.fetch(self.rows['ocine-magic'])
        self.assertEqual(one, two)
        fetcher.session.get.assert_called_once()
        fetcher.session.post.assert_not_called()
        fetcher.session.post.side_effect = [Mock(**{'json.return_value': fixture('institut-102656.json')['detail']}),
                                           Mock(**{'json.return_value': fixture('institut-102656.json')['zones']})]
        self.assertEqual(fetcher.fetch(self.rows['institut-francais'])['available'], 213)
        self.assertTrue(all(call.kwargs == {'json': {'userId': ''}} for call in fetcher.session.post.call_args_list))
        self.assertTrue(fetcher.session.post.call_args_list[1].args[0].endswith('/zonasprecios?lang=ca_ES'))
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            fetcher.fetch(dict(self.rows['institut-francais'], booking_url='https://www.eventbrite.es/e/other'))

    def test_new_sources_are_registered_and_share_the_existing_cache_contract(self):
        self.assertTrue(set(self.rows).issubset(SUPPORTED))
        with patch('premium_availability.ExpandedAvailabilityFetcher') as expanded:
            with AvailabilityFetcher() as fetcher:
                fetcher.fetch(self.rows['renoir'])
            expanded.return_value.fetch.assert_called_once_with(self.rows['renoir'])
            expanded.return_value.close.assert_called_once()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            programme = root / 'screenings.json'
            programme.write_text(json.dumps({'films': [{'sessions': list(self.rows.values())}]}))
            transport = Mock()
            transport.__enter__ = Mock(return_value=transport)
            transport.__exit__ = Mock(return_value=False)
            transport.fetch.return_value = {'kind': 'ordinary', 'available': 3, 'checked_at': '2026-11-21T12:00:00+00:00'}
            cache = AvailabilityCache(programme, root / 'availability.json', clock=lambda: 1795262400,
                                      fetcher_factory=lambda: transport)
            cache.refresh()
            self.assertEqual(len(cache.snapshot()['sessions']), 4)


if __name__ == '__main__':
    unittest.main()
