"""Persistent public identities. Titles and scraper IDs never own published URLs."""
import copy
import hashlib
import re
import unicodedata
from screening_languages import has_english_subtitles

LOCALES = ('en', 'es', 'ca')
SECTIONS = {'en': {'films': 'films', 'cinemas': 'cinemas', 'guides': 'guides', 'about': 'about'},
            'es': {'films': 'peliculas', 'cinemas': 'cines', 'guides': 'guias', 'about': 'acerca-de'},
            'ca': {'films': 'pellicules', 'cinemas': 'cinemes', 'guides': 'guies', 'about': 'sobre-nosaltres'}}
RESERVED = {'search', 'page', 'new', 'index', 'api', 'assets'}
FILM_FIELDS = ('title', 'original_title', 'english_title', 'release_year', 'imdb_id', 'runtime_minutes',
               'details', 'ratings', 'poster_url', 'poster_width', 'poster_height', 'poster_image', 'titles', 'title_provenance')


def slugify(value):
    value = str(value).lower().translate(str.maketrans({'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l',
                                                      'đ': 'd', 'ð': 'd', 'þ': 'th', '’': '', "'": ''}))
    value = unicodedata.normalize('NFKD', value)
    value = ''.join(c for c in value if not unicodedata.combining(c))
    value = re.sub(r'[^a-z0-9]+', '-', value).strip('-')
    if not value or len(value) > 100:
        raise ValueError('A reviewed slug override is required for: ' + str(value))
    return value


def path_for(record, lang='en'):
    return f'/{lang}/{SECTIONS[lang][record["kind"]]}/{record["slugs"][lang]}/'


def new_registry():
    return {'version': 1, 'entities': {}, 'aliases': {}, 'redirects': {}}


def film_slug(film):
    title = film.get('english_title') if film.get('title_language') in ('ja', 'zh', 'ko') else film['title']
    title = title or film['title']
    year = film.get('release_year') or film.get('details', {}).get('release_year')
    if isinstance(year, int) and 1880 <= year <= 2200:
        title = re.sub(r'\s*\(' + str(year) + r'\)\s*$', '', title)
        title = f'{title}-{year}'
    return slugify(title)


def update_registry(previous, programme, cinemas, checked_at, overrides=None):
    registry = copy.deepcopy(previous)
    overrides = overrides or {}
    entities, aliases = registry['entities'], registry['aliases']
    for kind, items in [('films', programme['films']), ('cinemas', cinemas)]:
        for item in sorted(items, key=lambda x: x['id']):
            keys = [f'{kind}:{key}' for key in [item['id'], *item.get('merged_ids', [])]]
            # Sant Cugat supplies both the stable provider film ID and IMDb ID
            # on each session. Titles are not evidence for an identity merge.
            if kind == 'films' and item.get('imdb_id'):
                for session in item.get('sessions', []):
                    if (session.get('provider') == 'sant-cugat-cinemas'
                            and session.get('imdb_id') == item['imdb_id']
                            and re.fullmatch(r'\d+', str(session.get('film_id', '')))):
                        key = 'films:sant-cugat-cinemas:' + str(session['film_id'])
                        prior = entities.get(aliases.get(key), {}).get('film', {}).get('imdb_id')
                        if prior and prior != item['imdb_id']:
                            raise ValueError('Conflicting provider film identity: ' + key)
                        keys.append(key)
            found = sorted({aliases[key] for key in keys if key in aliases},
                           key=lambda key: (entities[key]['created_at'], key))
            if found:
                entity_id = found[0]
                record = entities[entity_id]
                # Known merges permanently redirect the former published pages.
                for losing_id in found[1:]:
                    losing = entities[losing_id]
                    if losing.get('english_subtitles_seen') or any(has_english_subtitles(s) for s in losing.get('screenings', [])):
                        record['english_subtitles_seen'] = True
                    for lang in LOCALES:
                        registry['redirects'][path_for(losing, lang)] = path_for(record, lang)
                    for alias, owner in list(aliases.items()):
                        if owner == losing_id:
                            aliases[alias] = entity_id
                    del entities[losing_id]
            else:
                entity_id = hashlib.sha256(keys[0].encode()).hexdigest()[:16]
                base = overrides.get(keys[0]) or (film_slug(item) if kind == 'films' else slugify(item['name']))
                if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', base) or len(base) > 100:
                    raise ValueError('Invalid slug override: ' + keys[0])
                used = {r['slugs']['en'] for r in entities.values() if r['kind'] == kind}
                # A merged entity's old URL stays reserved for its redirect forever.
                used.update(p.rstrip('/').rsplit('/', 1)[-1] for p in registry['redirects']
                            if p.startswith(f'/en/{SECTIONS["en"][kind]}/'))
                if base in used or base in RESERVED:
                    base += '-' + entity_id[:8]
                if len(base) > 100:
                    raise ValueError('A shorter reviewed slug override is required for: ' + keys[0])
                if base in used:
                    raise ValueError('Slug collision: ' + base)
                record = {'kind': kind, 'created_at': checked_at, 'slugs': dict.fromkeys(LOCALES, base)}
                entities[entity_id] = record
            for key in keys:
                aliases[key] = entity_id
            record['source_id'] = item['id']
            if kind == 'films':
                if any(has_english_subtitles(s) for s in [*item.get('sessions', []), *record.get('screenings', [])]):
                    record['english_subtitles_seen'] = True
                record['film'] = {key: copy.deepcopy(item[key]) for key in FILM_FIELDS if key in item}
                # Keep collected screening facts when films leave the programme.
                from browser_programme import browser_programme
                historical_item = {**item, 'sessions': [s for s in item.get('sessions', []) if s.get('id') and s.get('starts_at')]}
                sessions = browser_programme({'films': [historical_item]})['films'][0]['sessions']
                history = {s['id']: s for s in record.get('screenings', [])}
                history.update({s['id']: s for s in sessions})
                record['screenings'] = sorted(history.values(), key=lambda s: s['starts_at'])[-500:]
            else:
                record['cinema'] = copy.deepcopy(item)
    # Flatten historical redirects even after several subsequent identity merges.
    for old, target in list(registry['redirects'].items()):
        seen = {old}
        while target in registry['redirects']:
            if target in seen:
                raise ValueError('URL redirect cycle')
            seen.add(target)
            target = registry['redirects'][target]
        registry['redirects'][old] = target
    return registry


def resolve(registry, kind, source_id):
    entity = registry['aliases'].get(f'{kind}:{source_id}')
    return registry['entities'].get(entity)
