"""Regular cultural programmes. Only dated, venue-verified original audio is published."""
from datetime import datetime
import hashlib
import re
from urllib.parse import urljoin, urlsplit

from catalogue_sources import MADRID, clean, visible, graph, row, report
from explore_premium_showtimes import Document
from original_audio import original_audio, fold
from nearby_catalogues import field, text_field, named_date, ALL_MONTHS
from screening_prices import schema_prices, institut_prices, explicit_free

PROGRAMMES = {
    'institut-francais':'https://www.institutfrancais.es/barcelona/eventos/nuestros-eventos/',
    'cccb':'https://www.cccb.org/es/w/proyectos/xcentric',
    'caixaforum-barcelona':'https://caixaforum.org/es/barcelona/actividades',
    'casa-elizalde':'https://www.casaelizalde.com/cinema/',
    'centre-cultural-albareda':'https://albareda.inscripcionscc.com/MiramModular/buscador/buscador.jsp?c=13&f=15&g=1&t=CE',
    'can-carol':'https://cancarol.cat/tag/cinema/',
}


def qualification(text):
    # Avoid treating a film called "Original ..." or a navigation item as proof.
    labels = re.findall(r'\b(?:VOSE|VOSC|VOSI|VOSCAT|VOSCAST|VOE|VOCAT(?:ALAN)?|VOC|VO)\b',text,re.I)
    if re.search(r'\b(?:doblad[ao]|doblad[ae]s|doblat|doblada|dubbed)\b',text,re.I):
        return None
    if not labels:
        return None
    qualified = [original_audio(label) for label in labels]
    tags = {q['version'] for q in qualified if q}
    if len(tags) != 1:
        return None  # A mixed-version double bill needs explicit per-film handling.
    return original_audio(' / '.join(labels))


def poster(root):
    return next((e.attrs.get('content') for e in root.find(
        lambda e:e.tag == 'meta' and e.attrs.get('property') == 'og:image')), None)


def screening(provider, title, url, starts, qual, **extra):
    fid = urlsplit(url).path
    sid = hashlib.sha256((url + starts.isoformat()).encode()).hexdigest()[:20]
    return row(provider,provider,sid,fid,title,starts,qual,url,url,booking_scope='event',**extra)


def pending(title,url,reason='original_audio_unverified'):
    return {'title':title,'url':url,'reason':reason}


def elizalde_event(html,url):
    root = Document(html).root
    article = next(root.find(lambda e:e.tag == 'article' and 'type-cinema' in e.classes()),None)
    if article is None:
        raise ValueError('Elizalde cinema event missing')
    heading = next(article.find(lambda e:e.tag == 'h1'),None)
    title = clean(heading.text())
    text = clean(article.text())
    if re.search(r'performativa|taller',fold(title)):
        return [], pending(title,url,'not_a_confirmed_film_screening')
    qual = qualification(text)
    if not qual:return [],pending(title,url)
    date = re.search(r'\b(\d{2})/(\d{2})/(\d{4})\s*(\d{2}):(\d{2})\b',text)
    if not date:return [],pending(title,url,'exact_session_time_unverified')
    starts = datetime(int(date[3]),int(date[2]),int(date[1]),int(date[4]),int(date[5]),tzinfo=MADRID)
    booking = next((e.attrs['href'] for e in article.find(lambda e:e.tag=='a' and
                   'casaelizalde.inscripcionscc.com' in e.attrs.get('href','') and '&a=' in e.attrs.get('href',''))),url)
    item = screening('casa-elizalde',title,url,starts,qual,poster_url=poster(root),room="Sala d'Actes",
                     **explicit_free(text,url))
    item['booking_url'] = booking
    return [item],None


def collect_elizalde(http,now):
    source = PROGRAMMES['casa-elizalde'];root=Document(http.get(source)).root
    links=sorted({e.attrs['href'] for e in root.find(lambda e:e.tag=='a' and
        e.attrs.get('href','').startswith(source) and e.attrs['href'] not in [source,source+'historic-de-cinema/'])})
    if not links:raise ValueError('Elizalde programme links missing')
    rows,waiting=[],[]
    for url in links:
        found,skip=elizalde_event(http.get(url),url);rows.extend(found)
        if skip:waiting.append(skip)
    return report('casa-elizalde',rows,now,mode='verified_programme_sessions',programme_url=source,
                  discovered_events=len(links),events_awaiting_verification=waiting)


