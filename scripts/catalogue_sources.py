"""Original-audio catalogues from official public programme/booking sources.

Only programme reads are made. No tickets, seats, holds or checkout requests.
Source-specific parsers deliberately keep unproven versions out of the feed.
"""
from datetime import datetime, timezone, timedelta
from html import unescape
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlsplit, parse_qs, urlencode
from zoneinfo import ZoneInfo

from cinesa_showtimes import atomic_write
from explore_premium_showtimes import Document
from original_audio import original_audio, a1_audio, fold
from provider_relay import ProgrammeRelay, supported, siteground_check
from screening_prices import a1_prices, schema_prices, texas_prices, observation, card_prices, explicit_free

MADRID = ZoneInfo('Europe/Madrid')
A1 = {'verdi': 'https://barcelona.cines-verdi.com', 'girona': 'https://www.cinemesgirona.cat'}
FILMOTECA = 'https://euromus.cultura.gencat.cat/filmoteca/'
CODE = 'https://api.codetickets.com/api/'


def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def visible(html):
    html = re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', '', html, flags=re.I)
    return clean(Document(re.sub(r'<br\s*/?>', ' ', html, flags=re.I)).root.text())


def graph(html):
    result = []
    for element in Document(html).root.find(lambda e: e.tag == 'script' and e.attrs.get('type') == 'application/ld+json'):
        value = json.loads(element.text())
        result.extend(value.get('@graph', [value]) if isinstance(value, dict) else value)
    return result


def imdb_id(value):
    match = re.search(r'\btt\d{7,10}\b', str(value or ''))
    return match[0] if match else None


def row(provider, cinema, sid, fid, title, starts, qualification, booking, source, **extra):
    if not qualification:
        raise ValueError('Original audio needs evidence')
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=MADRID)
    local = starts.astimezone(MADRID)
    return {'id': f'{provider}:{sid}', 'provider': provider, 'provider_session_id': str(sid),
            'cinema_id': cinema, 'film_id': str(fid), 'title': clean(title),
            'starts_at': local.isoformat(), 'date': local.date().isoformat(), 'time': local.strftime('%H:%M'),
            'timezone': 'Europe/Madrid', 'room': None, 'format': None, 'big_screen': False,
            'availability': 'unknown', 'booking_url': booking, 'booking_scope': 'session',
            'source_url': source, **qualification, **extra}


def report(provider, rows, now, **coverage):
    unique = {}
    for item in rows:
        if datetime.fromisoformat(item['starts_at']) < now:
            continue
        previous = unique.get(item['id'])
        if previous and previous != item:
            raise ValueError(f'Conflicting {provider} session identity')
        unique[item['id']] = item
    return {'provider': provider, 'fetched_at': now.isoformat(), 'status': 'ok',
            'sessions': sorted(unique.values(), key=lambda r: (r['starts_at'], r['id'])),
            'coverage': {'mode': 'all_published_original_audio', **coverage}, 'count': len(unique)}


class CatalogueHTTPError(ValueError):
    """A bounded diagnostic that cannot contain URLs, cookies or credentials."""
    def __init__(self, status):
        self.reason = 'source_http_' + str(int(status))
        super().__init__(self.reason)


