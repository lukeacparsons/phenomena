"""Nearby cinema programmes from official public listings and booking catalogues."""
from datetime import datetime
import hashlib
import re
from urllib.parse import urljoin, urlsplit, parse_qs

from catalogue_sources import (MADRID, MONTHS, clean, visible, row, report, imdb_id)
from explore_premium_showtimes import Document
from original_audio import original_audio, a1_audio, fold
from screening_prices import a1_prices

SHOP_VENUES = {
    'sant-cugat-cinemas': ('SANTCUGAT', 50, 'https://www.cinemessantcugat.com'),
    'cinemes-montcada': ('MONTCADA', 39, 'https://www.cinemesmontcada.com'),
    'can-castellet': ('SANTBOI', 47, 'https://www.cinemescancastellet.com'),
}
# Official shop links may move to a cinema-specific Admit One host. Keep
# aliases tied to that venue rather than allowing arbitrary ticket domains.
SHOP_BOOKING_HOSTS = {
    'sant-cugat-cinemas': {'www.onlinecinematickets.com', 'santcugat.admit-one.eu'},
}
CAT_MONTHS = dict(zip('gener febrer marc abril maig juny juliol agost setembre octubre novembre desembre'.split(), range(1, 13)))
ALL_MONTHS = {**MONTHS, **CAT_MONTHS}


def field(root, cls):
    return next(root.find(lambda e: cls in e.classes()), None)


def text_field(root, cls):
    node = field(root, cls)
    return clean(node.text()) if node else ''


def named_date(text):
    match = re.search(r'\b(\d{1,2})\s+(?:de\s+|d[’\'])?([a-z]+)\s+(?:de\s+)?(\d{4})\b', fold(text))
    if not match or match[2] not in ALL_MONTHS:
        raise ValueError('Explicit programme date missing')
    return datetime(int(match[3]), ALL_MONTHS[match[2]], int(match[1]), tzinfo=MADRID)


def cinema_shop_sessions(html, cinema, api_events=None):
    """The booking shop is a stable fallback when the editorial API is unavailable.

    The API can add native-language proof only for the exact event code, theatre
    and performance. A film title or the shop's language does not establish VO.
    """
    code, theatre_id, base = SHOP_VENUES[cinema]
    source = 'https://www.onlinecinematickets.com/?s=' + code
    root = Document(html).root
    cards = list(root.find(lambda e:'OLCT_movieTimesInnerWrapper' in e.classes()))
    if not cards:
        raise ValueError('Official cinema booking programme missing')
    events = {str(e['code']):e for e in (api_events or []) if e.get('theater_id') == theatre_id}
    rows, excluded = [], 0
    for card in cards:
        heading = next(card.find(lambda e:e.tag == 'h3'), None)
        if heading is None:
            raise ValueError('Cinema film heading missing')
        title = clean(heading.text())
        detail = next(heading.find(lambda e:e.tag == 'a'), None)
        if detail is None:
            raise ValueError('Cinema film identity missing')
        detail_url = urljoin(source, detail.attrs['href'])
        query = parse_qs(urlsplit(detail_url).query)
        if query.get('s') != [code] or not query.get('eventCode'):
            raise ValueError('Booking catalogue belongs to another cinema')
        fid = query['eventCode'][0]
        event = events.get(fid)
        label = ' '.join(re.findall(r'\(([^)]+)\)', title))
        explicit = original_audio(label)
        image = next(card.find(lambda e:e.tag == 'img' and e.attrs.get('src')), None)
        date = None
        # Some official shop templates omit opening <tr> tags after the first
        # row. Walk date headings and ticket links in document order instead.
        for link in card.find(lambda e:e.tag == 'th' or 'OLCT_MovieDate' in e.classes() or
                              (e.tag == 'a' and 'perfCode=' in e.attrs.get('href',''))):
            if link.tag == 'th' or 'OLCT_MovieDate' in link.classes():
                date = named_date(clean(link.text()))
                continue
            if date is None:
                raise ValueError('Cinema screening has no date heading')
            booking = urljoin(source, link.attrs['href'])
            params = parse_qs(urlsplit(booking).query)
            target = urlsplit(booking)
            hosts = SHOP_BOOKING_HOSTS.get(cinema, {'www.onlinecinematickets.com'})
            if target.scheme != 'https' or target.hostname not in hosts or params.get('s') != [code]:
                raise ValueError('Wrong cinema booking link')
            sid = params['perfCode'][0]
            time = clean(link.text())
            if not re.fullmatch(r'\d{1,2}:\d{2}', time):
                raise ValueError('Cinema booking time missing')
            starts = date.replace(hour=int(time.split(':')[0]), minute=int(time.split(':')[1]))
            qual = explicit
            perf = None
            if event:
                perf = next((p for p in event.get('performances',[]) if str(p['code']) == sid and
                             p['time'] == starts.strftime('%Y%m%d%H%M')), None)
                if perf:
                    # Explicit dubbed wording on the booking card still wins.
                    qualified_event = dict(event)
                    qualified_event['version'] = label + ' ' + str(event.get('version') or '')
                    qual = a1_audio(qualified_event)
            if not qual:
                excluded += 1
                continue
            rows.append(row(cinema, cinema, sid, fid, title, starts, qual, booking, source,
                            poster_url=urljoin(source,image.attrs['src']) if image else None,
                            film_url=detail_url, imdb_id=imdb_id(event.get('imdbid')) if event else None,
                            **a1_prices(perf or {},base+'/api/get-events')))
    return rows, excluded


