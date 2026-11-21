"""Captured Yelmo maps and cancellation guarantees; no network requests."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from expanded_availability import ExpandedAvailabilityFetcher, ScreeningAvailabilityUnavailable
from yelmo_availability import BASE, YelmoAvailabilityFetcher, public_fares, identity, seat_availability, validate_schedule

FIXTURES = Path(__file__).parent / 'fixtures' / 'availability'


def fixture(cinema='1350', sid='48642'):
    return json.loads((FIXTURES / f'yelmo-{cinema}-{sid}.json').read_text())


def response(payload=None):
    return Mock(text='' if payload is None else json.dumps(payload), **{'json.return_value': payload})


class YelmoTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()
        self.row = self.data['row']

    def parse(self, data=None, row=None):
        return seat_availability(data or self.data['seats'], row or self.row, 'anonymous-fixture', {'0000000001'})

    def transport(self, tail=None):
        session = Mock()
        session.post.side_effect = [response(self.data['schedule']), response(self.data['tickets']),
                                    *(tail or [response(self.data['seats']), response()])]
        return session, YelmoAvailabilityFetcher(session)

    def test_maps_at_all_three_cinemas_exclude_sold_broken_and_special_places(self):
        for cinema, sid, expected in [('1350', '48642', 472), ('814', '30895', 64), ('784', '25564', 88),
                                      ('1350', '47203', 117), ('1350', '48725', 127), ('1350', '44903', 127)]:
            data = fixture(cinema, sid)
            validate_schedule(data['schedule'], data['row'], cinema)
            self.assertEqual(self.parse(data['seats'], data['row'])['available'], expected)
            self.assertEqual(self.parse(data['seats'], data['row'])['kind'], 'ordinary')
        # Reserved and house seats cannot be advertised as available either.
        data = deepcopy(self.data['seats'])
        seats = data['seat_layout_data']['areas'][0]['rows'][0]['seats']
        seats[0]['status'], seats[1]['status'] = 'Reserved', 'House'
        self.assertEqual(self.parse(data)['available'], 470)

    def test_wrong_cinema_performance_film_room_or_start_is_rejected(self):
        for change in [{'id': 'yelmo:1350:999'}, {'cinema_id': 'yelmo-sant-cugat'},
                       {'booking_url': self.row['booking_url'].replace('compra.yelmocines.es', 'example.com')}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                identity({**self.row, **change})
        for change in [{'film_id': '999'}, {'room': '11'}, {'starts_at': '2026-11-22T13:45:00+01:00'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_schedule(self.data['schedule'], {**self.row, **change}, '1350')
        for key in ['session_id', 'cinema_vista_id', 'showtime_vista_id']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.parse({**self.data['seats'], key: 'wrong'})

    def test_unknown_states_duplicate_positions_and_incomplete_maps_fail_closed(self):
        for change in ['state', 'duplicate', 'position', 'area', 'capacity', 'empty']:
            data = deepcopy(self.data['seats'])
            area = data['seat_layout_data']['areas'][0]
            seats = area['rows'][0]['seats']
            if change == 'state': seats[0]['status'] = 'NewUnknownStatus'
            if change == 'duplicate': seats.append(deepcopy(seats[0]))
            if change == 'position': seats[0]['position']['area_number'] = 99
            if change == 'area': area['area_category_code'] = 'restricted'
            if change == 'capacity': area['number_of_seats'] = 1
            if change == 'empty': data['seat_layout_data']['areas'] = []
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.parse(data)

    def test_unexpected_allocations_are_rejected(self):
        for change in ['allocated', 'selected', 'allocated_count', 'quantity', 'order', 'unallocated_count']:
            data = deepcopy(self.data['seats'])
            category = data['seat_layout_data']['area_categories'][0]
            if change == 'allocated': data['seats_allocated'] = True
            if change == 'selected': category['selected_seats'] = [{'row_index': 1}]
            if change == 'allocated_count': category['seats_allocated_count'] = 1
            if change == 'quantity': category['seats_to_allocate'] = 2
            if change == 'order': data['total_order_count'] = '2'
            if change == 'unallocated_count': category['seats_not_allocated_count'] = 0
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.parse(data)

    def test_only_unrestricted_reviewed_fares_are_used(self):
        fares = public_fares(self.data['tickets'])
        self.assertEqual(len(fares), 1)
        self.assertEqual((fares[0]['type'], fares[0]['quantity']), ('adulto', 1))
        for change in [{'min_quantity': 2}, {'is_package': True}, {'is_folio': True},
                       {'recognition_id': 'member'}, {'max_quantity': 0}, {'type': 'family'}]:
            data = deepcopy(self.data['tickets'])
            data['areas'][0]['tickets'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ScreeningAvailabilityUnavailable):
                public_fares(data)

        event = json.loads((FIXTURES / 'yelmo-general-evento.json').read_text())
        self.assertEqual(public_fares(event), [{'ticket_type_code': '0321', 'area_category_code': '0000000001',
                         'quantity': 1, 'price': 1290, 'type': 'general-evento', 'folio': None, 'min_quantity': 0}])
        extra = json.loads((FIXTURES / 'yelmo-extra-fares.json').read_text())
        for payload in extra.values():
            self.assertIn(public_fares(payload)[0]['type'], {'miercoles', 'adulto-evento'})
        youth_only = deepcopy(extra['yelmo:1350:44903'])
        youth_only['areas'][0]['tickets'] = youth_only['areas'][0]['tickets'][1:]
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            public_fares(youth_only)

    def test_normal_fetch_cancels_before_return_without_selecting_a_seat(self):
        session, fetcher = self.transport()
        self.assertEqual(fetcher.fetch(self.row)['available'], 472)
        self.assertIsNone(fetcher.pending)
        self.assertEqual([c.args[0] for c in session.post.call_args_list],
                         [BASE + route for route in ['schedule', 'tickets', 'seats', 'order/cancel']])
        fetcher.close()
        self.assertEqual(session.post.call_count, 4)

    def test_map_errors_and_timeouts_still_cancel_the_basket(self):
        for failure in [TimeoutError('map timeout'), response({'status_code': 1107}),
                        response({**self.data['seats'], 'seats_allocated': True})]:
            session, fetcher = self.transport([failure, response()])
            with self.subTest(failure=failure), self.assertRaises((ValueError, TimeoutError)):
                fetcher.fetch(self.row)
            self.assertEqual(session.post.call_args.args[0], BASE + 'order/cancel')
            self.assertIsNone(fetcher.pending)

        tickets = deepcopy(self.data['tickets'])
        tickets['areas'] = []
        session = Mock()
        session.post.side_effect = [response(self.data['schedule']), response(tickets), response()]
        fetcher = YelmoAvailabilityFetcher(session)
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            fetcher.fetch(self.row)
        self.assertEqual(session.post.call_args.args[0], BASE + 'order/cancel')
        self.assertIsNone(fetcher.pending)

    def test_cancellation_failure_retries_then_stops_further_collection(self):
        session, fetcher = self.transport([response(self.data['seats']), TimeoutError(), TimeoutError()])
        with self.assertRaisesRegex(RuntimeError, 'cancellation failed'):
            fetcher.fetch(self.row)
        self.assertEqual(session.post.call_count, 5)
        self.assertTrue(fetcher.blocked)
        with self.assertRaisesRegex(RuntimeError, 'collection stopped'):
            fetcher.fetch(self.row)
        self.assertEqual(session.post.call_count, 5, 'must not open another basket')
        session.post.side_effect = [response()]
        fetcher.close()
        self.assertIsNone(fetcher.pending)

    def test_dispatch_reuses_transport_and_cleans_up(self):
        session, _ = self.transport()
        fetcher = ExpandedAvailabilityFetcher()
        fetcher.session = session
        fetcher.yelmo = YelmoAvailabilityFetcher(session)
        self.assertEqual(fetcher.fetch(self.row)['available'], 472)
        fetcher.close()
        session.close.assert_called_once()

    def test_provider_rejection_stops_subsequent_booking_requests(self):
        rejected = Mock(status_code=405, text='Service Unavailable')
        rejected.raise_for_status.side_effect = ValueError('HTTP 405')
        session = Mock()
        session.post.side_effect = [response(self.data['schedule']), rejected]
        fetcher = YelmoAvailabilityFetcher(session)
        with self.assertRaisesRegex(ValueError, 'HTTP 405'):
            fetcher.fetch(self.row)
        with self.assertRaisesRegex(RuntimeError, 'collection stopped'):
            fetcher.fetch(self.row)
        self.assertEqual(session.post.call_count, 2)
        self.assertIsNone(fetcher.pending)


if __name__ == '__main__':
    unittest.main()