class CatalogueHTTP:
    def __init__(self, session, cache_dir, now, *, sleep=time.sleep, relay_factory=ProgrammeRelay):
        self.session, self.cache_dir, self.now = session, Path(cache_dir), now
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.memory = {}
        self.sleep = sleep
        self.relay_factory, self.relay = relay_factory, None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self.relay is not None:
            self.relay.close()
            self.relay = None

    def _relay_get(self, url):
        if self.relay is None:
            self.relay = self.relay_factory(self.session)
        host = urlsplit(url).hostname
        print(json.dumps({'event':'provider_source_fallback','host':host}),flush=True)
        return self.relay.get(url)

    def get(self, url, *, cached=False):
        if url in self.memory:
            return self.memory[url]
        path = self.cache_dir / (hashlib.sha256(url.encode()).hexdigest() + '.json')
        if cached:
            try:
                saved = json.loads(path.read_text())
                if 0 <= (self.now - datetime.fromisoformat(saved['at'])).total_seconds() < 21600:
                    self.memory[url] = saved['html']
                    return saved['html']
            except (OSError, ValueError, KeyError):
                pass
        response = None
        for attempt in range(3):
            try:
                response = self.session.get(url, timeout=30)
                if response.status_code not in (429,500,502,503,504) or attempt==2:
                    break
            except Exception:
                if attempt==2:raise
            retry = response.headers.get('retry-after','') if response is not None else ''
            self.sleep(min(5,int(retry)) if retry.isdigit() else 2**attempt)
        if supported(url) and siteground_check(response.status_code, response.text):
            html = self._relay_get(url)
        elif response.status_code != 200:
            raise CatalogueHTTPError(response.status_code)
        else:
            html = response.text
        self.memory[url] = html
        if cached:
            atomic_write(path, {'at': self.now.isoformat(), 'html': html})
        return html

    def json(self, url):
        return json.loads(self.get(url))

    def post(self, url, *, data):
        response = self.session.post(url, data=data, timeout=30)
        response.raise_for_status()
        return response.json()

    def booking_room(self, provider, sid, url):
        path = self.cache_dir / f'room-{provider}-{sid}.json'
        try:
            saved = json.loads(path.read_text())
            if (self.now - datetime.fromisoformat(saved['at'])).total_seconds() < 86400:
                return saved['room']
        except (OSError, ValueError, KeyError):
            pass
        # Booking HTML can contain ephemeral anonymous identifiers: retain only
        # the checked room, not the page or its cookies, in the disk cache.
        html = self.get(url)
        perf = re.search(r'var\s+GlobalPerfID\s*=\s*(\d+)', html)
        if not perf:
            perf = next((e.attrs.get('value') for e in Document(html).root.find(
                lambda e: e.tag == 'input' and e.attrs.get('name') == 'perfCode')), None)
        else:
            perf = perf[1]
        if str(perf) != str(sid):
            raise ValueError('Booking page does not confirm the requested performance')
        match = re.search(r'\bSala\s+([A-D]\s+V\.?\s*Park|\d+)', visible(html), re.I)
        if not match:
            raise ValueError('Booking room missing')
        room = clean(match[1])
        atomic_write(path, {'at': self.now.isoformat(), 'room': room})
        return room


def collect_a1(provider, payload, http, now):
    base = A1[provider]
    posters = {}
    # Artwork is optional; a missing homepage must not discard a valid API feed.
    try:home = http.get(base + '/')
    except Exception:home = ''
    for link in Document(home).root.find(lambda e:e.tag == 'a'):
        for image in link.find(lambda e:e.tag == 'img' and e.attrs.get('src')):
            href = urlsplit(urljoin(base, link.attrs.get('href',''))).path.strip('/')
            if href and 'pos' in image.attrs['src']:
                posters[href] = urljoin(base, image.attrs['src'])
    theatres = http.json(base + '/api/get-theaters')['result']
    theatre = next(t for t in theatres if t['code'] == ('VERDIBCN' if provider == 'verdi' else 'GIRONA'))
    rows, unknown, unresolved = [], 0, 0
    for event in payload['result']:
        qualification = a1_audio(event)
        if not qualification:
            unknown += len(event.get('performances', []))
            continue
        imdb = imdb_id(event.get('imdbid'))
        if imdb and imdb.removeprefix('tt') == event.get('code'):
            imdb = None
        for perf in event.get('performances', []):
            starts = datetime.strptime(perf['time'], '%Y%m%d%H%M').replace(tzinfo=MADRID)
            if starts < now:
                continue
            code = str(perf['code'])
            booking = theatre['shop_url'].replace('%s', code, 1).replace('%s', 'esp', 1)
            try:
                room = http.booking_room(provider, code, booking)
            except ValueError:
                unresolved += 1
                continue
            if provider == 'verdi':
                if re.fullmatch(r'[A-D]\s+V\.?\s*Park', room, re.I):
                    cinema = 'verdi-park'
                elif room in ('1', '2', '3', '4', '5'):
                    cinema = 'verdi'
                else:
                    unresolved += 1
                    continue
            else:
                cinema = 'cinemes-girona'
            rows.append(row(provider, cinema, f"{theatre['id']}:{code}", event['title_id'],
                event.get('title_name') or event['locale_title'], starts, qualification, booking, base,
                localized_title=event['locale_title'], imdb_id=imdb, room=room,
                poster_url=posters.get(event.get('title_slug')),
                runtime_minutes=int(event['runtime']) if str(event.get('runtime', '')).isdigit() else None,
                synopsis=event.get('synopsis'), format=event.get('audio'),
                film_url=urljoin(base+'/',event['title_slug']) if event.get('title_slug') else None,
                original_language_source=base+'/api/get-events', **a1_prices(perf,base+'/api/get-events')))
    if unresolved and not rows:
        raise ValueError('No A1 rooms could be verified')
    return report(provider, rows, now, excluded_unproven_or_dubbed=unknown, excluded_unresolved_room=unresolved)


