"""Authenticated, exact-IMDb language fallback. Never log credentials or responses."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import json
import hashlib
import os
from pathlib import Path
import re

from cinesa_showtimes import atomic_write
from language_names import parse_languages, LANGUAGE_NAMES

ROOT = Path(__file__).resolve().parents[1]


def credentials():
    names = ('TMDB_READ_ACCESS_TOKEN', 'TMDB_ACCESS_TOKEN', 'TMDB_API_KEY')
    local = {}
    try:
        for line in (ROOT / '.env.tmdb').read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip() in names:
                local[key.strip()] = value.strip().strip('\"\'')
    except OSError:
        pass
    return {key: os.getenv(key) or local.get(key) for key in names}


def client(config):
    from curl_cffi import requests
    token = config.get('TMDB_READ_ACCESS_TOKEN') or config.get('TMDB_ACCESS_TOKEN')
    def get(path, **params):
        headers = {'Accept': 'application/json'}
        if token: headers['Authorization'] = 'Bearer ' + token
        else: params['api_key'] = config['TMDB_API_KEY']
        response = requests.get('https://api.themoviedb.org/3/' + path, params=params,
                                headers=headers, impersonate='chrome', timeout=20)
        if response.status_code != 200:
            raise ValueError('TMDB request failed')
        return response.json()
    return get


def movie_claim(movie, now):
    ident=movie['id']
    parsed = parse_languages(movie.get('original_language'))
    spoken = parse_languages([v.get('iso_639_1') or v.get('english_name') for v in movie.get('spoken_languages', [])])
    return {'status': 'ok', 'checked_at': now.isoformat(), 'source_url': 'https://www.themoviedb.org/movie/' + str(ident),
            'raw': movie.get('original_language'), **parsed, 'evidence': 'explicit_original_language',
            'source': 'tmdb', 'imdb_id': movie.get('imdb_id'), 'tmdb_id': ident,
            'spoken_languages': [LANGUAGE_NAMES[c] for c in spoken['codes']]}


def lookup(imdb, get, now):
    results = get('find/' + imdb, external_source='imdb_id').get('movie_results', [])
    if len(results) != 1:
        return {'status': 'unmatched' if not results else 'ambiguous', 'checked_at': now.isoformat()}
    ident = results[0].get('id')
    if type(ident) is not int: raise ValueError('Invalid TMDB identity')
    movie = get('movie/' + str(ident))
    if movie.get('id') != ident or movie.get('imdb_id') != imdb:
        raise ValueError('TMDB IMDb identity mismatch')
    return movie_claim(movie, now)


def lookup_source(facts, get, now):
    """Resolve an IMDb-free film only with published title, director and year."""
    from film_identity import keys, clean_title
    if not facts.get('directors') or not facts.get('years') or not facts.get('titles'):
        return {'status':'needs_identity_evidence','checked_at':now.isoformat()}
    matches, seen = {}, set()
    for title in list(dict.fromkeys(clean_title(t) for t in facts['titles']))[:3]:
        # Double bills/shorts programmes must never inherit one component's language.
        if re.search(r'\s[|+]\s|\s/\s|\b(?:programa|curtmetratges|shorts programme)\b',title,re.I):
            continue
        for candidate in get('search/movie',query=title,include_adult='false').get('results',[])[:8]:
            ident=candidate.get('id')
            if type(ident) is not int or ident in seen:continue
            seen.add(ident)
            if not keys(facts['titles']) & keys([candidate.get('title'),candidate.get('original_title')]):continue
            year=str(candidate.get('release_date',''))[:4]
            if not year.isdigit() or not any(abs(int(year)-int(y))<=1 for y in facts['years']):continue
            movie=get('movie/'+str(ident),append_to_response='credits')
            if movie.get('id')!=ident:continue
            directors=[p.get('name') for p in movie.get('credits',{}).get('crew',[]) if p.get('job')=='Director']
            if not keys(facts['directors']) & keys(directors):continue
            runtime=movie.get('runtime')
            # Cinema copies and catalogue runtimes can differ by a few minutes
            # (e.g. 98 vs 104). Title + director + year must already agree;
            # reject substantial runtime contradictions, including double bills.
            if runtime and facts.get('runtimes') and not any(abs(runtime-r)<=max(8,r*.08) for r in facts['runtimes']):continue
            matches[ident]=movie
    if len(matches)!=1:return {'status':'ambiguous' if matches else 'unmatched','checked_at':now.isoformat()}
    result=movie_claim(next(iter(matches.values())),now)
    result['identity_evidence']={'matched':['title','director','release_year'], 'sources':facts.get('sources',[])}
    return result


def enrich(films, output, now, *, force=False, get=None, config=None, source_facts=None):
    path = Path(output) / 'tmdb-languages.json'
    try: saved = json.loads(path.read_text()).get('films', {})
    except (OSError, ValueError): saved = {}
    config = credentials() if config is None else config
    enabled = get is not None or any(config.values())
    if not enabled:
        return {'status': 'not_configured', 'films': saved}
    get = get or client(config)
    source_facts=source_facts or {}
    ids = sorted({f['imdb_id'] if re.fullmatch(r'tt\d{7,10}', f.get('imdb_id') or '') else 'source:'+f['id']
                  for f in films if f.get('imdb_id') or f['id'] in source_facts})
    def retrieve(imdb):
        old = saved.get(imdb, {})
        signature=(hashlib.sha256(json.dumps([2,source_facts.get(imdb[7:],{})],sort_keys=True).encode()).hexdigest()
                   if imdb.startswith('source:') else None)
        try:
            age = now - datetime.fromisoformat(old['attempted_at'] if old.get('status') == 'stale' else old['checked_at'])
            if not force and old.get('identity_fingerprint')==signature and timedelta(0) <= age < timedelta(hours=24 if old.get('status') == 'ok' else 1):
                return imdb, old
        except (KeyError, ValueError): pass
        try:
            record=lookup_source(source_facts[imdb[7:]],get,now) if imdb.startswith('source:') else lookup(imdb, get, now)
            return imdb,{**record,'identity_fingerprint':signature}
        except Exception as error:
            return imdb, {**old, 'status': 'stale' if old.get('codes') else 'unavailable',
                          'attempted_at': now.isoformat(), 'error': type(error).__name__}
    with ThreadPoolExecutor(max_workers=3) as pool:
        saved.update(pool.map(retrieve, ids))
    result = {'version': 1, 'status': 'configured', 'checked_at': now.isoformat(), 'films': saved}
    atomic_write(path, result)
    return result
