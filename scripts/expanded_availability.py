"""Verified public inventory sources; no seat selection or payment.

See docs/seat-availability-investigation-2026-11-21.md for source semantics.
"""
from collections import Counter
from datetime import datetime, timezone
import json
import re
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from explore_premium_showtimes import Document

SUPPORTED = {'renoir', 'texas', 'ocine-magic', 'institut-francais', 'yelmo', 'girona'}
MADRID = ZoneInfo('Europe/Madrid')


class ScreeningAvailabilityUnavailable(ValueError):
    """This screening has no verified public inventory source."""


def count(value):
    if type(value) is not int or value < 0:
        raise ValueError('Invalid remaining-place count')
    return value


def observed(kind, available, **extra):
    return {'kind': kind, 'available': count(available),
            'checked_at': datetime.now(timezone.utc).isoformat(), **extra}


def text(node):
    return ' '.join(node.text().split())


def same_start(value, row):
    actual = datetime.fromisoformat(value)
    if actual.tzinfo is None or actual != datetime.fromisoformat(row['starts_at']):
        raise ValueError('Wrong screening date or time')


def admit_one_unallocated_availability(html):
    """The V2 ticket page includes inventory even without a rendered seat map.

    Cross-check remaining totals against seat records; ticket quantity limits
    and fare variants are deliberately not used as inventory.
    The caller validates GlobalPerfID before reaching this parser.
    """
    matches = list(re.finditer(r'^\s*(?:var\s+)?jsSectionData\s*=\s*', html, re.M))
    if not matches:
        raise ScreeningAvailabilityUnavailable('Unallocated screening has no public inventory')
    if len(matches) != 1:
        raise ValueError('Ambiguous Admit One inventory')
    payload, end = json.JSONDecoder().raw_decode(html[matches[0].end():])
    if not html[matches[0].end() + end:].lstrip().startswith(';') or not isinstance(payload, list) or not payload:
        raise ValueError('Admit One inventory missing')
    areas, sections = [], set()
    for section in payload:
        section_id = str(section['sectionid'])
        if section_id in sections:
            raise ValueError('Duplicate Admit One section')
        sections.add(section_id)
        types, seats = section['seatTypes'], section['seatdata']
        if not isinstance(types, dict) or not types or not isinstance(seats, list):
            raise ValueError('Incomplete Admit One inventory')
        actual, remaining, seen = Counter(), Counter(), set()
        for seat in seats:
            key = (str(seat['sectionid']), str(seat['seatid']))
            code = str(seat['pricearea'])
            if key in seen or code not in types or type(seat['available']) is not bool or seat['selected'] is not False:
                raise ValueError('Invalid Admit One seat inventory')
            seen.add(key)
            actual[code] += 1
            remaining[code] += seat['available']
        for code, kind in types.items():
            available, total, sold = count(kind['availableSeats']), count(kind['totalSeats']), count(kind['soldSeats'])
            if (kind['selectedSeats'] != 0 or total != actual[code] or available != remaining[code]
                    or available + sold != total):
                raise ValueError('Admit One inventory totals disagree')
            tickets = kind['ticketData']['tickets']
            if any(ticket['qtyInOrder'] != 0 for ticket in tickets):
                raise ValueError('Expected an empty Admit One order')
            if any(all(ticket.get(field) is True for field in
                       ['active', 'olctOrderEligible', 'olctv2DisplayTicket', 'ticketeligiblefororder']) for ticket in tickets):
                areas.append({'area_code': section_id + ':' + code, 'name': kind['name'], 'available': available})
    if not areas:
        raise ScreeningAvailabilityUnavailable('No public Admit One ticket categories')
    return observed('area_counts', sum(area['available'] for area in areas), areas=areas)