def caixa_event(html,url):
    root=Document(html).root
    events=[e for e in graph(html) if e.get('@type') in ['Event','ScreeningEvent']]
    rows=[];waiting=[]
    # Related programme cards and footer links must not supply language proof.
    text=visible(html).split('MÁS ACTIVIDADES')[0].split('Otras actividades')[0].split('Oculto Información')[0]
    for event in events:
        if fold(event.get('location',{}).get('name'))!='caixaforum barcelona':continue
        title=event['name']
        if not re.search(r'cine|pel[ií]cula|proyecci[oó]n|cortometraje',fold(text)):continue
        qual=qualification(text)
        if not qual:waiting.append(pending(title,url));continue
        starts=datetime.fromisoformat(event['startDate'])
        if starts.tzinfo is None:raise ValueError('CaixaForum timezone missing')
        # A multi-day schema range is not a daily recurrence rule.
        if event.get('endDate','')[:10]!=event['startDate'][:10]:
            waiting.append(pending(title,url,'multi_day_schedule_needs_exact_sessions'));continue
        item=screening('caixaforum-barcelona',title,url,starts,qual,poster_url=event.get('image'),
                       **schema_prices(event.get('offers'),url))
        ticket=next((e.attrs['href'] for e in root.find(lambda e:e.tag=='a' and
                   e.attrs.get('href','').startswith('https://ticket.caixaforum.org/es/barcelona/tickets/') and
                   'date='+starts.date().isoformat() in e.attrs['href'])),None)
        if ticket:item['booking_url']=ticket
        rows.append(item)
    return rows,waiting


def collect_caixaforum(http,now):
    source=PROGRAMMES['caixaforum-barcelona']
    # The permanent activity listing plus permanent cineclub/family indexes
    # cover the regular programme and newly announced cycles.
    indexes=[source,'https://caixaforum.org/es/barcelona/ciclos',
             'https://caixaforum.org/es/barcelona/p/tiempo-de-cine.-el-cineclub-de-caixaforum-barcelona']
    links=set();cycles=set()
    for index in indexes:
        root=Document(http.get(index)).root
        for e in root.find(lambda e:e.tag=='a' and '/es/barcelona/p/' in e.attrs.get('href','')):
            url=urljoin(source,e.attrs['href']);text=fold(e.text())
            if re.search(r'cine|proyecci|pelicula|cortometraje|festival inclus',text):
                links.add(url)
                if 'ciclo' in text:cycles.add(url)
    for cycle in sorted(cycles):
        root=Document(http.get(cycle)).root
        links.update(urljoin(cycle,e.attrs['href']) for e in root.find(lambda e:e.tag=='a' and
                     '/es/barcelona/p/' in e.attrs.get('href','') and clean(e.text()) and 'ciclo' not in fold(e.text())))
    rows,waiting=[],[]
    for url in sorted(links):
        found,skips=caixa_event(http.get(url),url);rows.extend(found);waiting.extend(skips)
    return report('caixaforum-barcelona',rows,now,mode='verified_programme_sessions',programme_url=source,
                  discovered_pages=len(links),events_awaiting_verification=waiting)


def ohlala_sessions(index,fetch):
    root=Document(index).root;rows=[];waiting=[]
    cards=list(root.find(lambda e:'pelicula' in e.classes()))
    if not cards:raise ValueError('Ohlalà programme missing')
    for card in cards:
        text=clean(card.text())
        if not re.search(r'Sede\s+Institut fran[cç]ais',text,re.I):continue
        film=next(card.find(lambda e:e.tag=='a' and '/es/pelicula/' in e.attrs.get('href','')),None)
        if film is None:continue
        url=film.attrs['href'];html=fetch(url);detail=visible(html).split('Sinopsis')[0]
        version=re.search(r'Subt[ií]tulos\s*(.*?)(?:Comprar|Sinopsis|$)',detail,re.I)
        qual=qualification(version[1] if version else '')
        title=clean(film.text())
        if not qual:waiting.append(pending(title,url));continue
        date=re.search(r'(\d{2})/(\d{2})/(\d{4})\s*-\s*(\d{2}):(\d{2})',text)
        if not date:raise ValueError('Ohlalà screening date missing')
        starts=datetime(int(date[3]),int(date[2]),int(date[1]),int(date[4]),int(date[5]),tzinfo=MADRID)
        booking=next((e.attrs['href'] for e in card.find(lambda e:e.tag=='a' and
                     'www.codetickets.com/portal/oh-la-la-festival/online/' in e.attrs.get('href',''))),None)
        if not booking:raise ValueError('Ohlalà ticket link missing')
        item=screening('institut-francais',title,url,starts,qual,poster_url=poster(Document(html).root))
        item['booking_url']=booking;rows.append(item)
    return rows,waiting


