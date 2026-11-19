"""Availability must use area counts, avoid cart state and preserve identity."""

from datetime import datetime, timezone
import json
import unittest

from kinepolis_availability import AvailabilityError, entry_fields, parse_availability

NOW = datetime(2026, 11, 19, 11, tzinfo=timezone.utc)


def page(areas=None, order_changes=None):
    order = {"OrderId": 0, "CinemaId": "361", "Country": "ES", "NumberSeats": 0,
             "SelectedTickets": None, "AllocatedSeats": None, "UserSessionId": "do-not-export"}
    order.update(order_changes or {})
    if areas is None:
        areas = [{"AreaCode": "standard", "SeatsAvailable": 140, "IsSoldOut": False},
                 {"AreaCode": "recliner", "SeatsAvailable": 0, "IsSoldOut": True}]
    tickets = [{"AreaCategoryCode": "standard", "DisplayName": "General", "SeatsAvailable": 0},
               {"AreaCategoryCode": "standard", "DisplayName": "Reduced", "SeatsAvailable": 0},
               {"AreaCategoryCode": "recliner", "DisplayName": "Premium recliner", "SeatsAvailable": 0}]
    return "\n".join([
        "var orderData = " + json.dumps(order) + ";",
        "var availSeats = " + json.dumps(areas) + ";",
        'selligentObj.movie.movieTitle = "VOSE Dune";',
        'selligentObj.purchase.cinema.hall.id = "11";',
    ] + [f"ticketData['{index}'] = " + json.dumps(ticket) + ";" for index, ticket in enumerate(tickets)])


class SplauAvailabilityTests(unittest.TestCase):
    def test_count_areas_once_and_ignore_ticket_product_placeholders(self):
        row = parse_availability(page(), "250511", NOW)
        self.assertEqual(row["available_total"], 140)
        self.assertEqual(row["areas"][0]["ticket_labels"], ["General", "Reduced"])
        self.assertEqual(row["areas"][1]["available"], 0)
        self.assertTrue(row["areas"][1]["is_sold_out"])
        self.assertEqual((row["room"], row["provider_session_id"]), ("11", "PFULL-250511"))
        self.assertIsNone(row["capacity"])
        self.assertIsNone(row["accessibility_breakdown"])
        self.assertNotIn("do-not-export", json.dumps(row))

    def test_missing_duplicate_or_invalid_counts_are_failures(self):
        good = {"AreaCode": "standard", "SeatsAvailable": 12, "IsSoldOut": False}
        for areas in [[], [good, good], [{**good, "SeatsAvailable": -1}], [{**good, "SeatsAvailable": True}],
                      [{**good, "AreaCode": "unknown"}]]:
            with self.subTest(areas=areas), self.assertRaises(AvailabilityError):
                parse_availability(page(areas=areas), "250511", NOW)
        with self.assertRaises(AvailabilityError):
            parse_availability("<h1>Access Denied</h1>", "250511", NOW)

    def test_wrong_cinema_or_nonempty_order_rejected(self):
        for changes in [{"CinemaId": "other"}, {"Country": "FR"}, {"OrderId": 7}, {"NumberSeats": 1},
                        {"SelectedTickets": [{"Quantity": 1}]}, {"AllocatedSeats": ["seat"]}]:
            with self.subTest(changes=changes), self.assertRaises(AvailabilityError):
                parse_availability(page(order_changes=changes), "250511", NOW)

    def test_entry_is_only_the_expected_navigation_form(self):
        form = '''<form id="movie-program-vista-redirect-form" action="https://tickets.kinepolis.es">
          <input type="hidden" name="CountryCode" value="ES">
          <input type="hidden" name="CinemaId" value="PFULL">
          <input type="hidden" name="SessionId" value="250511"></form>'''
        self.assertEqual(entry_fields(form, "250511")["CinemaId"], "PFULL")
        for invalid in [form.replace("250511", "999"), form.replace("https://tickets.kinepolis.es", "https://example.org"),
                        form.replace("</form>", '<input type="hidden" name="TicketQuantity" value="1"></form>'),
                        form + form]:
            with self.assertRaises(AvailabilityError):
                entry_fields(invalid, "250511")


if __name__ == "__main__":
    unittest.main()
