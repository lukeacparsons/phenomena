"""Girona's qualitative sold-out signal must never become a positive count."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from expanded_availability import (ExpandedAvailabilityFetcher, ScreeningAvailabilityUnavailable,
                                   girona_sold_out, girona_booking_sold_out)
from availability_cache import SUPPORTED

FIXTURES = Path(__file__).parent / 'fixtures' / 'availability'


class GironaTests(unittest.TestCase):
    def setUp(self):
        self.feed = json.loads((FIXTURES / 'girona-programme.json').read_text())
        self.rows = {r['id'].split(':')[-1]: r for r in json.loads((FIXTURES / 'girona-rows.json').read_text())}
        self.row = self.rows['41156']
        self.html = (FIXTURES / 'girona-41156.html').read_text()

    def test_sold_out_flag_is_confirmed_by_the_exact_booking_page(self):
        self.assertEqual(girona_sold_out(self.feed, self.row), '41156')
        value = girona_booking_sold_out(self.html, '41156')
        self.assertEqual(value['available'], 0)
        self.assertIs(value['is_sold_out'], True)
        self.assertIn('girona', SUPPORTED)
        self.assertIn('yelmo', SUPPORTED)
        self.assertEqual(girona_sold_out(self.feed, self.rows['41268']), '41268')
        self.assertEqual(girona_booking_sold_out((FIXTURES / 'girona-41268.html').read_text(), '41268')['available'], 0)

    def test_false_flag_quantity_caps_and_prices_do_not_become_inventory(self):
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            girona_sold_out(self.feed, self.rows['41291'])
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            girona_booking_sold_out('<input name="perfCode" value="41156"><select><option>10</option></select>', '41156')
        with self.assertRaises(ValueError):
            girona_booking_sold_out(self.html, '999')
        with self.assertRaises(ValueError):
            girona_booking_sold_out(self.html + '<input name="perfCode" value="999">', '41156')

    def test_identity_time_and_unknown_flags_are_rejected(self):
        for change in [{'film_id': '999'}, {'cinema_id': 'verdi'},
                       {'starts_at': '2026-11-22T18:00:00+01:00'},
                       {'booking_url': self.row['booking_url'].replace('41156', '999')}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                girona_sold_out(self.feed, {**self.row, **change})
        for flag in [True, 0, 2, '10', None]:
            feed = deepcopy(self.feed)
            perf = next(p for e in feed['result'] for p in e['performances'] if p['code'] == '41156')
            perf['data']['available'] = flag
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                girona_sold_out(feed, self.row)

    def test_programme_is_read_once_and_only_sold_out_pages_are_opened(self):
        fetcher = ExpandedAvailabilityFetcher()
        fetcher.session = Mock()
        fetcher.session.get.side_effect = [Mock(**{'json.return_value': self.feed}), Mock(text=self.html)]
        with self.assertRaises(ScreeningAvailabilityUnavailable):
            fetcher.fetch(self.rows['41291'])
        self.assertEqual(fetcher.fetch(self.row)['available'], 0)
        self.assertEqual(fetcher.session.get.call_count, 2)
        fetcher.session.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