def collect_cinema_shop(http, now, cinema):
    code, _, base = SHOP_VENUES[cinema]
    # The shop is independently usable. An access challenge on the optional
    # metadata endpoint must not discard its explicitly-labelled screenings.
    html = http.get('https://www.onlinecinematickets.com/?s=' + code)
    try:
        events = http.json(base + '/api/get-events')['result']
        metadata = 'ok'
    except Exception:
        events, metadata = [], 'unavailable_explicit_versions_only'
    rows, excluded = cinema_shop_sessions(html, cinema, events)
    return report(cinema, rows, now, metadata_status=metadata, excluded_unproven_or_dubbed=excluded)


def cinebaix_sessions(html):
    root = Document(html).root
    cards = list(root.find(lambda e:'cartellera-peli' in e.classes()))
    if not cards:
        raise ValueError('CineBaix programme missing')
    rows, excluded = [], 0
    for card in cards:
        sessions = list(card.find(lambda e:'field-collection-item-field-sessions' in e.classes()))
        if not sessions:
            continue
        link = next(card.find(lambda e:e.tag == 'a' and '/pellicula/' in e.attrs.get('href','')), None)
        heading = next(card.find(lambda e:e.tag == 'h2'), None)
        if link is None or heading is None:
            raise ValueError('CineBaix film identity missing')
        source = urljoin('https://www.cinebaix.cat/', link.attrs['href'])
        image = next(card.find(lambda e:e.tag == 'img'), None)
        for session in sessions:
            version = text_field(session, 'field-name-field-tipus-projeccio')
            qualification = original_audio(version)
            if not qualification:
                excluded += 1
                continue
            date = field(session, 'date-display-single')
            if date is None or not date.attrs.get('content'):
                raise ValueError('CineBaix explicit screening date missing')
            starts = datetime.fromisoformat(date.attrs['content'])
            if starts.tzinfo is None:
                raise ValueError('CineBaix screening timezone missing')
            sid = session.attrs['about'].rstrip('/').split('/')[-1]
            rows.append(row('cinebaix', 'cinebaix', sid, urlsplit(source).path, heading.text(), starts,
                qualification, 'https://cinebaixtaquilla81.com/', source,
                room=text_field(session,'field-name-field-sessio-sala'), booking_scope='cinema',
                poster_url=image.attrs.get('src') if image else None))
    return rows, excluded


def collect_cinebaix(http, now):
    rows, excluded = cinebaix_sessions(http.get('https://www.cinebaix.cat/'))
    return report('cinebaix', rows, now, excluded_unproven_or_dubbed=excluded)


OCINE = 'https://tickets.ocinemagic.es'


def ocine_film_sessions(film, now):
    rows, excluded = [], 0
    variants = film['subPelicules'] if film.get('esGrup') else [film]
    if film.get('esGrup') and not isinstance(variants, list):
        raise ValueError('OCINE variants missing')
    for variant in variants:
        # The API's bare versio="O" also occurs on dubbed films. Only the
        # variant's published description/parenthesised VO label qualifies it.
        label = ' '.join(variant.get('propietatsDesc') or []) + ' ' + ' '.join(re.findall(r'\(([^)]+)\)',variant['titol']))
        qualification = original_audio(label)
        sessions = variant.get('sessions') or []
        if not qualification:
            excluded += len(sessions)
            continue
        for slot in sessions:
            starts = datetime.fromisoformat(slot['data'][:10] + 'T' + slot['hora']).replace(tzinfo=MADRID)
            rows.append(row('ocine-magic','ocine-magic',slot['planificacio'],film['id'],film['titol'],starts,
                qualification, OCINE + '/#/DetallPelicula/' + str(film['id']),
                OCINE + '/api/v1/pelicula/' + str(film['id']) + '?lang=ca',
                room=str(slot['sala']), booking_scope='film', format=' '.join(variant.get('propietatsDesc') or []),
                runtime_minutes=int(film['durada']) if str(film.get('durada','')).isdigit() else None,
                synopsis=film.get('sinopsis'), source_variant_id=variant['id']))
    return rows, excluded


