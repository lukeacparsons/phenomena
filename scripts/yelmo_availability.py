"""Yelmo's public seat map, with an anonymous basket cancelled before return.

The map requires one verified public fare in a basket, but does not allocate seats.
Never call seats/set or payment. A failed cancellation stops this fetcher.
"""
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

from expanded_availability import MADRID, ScreeningAvailabilityUnavailable, count, observed, same_start

BASE = 'https://api-compra.yelmocines.es/api/'
HEADERS = {'Origin': 'https://compra.yelmocines.es', 'Referer': 'https://compra.yelmocines.es/'}
CINEMAS = {'yelmo-maquinista': '1350', 'yelmo-castelldefels': '814', 'yelmo-sant-cugat': '784'}


class YelmoCancellationError(RuntimeError):
    def __init__(self, last_error):
        self.last_error = last_error
        super().__init__('Yelmo basket cancellation failed; further collection stopped')


def identity(row):
    url = urlsplit(row['booking_url'])
    query = parse_qs(url.query)
    cinema, sid = query.get('cinemaVistaId', []), query.get('showtimeVistaId', [])
    if (url.scheme != 'https' or url.hostname != 'compra.yelmocines.es'
            or len(cinema) != 1 or len(sid) != 1 or not sid[0].isdigit()
            or CINEMAS.get(row['cinema_id']) != cinema[0]
            or row['id'] != f'yelmo:{cinema[0]}:{sid[0]}'):
        raise ValueError('Wrong Yelmo performance identity')
    return cinema[0], sid[0]


def validate_schedule(payload, row, cinema):
    if (str(payload['cinema']['vista_id']) != cinema
            or str(payload['showtimes']['screen']) != str(row['room'])
            or str(payload['movie']['id']) != str(row['film_id'])):
        raise ValueError('Wrong Yelmo cinema, film or auditorium')
    starts = datetime.fromisoformat(payload['showtimes']['datetime'])
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=MADRID)
    same_start(starts.isoformat(), row)


def public_fares(payload):
    """Only reviewed unrestricted fares establish publicly bookable areas."""
    if payload.get('status_code') != 0 or not payload.get('areas'):
        raise ScreeningAvailabilityUnavailable('Yelmo ticket types unavailable')
    fares, seen = [], set()
    for area in payload['areas']:
        code = area['code']
        if not isinstance(code, str) or not code or code in seen:
            raise ValueError('Duplicate or invalid Yelmo ticket area')
        seen.add(code)
        for ticket in area['tickets']:
            if (ticket.get('type') in {'adulto', 'general-evento', 'adulto-evento', 'miercoles'}
                    and ticket.get('is_package') is False
                    and ticket.get('is_folio') is False and not ticket.get('recognition_id')
                    and ticket.get('folio') is None and ticket.get('min_quantity') == 0
                    and count(ticket['max_quantity']) >= 1):
                fares.append({'ticket_type_code': ticket['code'], 'area_category_code': code,
                              'quantity': 1, 'price': count(ticket['price']), 'type': ticket['type'],
                              'folio': None, 'min_quantity': 0})
                break
    if not fares:
        raise ScreeningAvailabilityUnavailable('No verified unrestricted Yelmo fare')
    return fares