def renoir_availability(html, row):
    root = Document(html).root
    canonical = [e.attrs.get('href') for e in root.find(
        lambda e: e.tag == 'link' and e.attrs.get('rel') == 'canonical')]
    expected = urlsplit(row['booking_url'])
    if (expected.hostname != 'www.pillalas.com'
            or not expected.path.endswith('/' + row['provider_session_id'] + '/')
            or canonical != [row['booking_url']]):
        raise ValueError('Wrong Renoir performance')
    summaries = list(root.find(lambda e: 'screening-summary-content' in e.classes()))
    if len(summaries) != 1:
        raise ValueError('Renoir screening details missing')
    summary = summaries[0]
    rooms = [text(e) for e in summary.find(lambda e: e.tag == 'div')
             if list(e.find(lambda x: x.tag == 'dt' and text(x) == 'Sala'))]
    if not rooms or any(re.fullmatch(r'Sala\s+0*' + re.escape(str(row['room'])), r) is None for r in rooms):
        raise ValueError('Wrong Renoir auditorium')
    starts = datetime.fromisoformat(row['starts_at']).astimezone(MADRID)
    months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split()
    date = rf'\b{starts.day} de {months[starts.month - 1]} de {starts.year}\b'
    if not re.search(date, text(summary), re.I):
        raise ValueError('Wrong Renoir screening date')
    times = {text(e) for e in summary.find(lambda e: 'screening-summary-schedule-time' in e.classes())}
    if times != {starts.strftime('%H:%M')}:
        raise ValueError('Wrong Renoir screening time')
    seats = {}
    for element in root.find(lambda e: 'data-seat-id' in e.attrs):
        sid, state = element.attrs['data-seat-id'], element.attrs.get('data-state')
        if not sid or state not in {'normal', 'vendida', 'minusvalido'}:
            raise ValueError('Unknown Renoir seat state')
        if sid in seats and seats[sid] != state:
            raise ValueError('Conflicting Renoir seat state')
        seats[sid] = state
    if not seats:
        raise ScreeningAvailabilityUnavailable('Renoir seat map missing')
    states = Counter(seats.values())
    return observed('ordinary', states['normal'], wheelchair=states['minusvalido'])


def texas_identity(html, row):
    identity = re.search(r"'eventData'\s*:\s*\{\s*'id'\s*:\s*'(\d+)'[\s\S]*?'date'\s*:\s*'([^']+)'", html)
    if not identity or identity[1] != row['provider_session_id']:
        raise ValueError('Wrong Texas performance')
    same_start(identity[2], row)
    room = re.search(r'CINE:\s*SALA\s*(\d+)', text(Document(html).root), re.I)
    if not room or room[1] != str(row['room']):
        raise ValueError('Wrong Texas auditorium')
    fields = re.search(r'action:\s*"aforo_evento",\s*trans_id:\s*"([^"\s]+)",\s*pid:\s*"(\d+)"', html)
    if not fields:
        raise ScreeningAvailabilityUnavailable('Texas map request missing')
    return {'action': 'aforo_evento', 'trans_id': fields[1], 'pid': fields[2]}


def texas_availability(payload, row):
    """Apply the provider's reviewed state updates as data, never execute JS.

    Initial HTML is an empty seating plan: counting it alone overstates stock.
    Any new selector, state or JavaScript statement invalidates the observation.
    """
    sid = re.escape(row['provider_session_id'])
    seats = {}
    for el in Document(payload['html']).root.find(lambda e: e.attrs.get('l') == 'Y'):
        ident, state = el.attrs.get('id', ''), el.attrs.get('e')
        if not re.fullmatch(r'L0__' + sid + r'_\d+_\d+_\d+', ident) or ident in seats:
            raise ValueError('Wrong or duplicate Texas seat identity')
        if state not in {'a', 'o', 'i', 'rw', 'aba', 'abrt', 'p', 'prt'} or el.attrs.get('class') != state:
            raise ValueError('Unknown Texas initial seat state')
        seats[ident] = state
    if not seats:
        raise ValueError('Texas seat map missing')
    # These are the only non-seat statements in the sampled map response.
    harmless = [
        r'if \(typeof theImage_' + sid + r' == "undefined"\)',
        r'theImage_' + sid + r' = new Image\(\);',
        r'theImage_' + sid + r'\.src = "https://media\.koobin\.com/media/espaitexas/aforos/[\w.-]+";',
        r'theImage_' + sid + r'\.onload = function\(\)\{',
        r'\$\("\.planoAforo_' + sid + r'"\)\.css\("(width|height)", theImage_' + sid + r'\.\1\+"px"\);',
        r'\$\("#map_' + sid + r'"\)\.attr\("(width|height)", theImage_' + sid + r'\.\1\);',
        r'if \(typeof (cacheZona|aforo) == "undefined"\)',
        r'(cacheZona|aforo) = \{\};',
        r"if \(typeof cacheZona\['" + sid + r"_\d+'\] == \"undefined\"\)",
        r"cacheZona\['" + sid + r"_\d+'\] = \{\};",
        r"cacheZona\['" + sid + r"_\d+'\]\['(zona|imagen_zona)'\] = '[^'\r\n]*';",
        r"aforo\['" + sid + r"'\] = '\d+';",
        r'\{|\}|\};',
    ]
    rules = {
        "$('.i').attr('estado','').attr('class','').attr('e','').hide();": ({'i'}, ''),
        "$('.rw').attr('estado','a').attr('class','a').attr('e','a');": ({'rw'}, 'a'),
        "$('.aba,.abrt').attr({'estado':'o','class':'o',e:'o'});": ({'aba', 'abrt'}, 'o'),
        "$('.p,.prt').attr({'estado':'o','class':'o',e:'o'});": ({'p', 'prt'}, 'o'),
    }
    seen_rules = set()
    for line in payload['js'].splitlines():
        line = line.strip()
        if not line:
            continue
        update = re.fullmatch(r"\$\('([^']+)'\)\.attr\('estado','o'\)\.attr\('class','o'\)\.attr\('e','o'\);", line)
        if update:
            for selector in update[1].split(','):
                if not selector.startswith('#') or selector[1:] not in seats:
                    raise ValueError('Unknown Texas occupancy selector')
                seats[selector[1:]] = 'o'
            continue
        compact = re.sub(r'\s+', '', line)
        if compact in rules:
            old, new = rules[compact]
            seats = {ident: new if state in old else state for ident, state in seats.items()}
            seen_rules.add(compact)
        elif not any(re.fullmatch(pattern, line) for pattern in harmless):
            raise ValueError('Unrecognized Texas map update')
    if seen_rules != set(rules):
        raise ValueError('Incomplete Texas map updates')
    # The provider exposes selectable places, without a verified accessibility
    # breakdown. Keep their meaning distinct from Renoir's ordinary-seat count.
    return observed('reported_total', sum(state == 'a' for state in seats.values()))