def renoir_sessions(html, day):
    root = Document(html).root
    cards = list(root.find(lambda e: 'my-account-content' in e.classes() and 'd-lg-block' in e.classes()))
    if not cards:
        raise ValueError('Renoir programme cards missing')
    rows = []
    for card in cards:
        film_link = next(card.find(lambda e: e.tag == 'a' and e.attrs.get('href', '').startswith('/pelicula/')), None)
        version = next((clean(e.text()) for e in card.find(lambda e: e.tag == 'small') if 'versi' in fold(e.text())), '')
        qualification = original_audio(version)
        if not qualification or film_link is None:
            continue
        image = next(card.find(lambda e: e.tag == 'img'), None)
        runtime = re.search(r'Duraci[oó]n\s+(\d+)', card.text())
        for slot in card.find(lambda e: 'pase-cartelera' in e.classes()):
            room = re.search(r'sala\s+(\d+)', slot.text(), re.I)
            for link in slot.find(lambda e: e.tag == 'a' and 'pillalas.com/pase/' in e.attrs.get('href', '')):
                time = clean(link.text())
                if not re.fullmatch(r'\d{2}:\d{2}', time):
                    continue
                sid = urlsplit(link.attrs['href']).path.rstrip('/').split('/')[-1]
                rows.append(row('renoir', 'renoir-floridablanca', sid, film_link.attrs['href'], film_link.text(),
                    datetime.fromisoformat(day + 'T' + time).replace(tzinfo=MADRID), qualification,
                    link.attrs['href'], 'https://www.cinesrenoir.com/cine/renoir-floridablanca/cartelera/',
                    room=room[1] if room else None, poster_url=image.attrs.get('src') if image else None,
                    runtime_minutes=int(runtime[1]) if runtime else None))
    return rows


def collect_renoir(http, now):
    source = 'https://www.cinesrenoir.com/cine/renoir-floridablanca/cartelera/'
    html = http.get(source)
    options = list(Document(html).root.find(lambda e: e.tag == 'option' and '?fecha=' in e.attrs.get('value', '')))
    if not options:
        raise ValueError('Renoir advertised dates missing')
    days = sorted({parse_qs(urlsplit(e.attrs['value']).query)['fecha'][0] for e in options})
    rows = []
    for day in days:
        if day >= now.astimezone(MADRID).date().isoformat():
            rows.extend(renoir_sessions(http.get(source + '?fecha=' + day), day))
    return report('renoir', rows, now, published_dates=days)


