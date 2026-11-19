"""Discover exact film pages and retain native language fields from cinema feeds."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit, parse_qs

from cinesa_showtimes import atomic_write
from film_details import Document
from film_identity import keys, titles

INDEXES = {
    'filmoteca': 'https://www.filmoteca.cat/web/ca/view-agenda-setmanal',
    'texas': 'https://espaitexas.cat/cartellera-cinema/',
}
A1 = {'girona': 'https://www.cinemesgirona.cat/api/get-events',
      'verdi': 'https://barcelona.cines-verdi.com/api/get-events'}
KINEPOLIS = 'https://kinepolis.es/movie-formats/laser-ultra'


def index_links(html, url, provider):
    links = []
    for node in Document(html).root.find('a'):
        target = urljoin(url, node.attrs.get('href', ''))
        path = urlsplit(target).path
        if urlsplit(target).hostname != urlsplit(url).hostname:
            continue
        if (provider == 'filmoteca' and '/film/' in path) or (
                provider == 'texas' and path not in ('/', '/cartellera-cinema/') and
                not re.search(r'/tag/|/category/|/autor/|/contact|/politica', path)):
            label = node.attrs.get('title') or node.text()
            if label: links.append({'url': target, 'title': label})
    return links


def discover(films, output, fetch, now, *, force=False):
    path = Path(output) / 'language-sources.json'
    try: previous = json.loads(path.read_text())
    except (OSError, ValueError): previous = {}
    records = previous.get('sources', {})
    providers = {s.get('provider') for f in films for s in f.get('sessions', [])}
    jobs = [(p, u, 'index') for p, u in INDEXES.items() if p in providers]
    jobs += [(p, u, 'a1') for p, u in A1.items() if p in providers]
    if 'kinepolis' in providers: jobs.append(('kinepolis', KINEPOLIS, 'kinepolis'))
    def retrieve(job):
        provider, url, kind = job
        old = records.get(url, {})
        try:
            age = now - datetime.fromisoformat(old.get('attempted_at') or old['checked_at'])
            if not force and previous.get('version')==2 and timedelta(0) <= age < timedelta(hours=6 if old.get('status') == 'ok' else 1):
                return url, old
        except (KeyError, ValueError): pass
        try:
            body = fetch(url)
            html = body.decode('utf-8', 'replace') if isinstance(body, bytes) else body
            entries = []
            if kind == 'index':
                entries = index_links(html, url, provider)
                if provider == 'filmoteca':
                    dates=[s['date'] for f in films for s in f.get('sessions',[])
                           if s.get('provider')=='filmoteca' and s.get('date')]
                    horizon=max(dates,default=now.date().isoformat())
                    visited={url}
                    # Follow published weekly navigation only, bounded by the
                    # actual programme horizon. Never synthesize a film slug.
                    for _ in range(16):
                        links=[urljoin(url,n.attrs.get('href','')) for n in Document(html).root.find('a')]
                        future=[]
                        for target in links:
                            parts=urlsplit(target);day=parse_qs(parts.query).get('w',[''])[0]
                            if (parts.hostname==urlsplit(url).hostname and parts.path==urlsplit(url).path
                                    and re.fullmatch(r'\d{4}-\d{2}-\d{2}',day)
                                    and now.date().isoformat()<day<=horizon and target not in visited):
                                future.append(target)
                        if not future:break
                        next_url=min(future);visited.add(next_url)
                        body=fetch(next_url)
                        html=body.decode('utf-8','replace') if isinstance(body,bytes) else body
                        entries.extend(index_links(html,url,provider))
                if not entries: raise ValueError('Film index missing')
            elif kind == 'a1':
                for event in json.loads(html)['result']:
                    entries.append({'film_id': str(event.get('title_id')), 'imdb_id': event.get('imdbid'),
                        'title': event.get('title_name'), 'localized_title': event.get('locale_title'),
                        'raw': event.get('woriginalversio'), 'url': urljoin(url, '/' + event['title_slug'].lstrip('/')) if event.get('title_slug') else None})
            else:
                from kinepolis_showtimes import programme_from_html
                data = programme_from_html(html)
                for section in ('current_movies', 'future_movies'):
                    for film in data[section]['films']:
                        entries.append({'film_id': film['id'], 'imdb_id': film.get('imdbCode'),
                            'title': film['title'], 'raw': film.get('originalAudioLanguage')})
            return url, {'provider': provider, 'kind': kind, 'entries': entries,
                         'status': 'ok', 'checked_at': now.isoformat()}
        except Exception as error:
            return url, {**old, 'provider': provider, 'kind': kind,
                         'status': 'stale' if old.get('entries') else 'unavailable',
                         'attempted_at': now.isoformat(), 'error': type(error).__name__}
    with ThreadPoolExecutor(max_workers=3) as pool:
        records.update(pool.map(retrieve, jobs))
    claims = {}
    for film in films:
        urls = list(film.get('language_source_urls', []))
        for url, record in records.items():
            sessions = [s for s in film.get('sessions', []) if s.get('provider') == record.get('provider')]
            if not sessions: continue
            for entry in record.get('entries', []):
                if record['kind'] == 'index':
                    matched = bool(keys(titles(film)) & keys([entry['title']]))
                    if record['provider']=='filmoteca' and not matched:
                        # Discovery only: alternate/truncated booking titles
                        # still require exact booking IDs on the fetched page.
                        candidates=keys(re.split(r'\s*/\s*',t)[0].rstrip('.') for t in titles(film))
                        published=keys([entry['title']])
                        matched=bool(candidates & published) or any(len(a)>=25 and b.startswith(a) for a in candidates for b in published)
                else:
                    matched = any(str(s.get('film_id')) == str(entry.get('film_id')) for s in sessions)
                    # Exact provider ID plus a title check protects recycled IDs.
                    matched = matched and bool(keys(titles(film)) & keys([entry.get('title'), entry.get('localized_title')]))
                    if film.get('imdb_id') and entry.get('imdb_id') and entry['imdb_id'] != film['imdb_id']:
                        matched = False
                if not matched: continue
                if entry.get('url'): urls.append(entry['url'])
                if entry.get('raw'):
                    claims.setdefault(film['id'], []).append({'source': record['provider'], 'source_url': url,
                        'raw': entry['raw'], 'evidence': 'explicit_original_language',
                        'checked_at': record['checked_at'], 'status': record['status'],
                        'provider_film_id': entry['film_id']})
        if urls: film['language_source_urls'] = list(dict.fromkeys(urls))
    result = {'version': 2, 'checked_at': now.isoformat(), 'sources': records}
    atomic_write(path, result)
    return claims, result