def ocine_availability(payload, row):
    """Published per-performance totals include accessibility spaces."""
    if str(payload['id']) != row['film_id']:
        raise ValueError('Wrong OCINE film')
    variants = payload['subPelicules'] if payload.get('esGrup') else [payload]
    matches = [(variant, slot) for variant in variants for slot in (variant.get('sessions') or [])
               if str(slot['planificacio']) == row['provider_session_id']]
    if len(matches) != 1:
        raise ScreeningAvailabilityUnavailable('OCINE performance missing')
    variant, slot = matches[0]
    if str(variant['id']) != str(row['source_variant_id']) or str(slot['sala']) != str(row['room']):
        raise ValueError('Wrong OCINE variant or auditorium')
    same_start(datetime.fromisoformat(slot['data'][:10] + 'T' + slot['hora']).replace(tzinfo=MADRID).isoformat(), row)
    remaining, capacity = count(slot['disponibles']), count(slot['totals'])
    if remaining > capacity:
        raise ValueError('OCINE inventory exceeds capacity')
    return observed('reported_total', remaining, capacity=capacity)


def codetickets_availability(detail, zones, row, event, session):
    if (str(detail['id']) != session or str(zones['id']) != session
            or detail.get('eventoId') is not None and str(detail['eventoId']) != event):
        raise ValueError('Wrong Codetickets performance')
    same_start(detail['fechaInicial'], row)
    if detail['recinto'].casefold() != 'institut français':
        raise ValueError('Wrong festival venue')
    if zones.get('hayZonas') is not True or not zones.get('zonas'):
        raise ScreeningAvailabilityUnavailable('Festival bookable zones missing')
    areas, seen = [], set()
    for zone in zones['zonas']:
        ident = str(zone['id'])
        if ident in seen or zone['estado'] != '1':
            raise ValueError('Unknown or duplicate festival zone')
        seen.add(ident)
        remaining, capacity = count(zone['disponibles']), count(zone['aforoMaximo'])
        if remaining > capacity:
            raise ValueError('Festival inventory exceeds capacity')
        areas.append({'area_code': ident, 'available': remaining, 'name': zone['nombre']})
    # Do not use detail.disponibles: it includes inventory outside these zones.
    return observed('area_counts', sum(area['available'] for area in areas), areas=areas)


def girona_sold_out(payload, row):
    """The official programme's string flags 1/2 mean sold out, not counts.

    False is the absence of a sold-out warning, not a positive inventory count.
    A flagged screening must additionally be confirmed on its booking page.
    """
    url = urlsplit(row['booking_url'])
    sid = row['id'].removeprefix('girona:31:')
    if (row['cinema_id'] != 'cinemes-girona' or not row['id'].startswith('girona:31:')
            or not sid.isdigit() or url.scheme != 'https' or url.hostname != 'girona.admit-one.eu'
            or parse_qs(url.query).get('perfCode') != [sid]):
        raise ValueError('Wrong Girona booking identity')
    matches = [(event, perf) for event in payload['result'] for perf in event.get('performances', [])
               if str(event['theater_id']) == '31' and str(perf['code']) == sid]
    if len(matches) != 1:
        raise ScreeningAvailabilityUnavailable('Girona performance missing or ambiguous')
    event, perf = matches[0]
    if str(event['title_id']) != str(row['film_id']):
        raise ValueError('Wrong Girona film')
    same_start(datetime.strptime(perf['time'], '%Y%m%d%H%M').replace(tzinfo=MADRID).isoformat(), row)
    flag = perf['data']['available']
    if flag is False:
        raise ScreeningAvailabilityUnavailable('Girona does not publish a remaining count')
    if flag not in ('1', '2'):
        raise ValueError('Unknown Girona availability flag')
    return sid