def filmoteca_sessions(payload, version_labels, now):
    rows, excluded = [], 0
    for group in payload:
        for perf in group.get('cicle', []):
            label = version_labels.get(str(perf.get('codiIdioma')), '')
            # VE/VC only identify the spoken language. Filmoteca also uses VC
            # for Catalan dubs, so neither is evidence of original audio.
            qualification = original_audio(label)
            if not qualification:
                excluded += 1
                continue
            starts = datetime.strptime(perf['dataCicle'] + ' ' + perf['horaI'], '%d/%m/%Y %H%M').replace(tzinfo=MADRID)
            activity, cycle = str(group['codi']), str(perf['codiCicle'])
            sid = ':'.join((activity, cycle, starts.strftime('%Y%m%d%H%M'), str(perf['codiRecinte'])))
            booking = FILMOTECA + 'venda/index.jsp?' + urlencode({'lang': 1, 'nom_cache': 'FILMOTECA',
                'property': 'FILMOTECA', 'codiActiv': activity, 'codiCicle': cycle})
            available = perf.get('hihaPlaces')
            seed = {'kind': 'reported_total', 'available': available, 'checked_at': now.isoformat()} if type(available) is int and available >= 0 else None
            rows.append(row('filmoteca', 'filmoteca-catalunya', sid, activity + ':' + cycle, perf['descrip'],
                starts, qualification, booking, 'https://www.filmoteca.cat/web/ca/view-agenda-setmanal',
                room=perf['nomSala'], source_language_code=perf.get('codiIdioma'), seat_data=seed,
                **observation(booking, amount=group.get('preu'), scope='programme',
                              free=bool(re.search(r'\bGRATU[ÏI]TA\b',perf['descrip'],re.I))),
                poster_url=FILMOTECA + 'loadImg.jsp?' + urlencode({'nomCache':'FILMOTECA','codiActiv':activity,'tipus':group['tipus'],'codiCicle':cycle})))
    return report('filmoteca', rows, now, excluded_unproven_or_dubbed=excluded)


def collect_filmoteca(http, now):
    html = http.get(FILMOTECA + 'venda/index.jsp?lang=1&nom_cache=FILMOTECA&property=FILMOTECA')
    labels = dict(re.findall(r"var\s+t_idioma_(\d+)\s*=\s*'([^']*)'", html))
    if labels.get('7') != 'VOSE' or labels.get('6') != 'VOSC':
        raise ValueError('Filmoteca language legend changed')
    payload = http.post(FILMOTECA + 'ActionServletJson', data={'elem':'activitatsNou',
        'codiMuseu':'FILMOTECA','property':'FILMOTECA','codiActiv':'','codiCombi':'','codiCicle':'','grupActiv':'','dataVisita':'','lang':'1'})
    if not isinstance(payload, list) or not payload:
        raise ValueError('Filmoteca programme missing')
    return filmoteca_sessions(payload, labels, now)


def zumzeig_metadata(html):
    root = Document(html).root
    info = next(root.find(lambda e: 'rowcontent' in e.classes() and 'Versió:' in e.text()), None)
    if info is None:
        return None
    text = clean(info.text())
    version = re.search(r'Versió:\s*(.+?)(?:Qualificació:|$)', text)
    qualification = original_audio(version[1] if version else '')
    events = {m[1] for e in root.find(lambda e:e.tag == 'a')
              if (m := re.search(r'/online/(\d+)/', e.attrs.get('href','')))}
    booking_links = {e.attrs['href'] for e in root.find(lambda e:e.tag == 'a'
                     and urlsplit(e.attrs.get('href','')).hostname in ('www.codetickets.com', 'entradas.codetickets.com'))}
    return events, qualification, booking_links