def seat_availability(payload, row, session_id, eligible):
    cinema, sid = identity(row)
    if (payload.get('session_id') != session_id or payload.get('cinema_vista_id') != cinema
            or payload.get('showtime_vista_id') != sid):
        raise ValueError('Wrong Yelmo seat-map identity')
    if payload.get('status_code') != 0 or not payload.get('seat_layout_data'):
        raise ScreeningAvailabilityUnavailable('Yelmo seat map unavailable')
    if payload.get('allocate_seatting') is not True or payload.get('seats_allocated') is not False:
        raise ValueError('Expected an unallocated Yelmo seat map')
    layout = payload['seat_layout_data']
    categories = layout['area_categories']
    if (not categories or len({c['area_category_code'] for c in categories}) != len(categories)
            or any(c['selected_seats'] != [] or count(c['seats_allocated_count']) != 0
                   or count(c['seats_not_allocated_count']) != count(c['seats_to_allocate']) for c in categories)):
        raise ValueError('Yelmo unexpectedly selected seats')
    if (sum(count(c['seats_to_allocate']) for c in categories) != 1
            or payload.get('total_order_count') != '1'):
        raise ValueError('Expected exactly one unallocated Yelmo fare')
    available, areas, positions, found = 0, set(), set(), set()
    for area in layout['areas']:
        number, code = area['number'], area['area_category_code']
        if number in areas or area['is_allocated_seating'] is not True:
            raise ValueError('Invalid Yelmo seating area')
        areas.add(number)
        row_count, column_count = count(area['row_count']), count(area['column_count'])
        remaining = 0
        for line in area['rows']:
            for seat in line['seats']:
                pos = seat['position']
                key = (pos['area_number'], count(pos['row_index']), count(pos['column_index']))
                if key in positions or key[0] != number or key[1] >= row_count or key[2] >= column_count:
                    raise ValueError('Duplicate or invalid Yelmo seat position')
                positions.add(key)
                # Special and the linked "7" places are excluded from the
                # ordinary count. No accessibility subtype/count is inferred.
                if seat['status'] not in {'Empty', 'Sold', 'Reserved', 'Broken', 'House', 'Special', '7'}:
                    raise ValueError('Unknown Yelmo seat status')
                remaining += seat['status'] == 'Empty'
        if remaining > count(area['number_of_seats']):
            raise ValueError('Yelmo remaining seats exceed capacity')
        if code in eligible:
            found.add(code)
            available += remaining
    if found != eligible or not positions:
        raise ValueError('Incomplete Yelmo public seating areas')
    return observed('ordinary', available)


class YelmoAvailabilityFetcher:
    def __init__(self, session, *, on_pending=lambda sid: None):
        self.session = session
        self.on_pending = on_pending
        self.pending = None
        self.blocked = False

    def post(self, route, payload):
        response = self.session.post(BASE + route, json=payload, headers=HEADERS)
        if response.status_code in {403, 405, 429}:
            # This API returned 405 "Service Unavailable" during a long pass.
            # Do not keep opening sessions after a provider-side rejection.
            self.blocked = True
        response.raise_for_status()
        return response

    def close(self):
        if self.pending is None:
            return
        last_error = None
        for _ in range(2):
            try:
                response = self.post('order/cancel', {'session_id': self.pending})
                if response.text.strip() and response.json().get('status_code') != 0:
                    raise ValueError('Yelmo cancellation not confirmed')
            except Exception as error:
                last_error = error
                continue
            self.pending = None
            self.on_pending(None)
            return
        self.blocked = True
        raise YelmoCancellationError(last_error) from None

    def fetch(self, row):
        if self.blocked or self.pending is not None:
            raise RuntimeError('Yelmo collection stopped after a booking API or cleanup failure')
        cinema, sid = identity(row)
        schedule = self.post('schedule', {'cinema_vista_id': cinema, 'showtime_vista_id': sid}).json()
        validate_schedule(schedule, row, cinema)
        tickets = self.post('tickets', {'cinema_vista_id': cinema, 'showtime_vista_id': sid,
                            'reload': False, 'app_dynamics': {'cinema_type': None, 'screen': None},
                            'session_id': None, 'token': None}).json()
        self.pending = tickets.get('session_id')
        if not isinstance(self.pending, str) or not self.pending:
            self.pending = None
            raise ScreeningAvailabilityUnavailable('Yelmo anonymous session unavailable')
        try:
            self.on_pending(self.pending)
            fares = public_fares(tickets)
            payload = self.post('seats', {'cinemaVistaId': cinema, 'showtimeVistaId': sid,
                               'sessionId': self.pending, 'selectedTickets': fares[:1],
                               'addTickets': True}).json()
            return seat_availability(payload, row, self.pending, {f['area_category_code'] for f in fares})
        finally:
            # No result is accepted if this cancellation fails, including on
            # malformed/error responses and after transport timeouts.
            self.close()