def collect_ocine_magic(http, now):
    response = http.session.post(OCINE + '/api/v1/sessions', json={'token':'','idioma':'ca',
        'urlWeb':OCINE + '/?idioma=ca&nocap=1#/SeleccioPelicula'}, timeout=30)
    response.raise_for_status()
    index = response.json()
    if fold(index.get('nomCinema')) != 'ocine magic':
        raise ValueError('OCINE returned a different cinema')
    films = {str(f['id']):f for section in ['pelicules','estrenes','anticipades'] for f in index[section]}
    rows, excluded = [], 0
    for fid in films:
        film = http.json(OCINE + '/api/v1/pelicula/' + fid + '?lang=ca')
        if str(film['id']) != fid:
            raise ValueError('Wrong OCINE film detail')
        found, skipped = ocine_film_sessions(film, now)
        rows.extend(found); excluded += skipped
    return report('ocine-magic', rows, now, discovered_films=len(films), excluded_unproven_or_dubbed=excluded)

CAPRI_PROGRAMME = 'https://quefer.elprat.cat/equipaments/cinema-capri'
CAPRI_ORIGINALS = {
    '/activitats/cineclub-ernest-cole-lost-and-found': {
        'language': 'en', 'title': 'ernest cole', 'director': 'raoul peck', 'year': '2024',
        'source': 'https://mk2films.com/en/film/ernest-cole-lost-and-found/',
    },
}


def capri_event(html, url):
    # Related events contain other dates/venues: never use them as evidence.
    text = visible(html).split('Activitats relacionades')[0]
    root = Document(html).root
    heading = next(root.find(lambda e:e.tag == 'h1'), None)
    if not heading or 'cinema capri' not in fold(text):
        raise ValueError('Capri event or venue missing')
    title = clean(heading.text())
    version = re.search(r'\b(?:VOSE|VOSC|VOSI|VOE|VOC|VO)\b', text, re.I)
    qualification = original_audio(text) if version else None
    proof = CAPRI_ORIGINALS.get(urlsplit(url).path)
    if not qualification and proof and all(part in fold(text) for part in [proof['title'],proof['director'],proof['year']]):
        language = re.search(r'Idioma:\s*([^\n]+?)(?:Durada:|Classificaci[oó]:|Direcci[oó]:)', text, re.I)
        if language:
            qualification = original_audio(language[0], audio=clean(language[1]), original=proof['language'],
                evidence='screening_audio_matches_reviewed_original')
    if not qualification:
        return [], {'title':title,'url':url,'reason':'original_audio_unverified'}
    # A single explicitly timed municipal event. Date ranges with prose-only
    # times require a separate verified parser and are not expanded into days.
    date = re.search(r'\bEl\s+(\d{2})\.(\d{2})\.(\d{4})\s+de\s+(\d{1,2}):(\d{2})\s+a\s+', text)
    if not date:
        return [], {'title':title,'url':url,'reason':'exact_session_times_unverified'}
    starts = datetime(int(date[3]),int(date[2]),int(date[1]),int(date[4]),int(date[5]),tzinfo=MADRID)
    fid = urlsplit(url).path
    return [row('cinema-capri','cinema-capri',fid + ':' + starts.strftime('%Y%m%d%H%M'),fid,title,
        starts,qualification,url,url,booking_scope='box_office',
        original_language_source=proof['source'] if proof else None)], None


def collect_capri(http, now):
    html = http.get(CAPRI_PROGRAMME)
    root = Document(html).root
    if 'Cinema CAPRI' not in visible(html):
        raise ValueError('Capri municipal programme missing')
    links = sorted({urljoin(CAPRI_PROGRAMME,e.attrs['href']) for e in root.find(
        lambda e:e.tag == 'a' and e.attrs.get('href','').startswith('/activitats/'))})
    rows, pending = [], []
    for url in links:
        found, excluded = capri_event(http.get(url),url)
        rows.extend(found)
        if excluded:pending.append(excluded)
    return report('cinema-capri',rows,now,mode='verified_programme_sessions',programme_url=CAPRI_PROGRAMME,discovered_events=len(links),
                  events_awaiting_version_or_times=pending)