def collect_zumzeig(http, now):
    events = http.json(CODE + 'evento/349/1602/eventos?lang=ca_ES')
    homepage = http.get('https://zumzeigcine.coop/')
    links = {urljoin('https://zumzeigcine.coop/', e.attrs['href']) for e in Document(homepage).root.find(
        lambda e:e.tag == 'a' and '/cinema/films/' in e.attrs.get('href',''))}
    # The agenda can be shorter than the booking horizon; its film index adds
    # further film pages, matched by Codetickets event IDs, never fuzzy titles.
    indexes = list(Document(homepage).root.find(lambda e:e.tag == 'a'
                   and urlsplit(e.attrs.get('href','')).path.rstrip('/') == '/cinema/sessions'))
    if not indexes:
        raise ValueError('Zumzeig programme index missing')
    for e in indexes:
        index = http.get(urljoin('https://zumzeigcine.coop/', e.attrs['href']))
        links.update(urljoin('https://zumzeigcine.coop/', a.attrs['href']) for a in Document(index).root.find(
            lambda a:a.tag == 'a' and '/cinema/films/' in a.attrs.get('href','')))
    qualifications, external_qualifications = {}, {}
    for url in sorted(links):
        found = zumzeig_metadata(http.get(url, cached=True))
        if found:
            ids, qualification, booking_links = found
            for ident in ids:
                qualifications[ident] = (qualification, url)
            for booking in booking_links:
                external_qualifications[booking] = (qualification, url)
    rows, excluded = [], 0
    for event in events:
        eid = str(event['id'])
        external = event.get('urlComprar')
        qualification, source = (external_qualifications.get(external, (None, None)) if external
                                 else qualifications.get(eid, (None, None)))
        if not qualification:
            excluded += len(event.get('sesiones', []))
            continue
        sessions = event.get('sesiones', []) if external else http.json(CODE + f'evento/349/1602/{eid}/sesiones?lang=ca_ES')
        for perf in sessions:
            if external and 'zumzeig' not in fold(perf.get('recinto')):
                excluded += 1
                continue
            starts = datetime.fromisoformat(perf['fechaInicial'])
            available = perf.get('disponibles')
            seed = {'kind':'reported_total','available':available,'checked_at':now.isoformat()} if not external and perf.get('showDisponibles') and type(available) is int and available >= 0 else None
            rows.append(row('zumzeig', 'zumzeig', str(perf['id']), eid, event['nombre'], starts,
                qualification, external or f"https://www.codetickets.com/portal/zumzeigcooperativa/online/{eid}/{perf['id']}", source,
                room='1', poster_url=event.get('urlImage'), seat_data=seed,
                booking_scope='event' if external else 'session'))
    return report('zumzeig', rows, now, discovered_events=len(events), excluded_unproven_version_or_venue=excluded)


def texas_calendar(html):
    rows = {}
    for day in Document(html).root.find(lambda e: re.fullmatch(r'day_\d{4}-\d{2}-\d{2}', e.attrs.get('id',''))):
        for link in day.find(lambda e:e.tag == 'a' and 'pelicula' in e.classes()):
            time = next((clean(e.text()) for e in link.find(lambda e:'event-time' in e.classes())), '')
            url = link.attrs.get('href','')
            if urlsplit(url).hostname != 'espaitexas.koobin.cat' or not re.fullmatch(r'\d{2}:\d{2}', time):
                continue
            starts = datetime.fromisoformat(day.attrs['id'][4:] + 'T' + time).replace(tzinfo=MADRID)
            rows[(url, starts.isoformat())] = starts
    return rows


def texas_session(html, starts, url):
    root = Document(html).root
    heading = next(root.find(lambda e:e.tag == 'h1'), None)
    if heading is None:
        raise ValueError('Texas session page missing')
    title = clean(heading.text())
    version = ' '.join(re.findall(r'\(([^)]+)\)', title))
    qualification = original_audio(version)
    if not qualification:
        return None
    identity = re.search(r"'eventData'\s*:\s*\{\s*'id'\s*:\s*'(\d+)'[\s\S]*?'date'\s*:\s*'([^']+)'", html)
    if not identity or datetime.fromisoformat(identity[2]) != starts:
        raise ValueError('Texas calendar/booking identity mismatch')
    room = re.search(r'CINE:\s*SALA\s*(\d+)', visible(html), re.I)
    if not room:
        return None
    image = next((e.attrs.get('content') for e in root.find(lambda e:e.tag == 'meta' and e.attrs.get('property') == 'og:image')), None)
    base = re.search(r"'base_event_id'\s*:\s*'(\d+)'", html)
    return row('texas', 'espai-texas', identity[1], base[1] if base else identity[1],
               re.sub(r'\s*\([^)]*\)\s*$', '', title), starts, qualification, url,
               'https://espaitexas.cat/cartellera-cinema/', room=room[1], poster_url=image, **texas_prices(html,url))