def girona_booking_sold_out(html, sid):
    root = Document(html).root
    identities = [e.attrs.get('value') for e in root.find(
        lambda e: e.tag == 'input' and e.attrs.get('name') == 'perfCode')]
    # Some pages repeat perfCode in the promotion-code form as well.
    if not identities or set(identities) != {sid}:
        raise ValueError('Wrong Girona booking performance')
    if 'En estos momentos, esta sesión esta agotada.' not in text(root):
        raise ScreeningAvailabilityUnavailable('Girona sold-out flag not confirmed by booking page')
    return observed('reported_total', 0, is_sold_out=True)


class ExpandedAvailabilityFetcher:
    def __init__(self):
        self.session = None
        self.films = {}
        self.girona = None
        self.yelmo = None

    def close(self):
        try:
            if self.yelmo is not None:
                self.yelmo.close()
        finally:
            if self.session is not None:
                self.session.close()

    def fetch(self, row):
        from curl_cffi import requests
        if self.session is None:
            self.session = requests.Session(impersonate='chrome', timeout=25)
        provider = row['provider']
        url = urlsplit(row['booking_url'])
        if provider == 'yelmo':
            from yelmo_transport import RotatingYelmoAvailabilityFetcher
            if self.yelmo is None:
                self.yelmo = RotatingYelmoAvailabilityFetcher()
            return self.yelmo.fetch(row)
        if provider == 'girona':
            if self.girona is None:
                response = self.session.get('https://www.cinemesgirona.cat/api/get-events')
                response.raise_for_status()
                self.girona = response.json()
            sid = girona_sold_out(self.girona, row)
            response = self.session.get(row['booking_url'])
            response.raise_for_status()
            return girona_booking_sold_out(response.text, sid)
        if provider == 'renoir':
            if url.scheme != 'https' or url.hostname != 'www.pillalas.com':
                raise ValueError('Wrong Renoir booking host')
            # Pillalas localizes even the unprefixed URL from Accept-Language.
            # Keep its date/room labels in the locale validated by the parser.
            response = self.session.get(row['booking_url'], headers={'Accept-Language': 'es-ES,es;q=0.9'})
            response.raise_for_status()
            return renoir_availability(response.text, row)
        if provider == 'texas':
            if url.scheme != 'https' or url.hostname != 'espaitexas.koobin.cat':
                raise ValueError('Wrong Texas booking host')
            response = self.session.get(row['booking_url'])
            response.raise_for_status()
            fields = texas_identity(response.text, row)
            response = self.session.post('https://espaitexas.koobin.cat/widget/', data=fields)
            response.raise_for_status()
            return texas_availability(response.json(), row)
        if provider == 'ocine-magic':
            fid = row['film_id']
            if not re.fullmatch(r'\d+', fid):
                raise ValueError('Invalid OCINE film identity')
            if fid not in self.films:
                response = self.session.get('https://tickets.ocinemagic.es/api/v1/pelicula/' + fid + '?lang=ca')
                response.raise_for_status()
                self.films[fid] = (response.json(), datetime.now(timezone.utc).isoformat())
            payload, checked_at = self.films[fid]
            return {**ocine_availability(payload, row), 'checked_at': checked_at}
        if provider == 'institut-francais':
            match = re.fullmatch(r'/portal/oh-la-la-festival/online/(\d+)/(\d+)/?', url.path)
            if url.scheme != 'https' or url.hostname != 'www.codetickets.com' or not match:
                raise ScreeningAvailabilityUnavailable('Unverified festival ticket channel')
            event, sid = match.groups()
            base = f'https://api.codetickets.com/api/evento/522/2430/{event}/{sid}'
            detail = self.session.post(base + '?lang=ca_ES', json={'userId': ''})
            detail.raise_for_status()
            zones = self.session.post(base + '/zonasprecios?lang=ca_ES', json={'userId': ''})
            zones.raise_for_status()
            return codetickets_availability(detail.json(), zones.json(), row, event, sid)
        raise NotImplementedError('Unverified availability provider')