def institut_event(html,url):
    root=Document(html).root
    article=next(root.find(lambda e:e.tag=='article' and 'type-event' in e.classes()),None)
    if article is None:raise ValueError('Institut event missing')
    text=clean(article.text());heading=next(article.find(lambda e:e.tag=='h1'),None)
    title=clean(heading.text()) if heading else ''
    if 'category_event-cine' not in article.classes():return [],None
    venue=re.search(r'Lugar\s+(.*?)\s*(?:Ver mapa|Sesiones)',text)
    if not venue or 'institut francais de barcelona' not in fold(venue[1]):return [],pending(title,url,'offsite_or_unverified_venue')
    lang=re.search(r'Idioma\s*(.*?)(?:Pa[ií]s|Duraci[oó]n|Direcci[oó]n|Reparto|Año|$)',text)
    qual=qualification(lang[1] if lang else '')
    if not qual:return [],pending(title,url)
    months={k[:3]:v for k,v in ALL_MONTHS.items()}
    dates=re.findall(r'\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3})\s+(\d{4})\s*(\d{2}):(\d{2})',text)
    if not dates:return [],pending(title,url,'exact_session_times_unverified')
    booking=next((e.attrs.get('href') for e in article.find(lambda e:e.tag=='a' and clean(e.text())=='Reservar')),url)
    rows=[]
    for day,month,year,hour,minute in dates:
        starts=datetime(int(year),months[fold(month)],int(day),int(hour),int(minute),tzinfo=MADRID)
        item=screening('institut-francais',title,url,starts,qual,poster_url=poster(root),
                       **institut_prices(article,url));item['booking_url']=booking;rows.append(item)
    return rows,None


def collect_institut(http,now):
    source=PROGRAMMES['institut-francais'];rows=[];waiting=[]
    try:
        root=Document(http.get(source)).root
        links=sorted({e.attrs['href'] for e in root.find(lambda e:e.tag=='a' and
                     '/barcelona/evento/' in e.attrs.get('href','') and 'Cine' in e.text())})
        if not links:raise ValueError('Institut cinema links missing')
        for url in links:
            found,skip=institut_event(http.get(url),url);rows.extend(found)
            if skip:waiting.append(skip)
        mode='official_agenda'
    except Exception as error:
        # The festival's official programme supplies dates, venue and VO labels
        # independently. It is explicitly partial coverage of the Institut.
        rows=[];waiting=[]
        try:
            rows,waiting=ohlala_sessions(http.get('https://www.ohlalafilmfestival.com/es/parrilla/'),http.get)
            mode='official_festival_fallback'
        except Exception:
            raise error
    return report('institut-francais',rows,now,mode='verified_programme_sessions',programme_url=source,programme_mode=mode,
                  primary_agenda_status='unavailable' if mode=='official_festival_fallback' else 'ok',
                  fallback_programme_url='https://www.ohlalafilmfestival.com/es/parrilla/' if mode=='official_festival_fallback' else None,
                  events_awaiting_verification=waiting)


def collect_programme_monitor(http, now, cinema):
    """Keep a permanent programme link without manufacturing session/audio data.

    These three listings currently lack reliable per-screening version evidence.
    Discovery records are review candidates, never dated sessions or seat counts.
    """
    source = PROGRAMMES[cinema]
    html = http.get(source)
    root = Document(html).root
    text = fold(visible(html))
    required = {'cccb': 'xcentric', 'centre-cultural-albareda': 'albareda', 'can-carol': 'can carol'}[cinema]
    if required not in text.replace('x\u00e8ntric', 'xcentric'):
        raise ValueError('Cultural programme identity missing')
    candidates = {}
    if cinema == 'centre-cultural-albareda':
        for card in root.find(lambda e:'card' in e.classes() and 'overh' in e.classes()):
            heading = next(card.find(lambda e:e.tag in ['h2','h3','h4','h5']),None)
            if heading:
                title=clean(heading.text())
                candidates[title]=pending(title,source,'session_version_and_film_start_require_verification')
    else:
        path = '/es/w/actividades/' if cinema == 'cccb' else '/events/'
        for link in root.find(lambda e:e.tag=='a' and path in e.attrs.get('href','')):
            url=urljoin(source,link.attrs['href']);title=clean(link.text())
            if title and urlsplit(url).hostname == urlsplit(source).hostname and urlsplit(url).path.rstrip('/') != path.rstrip('/'):
                candidates.setdefault(url,pending(title,url))
    return report(cinema,[],now,mode='programme_links_only',programme_url=source,
                  discovered_programme_links=list(candidates.values()),
                  limitation='Programme monitored; exact original-audio screenings not yet verified')