def collect_texas(http, now):
    calendar = texas_calendar(http.get('https://espaitexas.cat/cartellera-cinema/'))
    if not calendar:
        raise ValueError('Texas cinema calendar missing')
    rows, excluded = [], 0
    for (url, _), starts in calendar.items():
        if starts < now:
            continue
        item = texas_session(http.get(url), starts, url)
        if item:
            rows.append(item)
        else:
            excluded += 1
    return report('texas', rows, now, excluded_unproven_or_dubbed=excluded)


MONTHS = {name:i+1 for i,name in enumerate('enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split())}


def malda_week(text):
    week = re.search(r'DEL\s+(\d+)(?:\s+DE\s+(\w+))?\s+AL\s+(\d+)\s+DE\s+(\w+)\s+DE\s+(\d{4})', text, re.I)
    if not week:
        raise ValueError('Maldà explicit programme week missing')
    month, year = MONTHS[fold(week[4])], int(week[5])
    first_day, last_day = int(week[1]), int(week[3])
    start_month = MONTHS[fold(week[2])] if week[2] else (month if first_day <= last_day else (month - 2) % 12 + 1)
    first = datetime(year - (start_month > month), start_month, first_day, tzinfo=MADRID)
    last = datetime(year, month, last_day, tzinfo=MADRID)
    span = (last - first).days
    if not 0 <= span <= 13:
        raise ValueError('Maldà programme date range is inconsistent')
    return first, last


def malda_sessions(html):
    root = Document(html).root
    content = next(root.find(lambda e:'sinopsi' in e.classes()), None)
    if content is None:
        raise ValueError('Maldà programme missing')
    first, last = malda_week(content.text())
    span = (last - first).days
    dates = {(first + timedelta(days=i)).day: first + timedelta(days=i) for i in range(span + 1)}
    rows = []
    for paragraph in content.find(lambda e:e.tag in ('p','h1','h2','h3','h4')):
        text = clean(paragraph.text())
        if re.search(r'\bDEL\s+\d+.*\bAL\s+\d+',text,re.I):
            first,last = malda_week(text)
            dates = {(first + timedelta(days=i)).day: first + timedelta(days=i) for i in range((last-first).days+1)}
            continue
        day = re.match(r'(?:LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)\s+(\d+)', text, re.I)
        if not day:
            continue
        slots = list(re.finditer(r'(\d{1,2}:\d{2})h?\s*[–—-]\s*',text))
        for index,slot in enumerate(slots):
            # Unmarked events must not borrow the next film's version or price.
            segment = text[slot.end():slots[index+1].start() if index+1<len(slots) else len(text)]
            m = re.match(r'(.*?)\((VO[^)]*)\)',segment)
            qualification = original_audio(m[2]) if m else None
            if qualification:
                if int(day[1]) not in dates:
                    raise ValueError('Maldà screening falls outside its published week')
                hour, minute = map(int, slot[1].split(':'))
                starts = dates[int(day[1])].replace(hour=hour, minute=minute)
                title = clean(m[1])
                fid = hashlib.sha256(fold(title).encode()).hexdigest()[:16]
                source = 'https://www.cinemamalda.com/cartelera-dia-a-dia/'
                rows.append(row('malda', 'cinema-malda', starts.strftime('%Y%m%d%H%M'), fid, title, starts,
                    qualification, source, source, room='1', booking_scope='box_office',
                    **(explicit_free(segment,source) or card_prices(segment,source))))
    return rows


def malda_card_date(label, first, last):
    """Resolve abbreviated dates against the published year, never the clock.

    Weekday-only cards cover the advertised week and the following week.
    Named months can advertise up to six months ahead, including New Year.
    Ambiguous or unrecognised dates fail closed instead of inventing a date.
    """
    label = fold(clean(label)).rstrip('.')
    named = re.fullmatch(r'(\d{1,2})\s+de\s+(\w+)(?:\s+(?:de\s+)?(\d{4}))?', label)
    short = re.fullmatch(r'(lu|ma|mi|ju|vi|sa|do)\.?\s+(\d{1,2})', label)
    candidates = []
    if named and named[2] in MONTHS:
        for year in ([int(named[3])] if named[3] else [first.year - 1, first.year, first.year + 1]):
            try:
                date = datetime(year, MONTHS[named[2]], int(named[1]), tzinfo=MADRID)
            except ValueError:
                continue
            if first - timedelta(days=7) <= date <= last + timedelta(days=183):
                candidates.append(date)
    elif short:
        for offset in range((last - first).days + 8):
            date = first + timedelta(days=offset)
            if date.day == int(short[2]) and date.weekday() == ['lu', 'ma', 'mi', 'ju', 'vi', 'sa', 'do'].index(short[1]):
                candidates.append(date)
    if len(candidates) != 1:
        raise ValueError(f'Maldà timed card has unresolved date: {label}')
    return candidates[0]


def malda_home_sessions(html):
    root = Document(html).root
    heading = next(root.find(lambda e:e.tag == 'h2' and 'cartelera' in fold(e.text())), None)
    if heading is None:
        raise ValueError('Maldà homepage programme missing')
    first, last = malda_week(heading.text())
    rows = []
    for card in root.find(lambda e:e.tag == 'a' and 'movie' in e.classes()):
        heading = next(card.find(lambda e:e.tag == 'h3'), None)
        match = re.fullmatch(r'(.*?)\s*\(([^)]+)\)\s*', clean(heading.text())) if heading else None
        qualification = original_audio(match[2]) if match else None
        if not qualification:
            continue
        title = clean(match[1])
        source = card.attrs.get('href', '')
        if urlsplit(source).hostname != 'www.cinemamalda.com':
            raise ValueError('Unexpected Maldà film link')
        picture = next(card.find(lambda e:e.tag == 'img'), None)
        poster = (picture.attrs.get('data-src') or picture.attrs.get('src')) if picture else None
        for day in card.find(lambda e:'day' in e.classes()):
            spans = list(day.find(lambda e:e.tag == 'span'))
            if len(spans) < 2:
                continue
            times = list(re.finditer(r'(?<!\d)(\d{1,2}):(\d{2})\s*h?\b', clean(spans[1].text())))
            if not times:
                continue  # Announced films without a start time are not sessions.
            date = malda_card_date(spans[0].text(), first, last)
            for time in times:
                starts = date.replace(hour=int(time[1]), minute=int(time[2]))
                fid = hashlib.sha256(fold(title).encode()).hexdigest()[:16]
                rows.append(row('malda', 'cinema-malda', starts.strftime('%Y%m%d%H%M'), fid, title, starts,
                    qualification, source, 'https://www.cinemamalda.com/', room='1',
                    booking_scope='box_office', film_url=source, poster_url=poster,
                    **card_prices(clean(card.text()),'https://www.cinemamalda.com/')))
    return rows


def collect_malda(http, now):
    weekly = malda_sessions(http.get('https://www.cinemamalda.com/cartelera-dia-a-dia/'))
    home = malda_home_sessions(http.get('https://www.cinemamalda.com/'))
    merged = {item['id']: item for item in weekly}
    added = 0
    for item in home:
        previous = merged.get(item['id'])
        if previous:
            # One auditorium: punctuation/case differences at the same time are
            # safe to reconcile; two different films at that time are not.
            title_key = lambda text: re.sub(r'[^a-z0-9]', '', fold(text))
            if title_key(previous['title']) != title_key(item['title']):
                raise ValueError('Conflicting Maldà films at the same time')
            for key in ['language', 'subtitles']:
                if previous.get(key) and item.get(key) and previous[key] != item[key]:
                    raise ValueError('Conflicting Maldà screening languages')
            item = {**previous, **item, 'film_id': previous['film_id'], 'title': previous['title'],
                    'source_urls': [previous['source_url'], item['source_url']]}
        elif datetime.fromisoformat(item['starts_at']) >= now:
            added += 1
        merged[item['id']] = item
    return report('malda', list(merged.values()), now,
                  sources=['weekly_programme', 'homepage_dated_film_cards'], homepage_additional_sessions=added)


def filmax_sessions(html, source, languages):
    nodes = graph(html)
    movies = {x['@id']:x for x in nodes if x.get('@type') == 'Movie'}
    rows = []
    for perf in nodes:
        if perf.get('@type') != 'ScreeningEvent':
            continue
        movie = movies[perf['workPresented']['@id']]
        imdb = imdb_id(movie.get('sameAs'))
        version = ' '.join(re.findall(r'\(([^)]+)\)', perf['name']))
        qualification = original_audio(version, audio=perf.get('inLanguage'), original=languages.get(imdb))
        if not qualification:
            continue
        booking = perf['offers']['url']
        if urlsplit(booking).hostname != 'filmax.admit-one.eu':
            raise ValueError('Unexpected Filmax booking host')
        sid = parse_qs(urlsplit(booking).query)['perfCode'][0]
        duration = re.fullmatch(r'PT(\d+)M', movie.get('duration',''))
        rows.append(row('filmax', 'filmax-gran-via', sid, imdb or movie['@id'], movie['name'],
            datetime.fromisoformat(perf['startDate']), qualification, booking, source,
            imdb_id=imdb, poster_url=movie.get('image'), synopsis=movie.get('description'),
            runtime_minutes=int(duration[1]) if duration else None, format=perf.get('videoFormat'),
            **schema_prices(perf['offers'],source)))
    return rows


def collect_filmax(http, now, languages):
    base = 'https://cinesfilmax.com'
    index = Document(http.get(base + '/wai')).root
    links = {e.attrs['href'].replace('/wai/', '/', 1) for e in index.find(lambda e:e.tag == 'a' and e.attrs.get('href','').startswith('/wai/'))}
    if not links:
        raise ValueError('Filmax film index missing')
    rows = []
    for link in sorted(links):
        url = base + link
        rows.extend(filmax_sessions(http.get(url), url, languages))
    return report('filmax', rows, now, discovered_films=len(links))


def collect_ateneu(http, now):
    source = 'https://ateneubcn.cat/programacio/'
    html = http.get(source)
    match = re.search(r'var PT_Ajax = (\{[^;]+\});', html)
    if not match:
        raise ValueError('Ateneu agenda configuration missing')
    config = json.loads(match[1])
    if config['ajaxurl'] != 'https://ateneubcn.cat/wp-admin/admin-ajax.php':
        raise ValueError('Unexpected Ateneu endpoint')
    payload = http.post(config['ajaxurl'], data={'action':'get_activities_filter','nonce':config['nonce'],'filters':'tipus-1174'})
    if not payload.get('success') or not isinstance(payload.get('data'), list):
        raise ValueError('Ateneu event filter failed')
    # Event-specific original audio and admission need verification before a
    # new future event can enter the cinema feed. Archive items never qualify.
    pending = [e['permalink'] for e in payload['data'] if datetime.strptime(
        e['campos_activitat_data_inici'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=MADRID) >= now]
    return report('ateneu', [], now, events_awaiting_version_and_public_admission=pending)
