#!/usr/bin/env python3
"""Build a versioned, crawlable VO Barna publication from validated local data.

No network requests. The active publication and its identity registry change
together through one atomic symlink replacement after the complete build passes.
"""
import argparse
import copy
import fcntl
from datetime import datetime, timezone, timedelta
import hashlib
from html import escape
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from site_content import COPY, GUIDES, PUBLISHER, VENUE_COPY
from site_research import ResearchTranslations
from site_identity import LOCALES, SECTIONS, new_registry, path_for, resolve, update_registry
from optimize_images import optimize_logo, optimize_mascot_animation, prepare_images
from browser_programme import browser_programme
from language_names import without_language_placeholder
from discovery_content import PATHS as DISCOVERY_PATHS, COPY as DISCOVERY_COPY, select_sessions, weekend_dates
from discovery_guides import SECTIONS as DISCOVERY_SECTIONS, SOURCES as DISCOVERY_SOURCES
from discovery_local import GRACIA_VENUES, SOURCES as LOCAL_SOURCES
from discovery_collections import (EIXAMPLE_VENUES, repertory_match, OFFERS,
                                   REVIEWED_ON, SOURCES as COLLECTION_SOURCES)
from date_listings import DAY_PATHS, COPY as DATE_COPY, published_dates, build_date_views
from complete_programme import LABELS as PROGRAMME_LABELS, paginate_programme, programme_path, render_programme_directory

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / '.site'
ORIGIN = 'https://vobarna.com'
MADRID = ZoneInfo('Europe/Madrid')
PAGE_SIZE = 24
LANGUAGES = {'English': ('English', 'Inglés', 'Anglès'), 'Spanish': ('Spanish', 'Español', 'Castellà'),
             'Catalan': ('Catalan', 'Catalán', 'Català'), 'French': ('French', 'Francés', 'Francès'),
             'German': ('German', 'Alemán', 'Alemany'), 'Japanese': ('Japanese', 'Japonés', 'Japonès'),
             'Korean': ('Korean', 'Coreano', 'Coreà'), 'Italian': ('Italian', 'Italiano', 'Italià'),
             'Portuguese': ('Portuguese', 'Portugués', 'Portuguès'), 'Chinese': ('Chinese', 'Chino', 'Xinès'),
             'Hindi': ('Hindi', 'Hindi', 'Hindi'), 'Basque': ('Basque', 'Euskera', 'Basc'),
             'Hebrew': ('Hebrew', 'Hebreo', 'Hebreu'), 'Guarani': ('Guarani', 'Guaraní', 'Guaraní'),
             'Galician': ('Galician', 'Gallego', 'Gallec'), 'Xhosa': ('Xhosa', 'Xhosa', 'Xhosa'),
             'Swedish': ('Swedish', 'Sueco', 'Suec'),
             'No spoken language': ('No spoken language', 'Sin lenguaje hablado', 'Sense llenguatge parlat')}
LANGUAGE_ALIASES = {label.casefold(): name for name, labels in LANGUAGES.items() for label in labels}
LANGUAGE_ALIASES.update({'en': 'English', 'es': 'Spanish', 'ca': 'Catalan', 'fr': 'French',
                         'de': 'German', 'ja': 'Japanese', 'ko': 'Korean', 'it': 'Italian',
                         'pt': 'Portuguese', 'zh': 'Chinese', 'hi': 'Hindi', 'eu': 'Basque',
                         'he': 'Hebrew', 'gn': 'Guarani', 'gl': 'Galician', 'xh': 'Xhosa',
                         'sv': 'Swedish', 'zxx': 'No spoken language'})
LANGUAGE_ALIASES.update({'castellano': 'Spanish', 'español': 'Spanish', 'espanyol': 'Spanish', 'catalán': 'Catalan'})


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        if default is not None:
            return copy.deepcopy(default)
        raise


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')


def text(value):
    return escape(str(value), quote=True)


def safe_url(value):
    value = str(value or '')
    if value.startswith('/') and not value.startswith('//') and '\\' not in value:
        return value
    parsed = urlsplit(value)
    return value if parsed.scheme == 'https' and parsed.netloc and not parsed.username else ''


def link(url, label, extra=''):
    url = safe_url(url)
    return f'<a href="{text(url)}"{extra}>{text(label)}</a>' if url else text(label)


def stamp(value):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            return text(value)
        return f'<time datetime="{text(value)}">{dt.astimezone(MADRID):%Y-%m-%d %H:%M} Europe/Madrid</time>'
    except ValueError:
        return text(value or '')


def language_name(value, lang):
    if without_language_placeholder(value) is None:
        return COPY[lang]['unknown']
    # Sources use locale names, ISO codes and comma-separated multilingual audio.
    # Translate only identified labels; unfamiliar values remain exactly as given.
    names = []
    for item in str(value).split(','):
        item = item.strip()
        if item:
            name = LANGUAGE_ALIASES.get(item.casefold())
            names.append(LANGUAGES[name][LOCALES.index(lang)] if name else item)
    return ', '.join(names)


def validate_programme(data):
    if not isinstance(data.get('films'), list) or not isinstance(data.get('cinemas'), list):
        raise ValueError('Invalid programme')
    datetime.fromisoformat(data['generated_at'].replace('Z', '+00:00'))
    seen, films = set(), set()
    venues = {v['id'] for v in data['cinemas']}
    for film in data['films']:
        if film['id'] in films or not film.get('title'):
            raise ValueError('Duplicate or invalid film')
        films.add(film['id'])
        for session in film['sessions']:
            dt = datetime.fromisoformat(session['starts_at'])
            if dt.tzinfo is None or session['cinema_id'] not in venues or session['id'] in seen:
                raise ValueError('Invalid session identity, venue or timezone')
            seen.add(session['id'])


class Publication:
    def __init__(self, destination, programme, registry, research, previous, now, origin):
        self.dest, self.data, self.registry = destination, programme, registry
        self.research, self.previous, self.now, self.origin = research, previous, now, origin
        self.pages = {}
        self.dates = published_dates(programme, now)
        self.translations = ResearchTranslations()
        self.current = {f['id']: f for f in programme['films']}
        self.current_by_entity = {registry['aliases']['films:' + f['id']]: f for f in programme['films']}
        self.cinemas = {c['id']: c for c in research['dossiers']['cinemas']}
        self.cinemas.update({c['id']: {**c, **self.cinemas.get(c['id'], {})} for c in programme['cinemas']})
        self.by_cinema = {}
        for film in programme['films']:
            for session in film['sessions']:
                if datetime.fromisoformat(session['starts_at']) >= now:
                    self.by_cinema.setdefault(session['cinema_id'], []).append((film, session))
        # One renderer owns both the first HTML paint and the interactive cards.
        self.browser_programme = compact_programme(programme, registry, now)
        rendered = subprocess.run(['node', str(ROOT / 'scripts/render_listing_views.mjs')],
                                  input=json.dumps({'programme': self.browser_programme,
                                                    'now': now.isoformat(), 'limit': PAGE_SIZE,
                                                    'cinema_ids': list(self.cinemas), 'dates': self.dates}),
                                  text=True, capture_output=True, check=True)
        self.listing_views = json.loads(rendered.stdout)

    def entity_path(self, kind, source_id, lang):
        record = resolve(self.registry, kind, source_id)
        return path_for(record, lang) if record else f'/{lang}/{SECTIONS[lang][kind]}/'

    def research_text(self, value, lang):
        return text(self.translations.translate(value, lang))

    def citations(self, ids, sources, lang):
        found = []
        for sid in dict.fromkeys(ids or []):
            source = sources.get(sid, {})
            if safe_url(source.get('url')):
                label = source.get('title') or source['url']
                checked = source.get('accessed_on') or source.get('checked_on') or source.get('checked_at') or source.get('fetched_at')
                found.append(link(source['url'], label) + (f' <small>({text(checked)})</small>' if checked else ''))
        return '<span class="citations">' + ' · '.join(found) + '</span>' if found else ''

    def page(self, path, lang, title, description, body, *, alternatives=None, graph=None, interactive=False, crumbs=None, index=True, footer_extra='', venue=False, cinema_id=None, date_scope=None, write=True, film_page=False):
        t = COPY[lang]
        alternatives = alternatives or {lang: path}
        canonical = self.origin + path
        nodes = [{'@type': 'WebPage', '@id': canonical + '#page', 'url': canonical, 'name': title,
                  'description': description, 'inLanguage': lang, 'isPartOf': {'@id': self.origin + '/#website'},
                  'publisher': {'@id': self.origin + '/#publisher'}},
                 {'@type': 'Person', '@id': self.origin + '/#publisher', 'name': PUBLISHER['name'],
                  'email': PUBLISHER['email'], 'url': self.origin + f'/{lang}/{SECTIONS[lang]["about"]}/'}]
        if graph:
            nodes.extend(graph)
        breadcrumb = ''
        if crumbs:
            entries = [(t['current'], f'/{lang}/'), *crumbs]
            visible_entries = entries[1:] if venue or film_page else entries
            breadcrumb = f'<nav class="breadcrumbs" aria-label="{t["breadcrumb"]}">' + ' / '.join(link(url, label) for label, url in visible_entries) + '</nav>'
            nodes.append({'@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': label, 'item': self.origin + url} for i, (label, url) in enumerate(entries)]})
        ld = json.dumps({'@context': 'https://schema.org', '@graph': nodes}, ensure_ascii=False).replace('<', '\\u003c')
        alternate = ''.join(f'<link rel="alternate" hreflang="{l}" href="{self.origin + p}">' for l, p in alternatives.items())
        alternate += f'<link rel="alternate" hreflang="x-default" href="{self.origin + alternatives.get("en", path)}">'
        nav = ''.join(link(f'/{lang}/{SECTIONS[lang][key]}/', t[key]) for key in ('films', 'cinemas', 'guides'))
        navigation = f'<nav class="site-nav" aria-label="{t['main_navigation']}">{nav}</nav>'
        footer = f'<p>{text(t["independent"])}</p><p>{link(f"/{lang}/{SECTIONS[lang]['about']}/", t["about"])} · {link("/webmcp/", t["agent_guide"])}</p>'
        today_link = link(DAY_PATHS['today'][lang], DATE_COPY[lang]['today_link'])
        tomorrow_link = link(DAY_PATHS['tomorrow'][lang], DATE_COPY[lang]['tomorrow_link'])
        discovery_links = f'<nav class="discovery-links" aria-label="{text(DISCOVERY_COPY[lang]["footer"])}"><ul><li>{today_link}</li><li>{tomorrow_link}</li>' + ''.join(
            '<li>' + link(paths[lang], DISCOVERY_COPY[lang][kind]) + '</li>' for kind, paths in DISCOVERY_PATHS.items()) + '</ul></nav>'
        if interactive or venue or film_page:
            footer = f'<details class="site-information"><summary>{t["more_info"]}</summary>{navigation}{footer_extra}{discovery_links}{footer}</details>'
            navigation = ''
        else:
            footer += f'<details class="site-information"><summary>{text(DISCOVERY_COPY[lang]["footer"])}</summary>{discovery_links}</details>'
        switch = ''.join(link(alternatives[l], l.upper(), f' hreflang="{l}" lang="{l}"' + (' aria-current="page"' if l == lang else '')) for l in LOCALES if l in alternatives)
        # The image loader can execute without waiting for the search module graph.
        script = '<script type="module" src="/progressive-images.js"></script><script type="module" src="/site-header.js"></script>'
        if interactive:
            script += ''.join(f'<link rel="modulepreload" href="/{name}.js">' for name in
                              ('programme-data', 'programme-cache', 'listing-view', 'cinema-copy', 'cinema-search', 'search-dates', 'cinema-service', 'webmcp', 'webmcp-registration', 'webmcp-sdk'))
            script += '<script type="module" src="/cinemas.js"></script><noscript><style>.public-site .filters{display:none}</style></noscript>'
        if not interactive or venue:
            script += '<script type="module" src="/site-page.js"></script>'
        cinema_scope = f' data-cinema-id="{text(cinema_id)}"' if cinema_id else ''
        date_attrs = f' data-listing-date="{date_scope["date"]}" data-date-kind="{date_scope["kind"]}"' if date_scope else ''
        # This small disclosure style must not add a render-blocking request.
        programme_style = '<style>' + (ROOT / 'static/complete-programme.css').read_text() + '</style>' if date_scope or path == f'/{lang}/' or path.startswith(programme_path(lang)) else ''
        if path == f'/{lang}/':
            script += '<script type="module" src="/complete-programme.js"></script>'
        html = f'''<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
{'<base target="_blank">' if venue else ''}
<title>{text(title)}</title><meta name="description" content="{text(description)}"><meta name="robots" content="{'index,follow' if index else 'noindex,follow'}">
<link rel="canonical" href="{canonical}">{alternate}<meta property="og:type" content="website"><meta property="og:title" content="{text(title)}"><meta property="og:description" content="{text(description)}"><meta property="og:url" content="{canonical}"><meta property="og:site_name" content="VO Barna"><meta property="og:image" content="{self.origin}/clint.png"><meta name="twitter:card" content="summary">
<link rel="icon" href="/clint-logo.webp"><link rel="preload" href="/fonts/Bungee-Regular.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=B612:ital,wght@0,400;0,700;1,400;1,700&amp;display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<script src="https://cdn.nekuda.ai/v1/trial-token.js"></script>
<script src="/theme.js"></script>
<link rel="stylesheet" href="/cinemas.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/site.css">{programme_style}<script type="application/ld+json">{ld}</script>{script}
</head>
<body class="public-site{' venue-page' if venue else ''}{' film-page' if film_page else ''}" data-site-lang="{lang}" data-programme-heading="{text(t["home"])}"{cinema_scope}{date_attrs} data-programme-url="/programme.json" data-availability-url="/availability.json"><a class="skip" href="#main" target="_self">{t['skip']}</a>
<div class="header-wrap"><header><div class="logo"><button class="clint-button" type="button" aria-label="{t['poke_clint']}"><img class="logo-mark" src="/clint-idle.webp" width="60" height="60" alt="{text(t['mascot_alt'])}"></button><a class="logo-copy" href="/{lang}/"><span class="logo-name">VO Barna</span><span class="logo-subtitle" data-i18n="siteSubtitle">{text(t["site_subtitle"])}</span></a></div><nav class="lang-switch" aria-label="{t['language_navigation']}">{switch}</nav></header></div>
<main id="main">{navigation}{breadcrumb}{body}</main>
<footer class="site-footer">{footer}</footer>
{'<dialog id="filmDialog" aria-labelledby="dialogTitle"></dialog>' if interactive else ''}</body></html>'''
        if not write:
            return html
        self.save_page(path, lang, html, index)

    def save_page(self, path, lang, html, index):
        digest = hashlib.sha256(html.encode()).hexdigest()
        old = self.previous.get('pages', {}).get(path, {})
        modified = old.get('lastmod') if old.get('hash') == digest else self.now.isoformat()
        self.pages[path] = {'hash': digest, 'lastmod': modified, 'index': index, 'lang': lang}
        target = self.dest / (path.lstrip('/') + 'index.html' if path.endswith('/') else path.lstrip('/'))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html)

    def film_data(self, entity_id, record):
        current = self.current_by_entity.get(entity_id)
        film = {**record['film'], 'id': record['source_id'], 'sessions': []}
        if current:
            film.update(current)
            film['sessions'] = [s for s in current['sessions'] if datetime.fromisoformat(s['starts_at']) >= self.now]
        return film

    def poster(self, film, *, eager=False):
        url = safe_url(film.get('poster_url'))
        if not url:
            return ''
        image = film.get('poster_image') or {}
        dimensions = f'width="{int(image.get("width") or film.get("poster_width") or 600)}" height="{int(image.get("height") or film.get("poster_height") or 900)}"'
        if not image or image.get('source') != url:
            return f'<img class="public-poster" src="{text(url)}" {dimensions} alt="{text(film["title"])}" loading="{"eager" if eager else "lazy"}" decoding="async">'
        variants = image['variants']
        fallback = next((v for v in variants if v['width'] >= 320), variants[-1])['url']
        srcset = ', '.join(f'{v["url"]} {v["width"]}w' for v in variants)
        attrs = f'{dimensions} style="aspect-ratio:{int(image["width"])}/{int(image["height"])}" alt="{text(film["title"])}" decoding="async"'
        # The first row starts from HTML at a small, data-saving size, then
        # the independent loader upgrades them for the viewport and connection.
        initial = variants[0] if eager else None
        source = initial['url'] if initial else image['preview']
        priority = f' loading="eager" fetchpriority="high" data-image-width="{initial["width"]}" data-image-preview="{text(image["preview"])}"' if initial else ''
        return (f'<img class="public-poster progressive-image{"" if initial else " is-preview"}" src="{text(source)}" {attrs}{priority} '
                f'data-image-source="{text(url)}" data-image-variants="{text(json.dumps(variants, separators=(",", ":")))}">'
                f'<noscript><style>.progressive-image{{display:none}}.film-facts>noscript{{display:contents}}</style><img class="public-poster" src="{text(fallback)}" '
                f'srcset="{text(srcset)}" sizes="(max-width:730px) 45vw, 280px" {attrs} loading="lazy"></noscript>')

    def cards(self, films, lang, *, eager=False):
        cards = []
        for position, film in enumerate(films):
            path = self.entity_path('films', film['id'], lang)
            first = min(film.get('sessions', []), key=lambda s: s['starts_at'], default=None)
            preview = f'<p>{stamp(first["starts_at"])} · {text(self.cinemas[first["cinema_id"]]["name"])}</p>' if first else ''
            cards.append(f'<article class="card" data-film="{text(film["id"])}"><a class="poster-button" href="{path}" data-open="{text(film["id"])}">{self.poster(film, eager=eager and position < 2)}</a><div class="card-body"><h2>{link(path, film["title"], f" data-open=\"{text(film['id'])}\"")}</h2>{preview}</div></article>')
        return '<div class="grid" id="grid">' + ''.join(cards) + '</div>'

    def session_table(self, pairs, lang, include_film=False, *, discovery=False):
        t, rows = COPY[lang], []
        for film, s in sorted(pairs, key=lambda p: p[1]['starts_at']):
            cinema = self.cinemas[s['cinema_id']]
            venue = link(self.entity_path('cinemas', s['cinema_id'], lang), cinema['name'])
            if include_film:
                venue = link(self.entity_path('films', film['id'], lang), film['title'])
                if discovery:
                    venue += '<p>' + link(self.entity_path('cinemas', s['cinema_id'], lang), cinema['name']) + '</p>'
            details = [(t['room'], s.get('room') or t['unknown']), (t['version'], s.get('version') or t['unknown']),
                       (t['audio'], language_name(s.get('language') or t['unknown'], lang)),
                       (t['subtitles'], language_name(s.get('subtitles') or t['unknown'], lang)),
                       (t['formats'], ', '.join(s.get('formats') or []) or t['unknown'])]
            facts = '<dl class="session-facts">' + ''.join(f'<dt>{text(k)}</dt><dd>{text(v)}</dd>' for k, v in details) + '</dl>'
            source = link(s.get('source_url'), t['source'])
            checked = stamp(s.get('schedule_fetched_at'))
            anchor = 'screening-' + hashlib.sha256(s['id'].encode()).hexdigest()[:16]
            context = f'{film["title"]} · {s["date"]} {s["time"]} · {cinema["name"]}'
            ticket_attrs = f' class="ticket-link" rel="noopener" data-ticket-film="{text(film["id"])}" data-ticket-screening="{text(s["id"])}" data-ticket-cinema="{text(s["cinema_id"])}" aria-label="{text(t["tickets"] + " · " + context)}"'
            action = link(self.entity_path('films', film['id'], lang) + '#' + anchor, t['select_screening'], f' class="screening-action"{"" if discovery else " hidden"} aria-label="{text(t["select_screening"] + " · " + context)}"')
            if discovery:
                rows.append(f'<li class="discovery-session" id="{anchor}" data-starts="{text(s["starts_at"])}" data-discovery-film="{text(film["id"])}"><div class="discovery-time">{stamp(s["starts_at"])}</div><div>{venue}{facts}<p class="source-note">{source} · {t["checked"]}: {checked}</p></div><div class="discovery-actions">{action}{link(s.get("booking_url"), t["tickets"], ticket_attrs)}</div></li>')
            else:
                rows.append(f'<tr id="{anchor}" data-starts="{text(s["starts_at"])}"><th scope="row">{stamp(s["starts_at"])}</th><td>{venue}{facts}<p class="source-note">{source} · {t["checked"]}: {checked}</p></td><td>{action}{link(s.get("booking_url"), t["tickets"], ticket_attrs)}</td></tr>')
        if not rows:
            return f'<p>{text(t["none"])}</p>'
        if discovery:
            return '<ol class="discovery-screenings">' + ''.join(rows) + '</ol>'
        return f'<div class="table-scroll"><table class="screenings"><thead><tr><th scope="col">{t["date"]}</th><th scope="col">{t["films"] if include_film else t["cinemas"]}</th><th scope="col">{t["tickets"]}</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>'

    def films(self):
        records = [(key, record) for key, record in self.registry['entities'].items() if record['kind'] == 'films']
        film_data = {key: self.film_data(key, record) for key, record in records}
        dialog_films = {}
        for entity_id, record in records:
            film = browser_programme({'films': [film_data[entity_id]]})['films'][0]
            film['urls'] = {lang: path_for(record, lang) for lang in LOCALES}
            for session in film['sessions']:
                session['url_fragment'] = 'screening-' + hashlib.sha256(session['id'].encode()).hexdigest()[:16]
            dialog_films[entity_id] = film
        dialog_cinemas = [{'id': venue['id'], 'name': venue['name'],
                          'urls': {lang: self.entity_path('cinemas', venue['id'], lang) for lang in LOCALES}}
                         for venue in self.cinemas.values()]
        rendered = subprocess.run(['node', str(ROOT / 'scripts/render_film_views.mjs')],
                                  input=json.dumps({'films': list(dialog_films.values()), 'cinemas': dialog_cinemas}),
                                  text=True, capture_output=True, check=True)
        views = json.loads(rendered.stdout)
        for entity_id, record in records:
            film = film_data[entity_id]
            year = film.get('release_year') or film.get('details', {}).get('release_year')
            display_title = film['title']
            if isinstance(year, int) and not re.search(r'\(' + str(year) + r'\)$', display_title):
                display_title += f' ({year})'
            alternatives = {l: path_for(record, l) for l in LOCALES}
            for lang in LOCALES:
                t, details = COPY[lang], film.get('details', {})
                poster = (self.poster(film, eager=True).replace('class="public-poster', 'class="dialog-poster')
                          .replace('.film-facts>noscript', '.film-sheet .dialog-head>noscript'))
                body = '<article class="film-sheet" id="filmPage" aria-labelledby="filmTitle">'
                notice = f'<p id="screeningNotice" role="status" tabindex="-1" hidden>{t["expired_screening"]}</p>'
                body += (views[film['id']][lang].replace('<!--film-poster-->', poster)
                         .replace('<div class="dialog-section" id="showtimes">', '<div class="dialog-section" id="showtimes">' + notice))
                body += '</article>'
                dialog_film = dialog_films[entity_id]
                cinemas = [venue for venue in dialog_cinemas if any(s['cinema_id'] == venue['id'] for s in film['sessions'])]
                payload = json.dumps({'film': dialog_film, 'cinemas': cinemas}, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
                body += f'<script type="application/json" id="film-dialog-data">{payload}</script>'
                # Expiration alone does not remove a useful film profile from search.
                substantive = bool(film['sessions'] or (details.get('directors') and (year or details.get('cast') or details.get('runtime_minutes'))))
                url = self.origin + alternatives[lang]
                movie = {'@type': 'Movie' if film.get('imdb_id') else 'CreativeWork', '@id': url + '#work', 'name': film['title'], 'url': url}
                if film.get('imdb_id'):
                    movie['sameAs'] = 'https://www.imdb.com/title/' + film['imdb_id'] + '/'
                if film.get('original_title'):
                    movie['alternateName'] = film['original_title']
                if details.get('directors'):
                    movie['director'] = [{'@type': 'Person', 'name': x} for x in details['directors']]
                if safe_url(film.get('poster_url')):
                    image = film['poster_url']
                    movie['image'] = self.origin + image if image.startswith('/') else image
                graph = [movie]
                # Label visible sessions without claiming Google event-rich-result eligibility.
                for s in film['sessions']:
                    anchor = 'screening-' + hashlib.sha256(s['id'].encode()).hexdigest()[:16]
                    event = {'@type': 'ScreeningEvent', '@id': url + '#' + anchor, 'name': film['title'],
                             'startDate': s['starts_at'], 'url': url + '#' + anchor, 'workPresented': {'@id': url + '#work'},
                             'location': {'@type': 'Place', 'name': self.cinemas[s['cinema_id']]['name'],
                                          'url': self.origin + self.entity_path('cinemas', s['cinema_id'], lang)}}
                    if s.get('formats'):
                        event['videoFormat'] = ', '.join(s['formats'])
                    if s.get('subtitles'):
                        event['subtitleLanguage'] = {'@type': 'Language', 'name': s['subtitles']}
                    graph.append(event)
                self.page(alternatives[lang], lang, t['film_title'].format(title=display_title) + ' | VO Barna', t['film_description'].format(title=display_title), body,
                          alternatives=alternatives, graph=graph, index=substantive, film_page=True, crumbs=[(t['films'], f'/{lang}/{SECTIONS[lang]["films"]}/')])

    def programme_listing(self, lang, *, cinema_id='', date=None):
        """Paint the full listing before the search catalogue or JavaScript arrives."""
        t = COPY[lang]
        view = self.listing_views[lang + ':' + ('date:' + date if date else cinema_id)]
        filters = f'''<section class="filters" aria-label="{t['films']}"><nav class="dates" id="dates" aria-label="{t['screening_dates']}">{view['dates']}</nav><div class="filter-row"><label class="search"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4.5 4.5"></path></svg><span class="sr-only" data-i18n="search">{text(view['search'])}</span><input type="search" id="search" maxlength="500" autocomplete="off" placeholder="{text(view['placeholder'])}" aria-label="{text(view['search'])}"></label><button type="button" id="clearFilters" class="clear-button" data-i18n="reset" hidden>{t['reset']}</button></div><div id="filterChips" class="filter-chips" hidden></div><p id="linkNotice" class="link-notice" role="status" hidden></p></section>'''
        cards = []
        for position, card in enumerate(view['cards']):
            film = self.current[card['id']]
            path = self.entity_path('films', film['id'], lang)
            poster = self.poster(film, eager=position < 4).replace('class="public-poster', 'class="poster')
            if not film.get('poster_url'):
                poster = f'<div class="poster-placeholder">{text(film["title"])}</div>'
            cards.append(f'<article class="card" data-film="{text(film["id"])}" data-open="{text(film["id"])}"><a class="poster-button" href="{path}" data-open="{text(film["id"])}" aria-label="{text(film["title"])}">{poster}</a><div class="card-body">{card["body"]}</div></article>')
        content = ''.join(cards) if cards else f'<div class="empty"><p>{t["none"]}</p></div>'
        grid = f'<div class="grid" id="grid" data-listing-as-of="{text(self.now.isoformat())}" data-programme-generated="{text(self.data["generated_at"])}">{content}</div>'
        return f'{filters}<section id="results" tabindex="-1"><p id="resultCount" class="sr-only" role="status" aria-atomic="true">{view["total"]} {t["films"].lower()}</p>{grid}</section>'

    def venue_pages(self):
        dossiers = self.research['dossiers']
        room_sources = self.research['rooms'].get('sources', {})
        if isinstance(room_sources, list):
            room_sources = {s['id']: s for s in room_sources}
        for record in self.registry['entities'].values():
            if record['kind'] != 'cinemas':
                continue
            cinema = record['cinema']
            cid = cinema['id']
            rooms = [r for r in self.research['rooms'].get('rooms', []) if r['cinema_id'] == cid and not str(r.get('room', '')).startswith('unmapped')]
            location = cinema.get('location', {})
            alternatives = {l: path_for(record, l) for l in LOCALES}
            for lang in LOCALES:
                t, v = COPY[lang], VENUE_COPY[lang]
                address = location.get('formatted_address') or cinema.get('address')
                maps = location.get('google_maps_place_url') or location.get('google_maps_url')
                official = cinema.get('official_url') or cinema.get('url')
                body = f'<div class="venue-heading"><div><h1>{text(cinema["name"])}</h1>'
                if address:
                    short_address = address
                    if ',' in address and address.casefold().startswith(cinema['name'].casefold()):
                        short_address = address.split(',', 1)[1].strip()
                    short_address = re.sub(r'\b\d{5}\s*', '', short_address)
                    body += f'<p class="venue-address"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>{link(maps, short_address)}</p>'
                body += '</div><div class="venue-actions">'
                if safe_url(maps):
                    body += link(maps, v['directions'], ' class="venue-action venue-action-primary"')
                if safe_url(official):
                    body += link(official, v['website'], ' class="venue-action"')
                body += '</div></div>'
                body += self.programme_listing(lang, cinema_id=cid)
                if cinema.get('programme_url'):
                    body += f'<p class="venue-programme-link">{link(cinema["programme_url"], t["current"])}</p>'
                body += f'<section class="venue-information" aria-label="{v["visit"]}"><h2>{v["visit"]}</h2>'
                if rooms:
                    body += f'<details class="venue-disclosure"><summary>{t["rooms"]}<span class="venue-room-count">{len(rooms)}</span></summary><div class="venue-disclosure-body"><p>{text(t["size_note"])}</p>'
                    for room in rooms:
                        rid = str(room.get('room') or '')
                        if not rid or not re.fullmatch(r'[A-Za-z0-9 -]+', rid):
                            continue
                        screen = room.get('screen') or {}
                        width, height = screen.get('width_m'), screen.get('height_m')
                        body += f'<article class="room" id="sala-{text(rid.lower().replace(" ", "-"))}"><h3>{t["room"]} {text(rid)}</h3><dl class="facts">'
                        if width and height:
                            approx = '≈ ' if screen.get('height_approximate') or screen.get('width_approximate') or 'infer' in str(screen.get('orientation', '')).lower() else ''
                            body += f'<dt>{t["screen"]}</dt><dd>{approx}{text(width)} × {text(height)} m {self.citations(screen.get("source_ids"), room_sources, lang)}</dd>'
                        for cap in (room.get('capacity') or {}).get('published', []):
                            body += f'<dt>{t["capacity"]}</dt><dd>{text(cap.get("value"))} {self.citations(cap.get("source_ids"), room_sources, lang)}'
                            if cap.get('meaning'):
                                body += f'<small>{self.research_text(cap["meaning"], lang)}</small>'
                            body += '</dd>'
                        body += '</dl>'
                        for key in ('projection', 'sound'):
                            items = room.get(key) or []
                            if items:
                                body += f'<h4>{t[key]}</h4><ul>' + ''.join(f'<li>{self.research_text(item.get("value", ""), lang)} {self.citations(item.get("source_ids"), room_sources, lang)}</li>' for item in items) + '</ul>'
                        if room.get('notes'):
                            body += f'<details><summary>{t["notes"]}</summary><ul>' + ''.join('<li>' + self.research_text(n, lang) + '</li>' for n in room['notes']) + '</ul></details>'
                        body += '</article>'
                    body += '</div></details>'
                for key, label in [('access_and_parking', 'access'), ('published_policies', 'practical')]:
                    if cinema.get(key):
                        heading = v['policies'] if key == 'published_policies' else t[label]
                        body += f'<details class="venue-disclosure"><summary>{heading}</summary><div class="venue-disclosure-body"><ul>' + ''.join(f'<li>{self.research_text(x.get("value", ""), lang)} {self.citations(x.get("source_ids"), dossiers.get("sources", {}), lang)}</li>' for x in cinema[key]) + '</ul></div></details>'
                practical = self.research.get('practical', {})
                facts = [f for f in practical.get('facts', []) if cid in f.get('cinema_ids', [])]
                prices = [p for p in practical.get('prices', []) if cid in p.get('cinema_ids', [])]
                if facts or prices:
                    body += f'<details class="venue-disclosure"><summary>{t["practical"]}</summary><div class="venue-disclosure-body"><ul>'
                    for fact in facts:
                        body += f'<li>{self.research_text(fact.get("value", ""), lang)} {self.research_text(fact.get("scope", ""), lang)} {self.citations(fact.get("source_ids"), practical.get("sources", {}), lang)} <small>{text(fact.get("observed_on", ""))}</small></li>'
                    for price in prices:
                        body += f'<li>{t["price"]}: {text(price.get("amount", t["unknown"]))} {text(price.get("currency", ""))} {self.research_text(price.get("label", ""), lang)}. {self.research_text(price.get("condition", ""), lang)} {self.citations(price.get("source_ids"), practical.get("sources", {}), lang)} <small>{text(price.get("observed_on", ""))}</small></li>'
                    body += f'</ul><p class="fineprint">{text(t["price_note"])}</p></div></details>'
                body += f'<details class="venue-disclosure"><summary>{t["sources"]}</summary><div class="venue-disclosure-body"><p>{text(t["venue_description"].format(name=cinema["name"]))}</p>'
                if address:
                    body += f'<p>{t["address"]}: {text(address)}</p>'
                body += self.citations(location.get('source_ids'), dossiers.get('sources', {}), lang)
                body += f'<p>{t["research"]}: <time>{text(dossiers.get("researched_on"))}</time></p><p>{text(t["coverage"])}</p><p>{text(t["stale"])}</p>'
                body += f'<p>{text(t["regional"])}</p>' if cid not in {c['id'] for c in self.data['cinemas']} else ''
                body += self.session_table(self.by_cinema.get(cid, []), lang, include_film=True)
                if cinema.get('technical_caveats'):
                    body += f'<details><summary>{t["notes"]}</summary><ul>' + ''.join('<li>' + self.research_text(x, lang) + '</li>' for x in cinema['technical_caveats']) + '</ul></details>'
                body += '</div></details></section>'
                venue_type = 'Place' if cinema.get('category') == 'cultural_screening_venue' or cid == 'ateneu-barcelones' else 'MovieTheater'
                graph = [{'@type': venue_type, '@id': self.origin + alternatives[lang] + '#venue', 'name': cinema['name'], 'url': self.origin + alternatives[lang]}]
                if address:
                    graph[0]['address'] = address
                if location.get('latitude') is not None and location.get('longitude') is not None:
                    graph[0]['geo'] = {'@type': 'GeoCoordinates', 'latitude': location['latitude'], 'longitude': location['longitude']}
                self.page(alternatives[lang], lang, cinema['name'] + ' | VO Barna', t['venue_description'].format(name=cinema['name']), body,
                          alternatives=alternatives, graph=graph, venue=True, interactive=True, cinema_id=cid, crumbs=[(t['cinemas'], f'/{lang}/{SECTIONS[lang]["cinemas"]}/')])

    def indexes(self):
        films = [self.film_data(k, r) for k, r in self.registry['entities'].items() if r['kind'] == 'films']
        films.sort(key=lambda f: (not bool(f['sessions']), f['title'].casefold()))
        venues = sorted([r for r in self.registry['entities'].values() if r['kind'] == 'cinemas'], key=lambda r: r['cinema']['name'].casefold())
        programme_pages = paginate_programme(self.browser_programme, self.now, language_name=language_name)
        for lang in LOCALES:
            t = COPY[lang]
            body = f'<h1 class="sr-only">{t["home"]}</h1>' + self.programme_listing(lang)
            body += render_programme_directory(programme_pages, lang)
            footer_extra = f'<p class="site-intro">{text(t["intro"])}</p><p id="staticPagination">{link(f"/{lang}/{SECTIONS[lang]["films"]}/", t["more"])}</p><p class="fineprint">{t["coverage"]} {t["checked"]}: {stamp(self.data["generated_at"])}</p>'
            self.page(f'/{lang}/', lang, t['home'] + ' | VO Barna', t['intro'], body, alternatives={l: f'/{l}/' for l in LOCALES}, interactive=True,
                      footer_extra=footer_extra,
                      graph=[{'@type': 'WebSite', '@id': self.origin + '/#website', 'name': 'VO Barna', 'description': t['intro'], 'url': self.origin + '/', 'inLanguage': list(LOCALES), 'publisher': {'@id': self.origin + '/#publisher'}}])
            for number, programme_page in enumerate(programme_pages, 1):
                title = f'{PROGRAMME_LABELS[lang][0]} · {t["page"]} {number}'
                alternatives = {l: programme_path(l, number) for l in LOCALES}
                pagination = '<nav class="pagination" aria-label="' + text(PROGRAMME_LABELS[lang][0]) + '">'
                for target, label in [(number - 1, t['previous']), (number + 1, t['next'])]:
                    if 1 <= target <= len(programme_pages):
                        pagination += link(programme_path(lang, target), label)
                pagination += '</nav>'
                description = f'{PROGRAMME_LABELS[lang][1]} {t["page"]} {number}/{len(programme_pages)}.'
                body = f'<h1>{text(title)}</h1>' + pagination + programme_page['html'][lang] + pagination
                self.page(alternatives[lang], lang, title + ' | VO Barna', description, body, alternatives=alternatives)
            pages = max(1, math.ceil(len(films) / PAGE_SIZE))
            for page in range(1, pages + 1):
                suffix = '' if page == 1 else f'page/{page}/'
                alternatives = {l: f'/{l}/{SECTIONS[l]["films"]}/' + suffix for l in LOCALES}
                body = f'<h1>{t["films"]} · {t["page"]} {page}</h1>' + self.cards(films[(page-1)*PAGE_SIZE:page*PAGE_SIZE], lang)
                body += '<nav class="pagination">'
                for number, label in [(page-1, t['previous']), (page+1, t['next'])]:
                    if 1 <= number <= pages:
                        body += link(f'/{lang}/{SECTIONS[lang]["films"]}/' + ('' if number == 1 else f'page/{number}/'), label)
                body += '</nav>'
                self.page(alternatives[lang], lang, f'{t["films"]} · {t["page"]} {page} | VO Barna', t['film_index_description'].format(page=page, pages=pages), body, alternatives=alternatives)
            paths = {l: f'/{l}/{SECTIONS[l]["cinemas"]}/' for l in LOCALES}
            search = f'''<div id="cinemaFilters" class="directory-filters" role="search" aria-label="{t['cinema_search']}" hidden><div class="filter-row"><label class="search"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4.5 4.5"></path></svg><span class="sr-only">{t['cinema_search']}</span><input type="search" id="cinemaSearch" placeholder="{t['cinema_placeholder']}" maxlength="500" autocomplete="off" aria-controls="cinemaList"></label><button type="button" id="cinemaReset" hidden>{t['reset']}</button></div></div>'''
            rows = []
            for record in venues:
                cinema = record['cinema']
                address = cinema.get('location', {}).get('formatted_address') or cinema.get('area') or ''
                rows.append(f'<li data-search="{text(cinema.get("area", ""))}">' + link(path_for(record, lang), cinema['name']) + (f'<p class="venue-list-address">{text(address)}</p>' if address else '') + '</li>')
            body = f'<h1>{t["directory"]}</h1><p>{t["regional"]}</p>{search}<p id="cinemaCount" class="sr-only" role="status" aria-atomic="true"></p><p id="cinemaEmpty" hidden>{t["cinema_empty"]}</p><ul class="venue-list" id="cinemaList">' + ''.join(rows) + '</ul>'
            self.page(paths[lang], lang, t['directory'] + ' | VO Barna', t['regional'], body, alternatives=paths)

    def editorial(self):
        for lang in LOCALES:
            t = COPY[lang]
            links = []
            for key, prefix in [('versions', 'version'), ('formats', 'format')]:
                paths = {l: f'/{l}/{SECTIONS[l]["guides"]}/{GUIDES[key][l]}/' for l in LOCALES}
                body = f'<h1>{t[prefix+"_title"]}</h1><p class="editorial">{t[prefix+"_body"]}</p><p>{link(f"/{lang}/{SECTIONS[lang]["cinemas"]}/", t["cinemas"])} · {link(f"/{lang}/", t["current"])}</p>'
                if key == 'formats':
                    body += self.room_comparison(lang)
                else:
                    body += self.version_explanation(lang)
                self.page(paths[lang], lang, t[prefix+'_title'] + ' | VO Barna', t[prefix+'_body'][:220], body, alternatives=paths)
                links.append('<li>' + link(paths[lang], t[prefix+'_title']) + '</li>')
            links.extend('<li>' + link(paths[lang], DISCOVERY_COPY[lang][key]) + '</li>'
                         for key, paths in DISCOVERY_PATHS.items() if key not in ('english', 'weekend'))
            paths = {l: f'/{l}/{SECTIONS[l]["guides"]}/' for l in LOCALES}
            self.page(paths[lang], lang, t['guides'] + ' | VO Barna', t['guide_index_description'], f'<h1>{t["guides"]}</h1><ul>{"".join(links)}</ul>', alternatives=paths)
            paths = {l: f'/{l}/{SECTIONS[l]["about"]}/' for l in LOCALES}
            body = f'<h1>{t["about"]}</h1><p class="site-intro">{text(t["intro"])}</p><p>{t["independent"]}</p><h2>{t["publisher"]}</h2><p>{text(t["publisher_text"].format(name=PUBLISHER["name"]))}</p><h2>{t["method_title"]}</h2><p class="editorial">{t["method"]}</p><h2>{t["corrections"]}</h2><p>{t["contact_text"]} <a href="mailto:{text(PUBLISHER["email"])}">{text(PUBLISHER["email"])}</a>.</p><p>{t["correction_text"]}</p>'
            body += f'<h2>{t["analytics_title"]}</h2><p>{text(t["analytics_body"])}</p>'
            self.page(paths[lang], lang, t['about'], t['intro'], body, alternatives=paths)
        self.page('/404.html', 'en', COPY['en']['notfound'], COPY['en']['notfound_text'], f'<h1>{COPY["en"]["notfound"]}</h1><p>{COPY["en"]["notfound_text"]}</p>', index=False)

    def version_explanation(self, lang):
        t, d = COPY[lang], DISCOVERY_COPY[lang]
        rows = ''.join(f'<tr><th scope="row">{label}</th><td>{text(d["version_audio"])}</td><td>{text(d[sub])}</td></tr>'
                       for label, sub in [('VO', 'version_unknown'), ('VOSE', 'spanish'), ('VOSC', 'catalan'), ('VOSI', 'english_language')])
        return (f'<section class="editorial"><h2>{text(d["version_question"])}</h2><p>{text(d["version_answer"])}</p>'
                f'<div class="table-scroll"><table class="screenings"><thead><tr><th scope="col">{t["version"]}</th><th scope="col">{t["audio"]}</th><th scope="col">{t["subtitles"]}</th></tr></thead><tbody>{rows}</tbody></table></div><p>{text(d["examples"])}</p></section>')

    def discovery_pages(self):
        today = self.now.astimezone(MADRID).date()
        weekend = weekend_dates(self.now)
        dates = dict(zip(('friday', 'saturday', 'sunday'), weekend))
        values = dict(date=today.isoformat(), end=(today + timedelta(days=6)).isoformat(),
                      friday=weekend[0].isoformat(), sunday=weekend[-1].isoformat())
        for kind, paths in DISCOVERY_PATHS.items():
            groups = select_sessions(self.data, kind, self.now)
            pairs = [pair for values in groups.values() for pair in values]
            for lang in LOCALES:
                d = DISCOVERY_COPY[lang]
                intro = d[kind + '_intro'].format(**values)
                description = d.get(kind + '_description', d[kind + '_intro']).format(**values)
                dated_title = d[kind] + (f' · {weekend[0]}–{weekend[-1]}' if kind == 'weekend' else '')
                body = f'<h1>{text(dated_title)}</h1><p class="editorial">{text(intro)}</p>'
                if kind == 'discounts':
                    body += self.discount_offers(lang)
                    body += f'<h2 id="discount-programme">{text(d["discount-screenings"])}</h2><p class="editorial">{text(d["discount-screenings_note"])}</p>'
                body += f'<p class="freshness">{text(d["snapshot"])}: {stamp(self.data["generated_at"])}</p>'
                if kind in ('weekend', 'film', 'imax', 'gracia', 'classics', 'eixample'):
                    jumps = [(group, d.get(group + '_group', d.get(group))) for group, selected in groups.items()
                             if selected or kind == 'weekend' or group in ('35mm', '70mm')]
                    jumps.append(('guide-information', d['guide_information']))
                    body += f'<nav class="discovery-sections" aria-label="{text(d["on_this_page"])}"><ul>' + ''.join(
                        '<li>' + link(paths[lang] + '#' + anchor, label) + '</li>' for anchor, label in jumps) + '</ul></nav>'
                count = d['count'].format(films=len({f['id'] for f, _ in pairs}), sessions=len(pairs))
                body += f'<div class="discovery" data-discovery-kind="{kind}" data-discovery-date="{today}" data-count-template="{text(d["count"])}">'
                body += f'<p class="discovery-stale" role="status" hidden>{text(d["stale"].format(date=today))} <button type="button" class="discovery-reload">{text(d["reload"])}</button></p>'
                body += f'<div class="discovery-results"><p class="discovery-count" role="status" aria-atomic="true">{text(count)}</p><p class="discovery-empty"{" hidden" if pairs else ""}>{text(d.get(kind + "_none", d["none"]))}</p>'
                for group, selected in groups.items():
                    keep_empty = kind == 'weekend' or group in ('35mm', '70mm')
                    if not selected and not keep_empty:
                        continue
                    heading = d.get(group + '_group', d.get(group))
                    if kind == 'weekend':
                        heading += f' · {dates[group]}'
                    body += f'<section class="discovery-group" id="{group}"' + (' aria-labelledby="discount-programme">' if kind == 'discounts' else f'><h2>{text(heading)}</h2>')
                    if keep_empty:
                        body += f'<p class="discovery-group-empty"{" hidden" if selected else ""}>{text(d["day_none" if kind == "weekend" else "format_none"])}</p>'
                    if group + '_note' in d and kind != 'discounts':
                        body += f'<p class="editorial">{text(d[group + "_note"])}</p>'
                    if kind == 'classics':
                        ids = [repertory_match(f, s)[2] for f, s in selected]
                        body += '<p class="source-note">' + self.citations(ids, COLLECTION_SOURCES, lang) + '</p>'
                    if kind in ('english', 'weekend', 'imax', 'vosc', 'gracia', 'classics', 'eixample', 'discounts'):
                        # Group by film so a long programme is navigable and each
                        # title is one recommendation, with its exact sessions inside.
                        films = {}
                        for film, session in selected:
                            films.setdefault(film['id'], []).append((film, session))
                        for film_pairs in films.values():
                            film = film_pairs[0][0]
                            title = film['title']
                            if kind == 'classics':
                                year = repertory_match(film, film_pairs[0][1])[0]
                                if not re.search(r'\(' + str(year) + r'\)$', title):
                                    title += f' ({year})'
                            body += f'<article class="discovery-film"><h3>{link(self.entity_path("films", film["id"], lang), title)}</h3><details><summary>{text(d["show_sessions"])} <span class="discovery-film-count">({len(film_pairs)})</span></summary>{self.session_table(film_pairs, lang, discovery=True)}</details></article>'
                    elif selected:
                        body += self.session_table(selected, lang, include_film=True, discovery=True)
                    body += '</section>'
                body += '</div></div><script type="module" src="/discovery-page.js"></script>'
                if kind in ('subtitles', 'vosc'):
                    body += self.version_explanation(lang)
                    topic = 'vosc' if kind == 'vosc' else 'subtitle'
                    body += f'<section class="editorial"><h2>{text(d[topic + "_question"])}</h2><p>{text(d[topic + "_answer"])}</p></section>'
                if kind == 'gracia':
                    body += '<div id="guide-information">' + self.gracia_guide(lang) + '</div>'
                if kind in ('classics', 'eixample'):
                    body += '<div id="guide-information">' + self.collection_guide(kind, lang) + '</div>'
                if kind in DISCOVERY_SECTIONS:
                    body += '<div id="guide-information">' + self.discovery_explanation(kind, lang) + '</div>'
                body += f'<section class="editorial"><h2>{text(d["booking_question"])}</h2><p>{text(d["booking_answer"])}</p><h2>{text(d["method_title"])}</h2><p>{text(d.get(kind + "_method", d["method"]))}</p></section>'
                graph = [{'@type': 'ItemList', '@id': self.origin + paths[lang] + '#screenings',
                          'numberOfItems': len(pairs), 'itemListElement': [
                              {'@type': 'ListItem', 'position': i + 1, 'url': self.origin + self.entity_path('films', film['id'], lang) + '#screening-' + hashlib.sha256(s['id'].encode()).hexdigest()[:16],
                               'name': film['title'] + ' · ' + s['date'] + ' ' + s['time'] + ' · ' + self.cinemas[s['cinema_id']]['name']}
                              for i, (film, s) in enumerate(pairs)]}]
                self.page(paths[lang], lang, dated_title + ' | VO Barna', description, body,
                          alternatives=paths, graph=graph, crumbs=[(d[kind], paths[lang])])

    def discovery_explanation(self, kind, lang):
        d = DISCOVERY_COPY[lang]
        sources = self.research['rooms'].get('sources', {})
        if isinstance(sources, list):
            sources = {s['id']: s for s in sources}
        sources = {**sources, **DISCOVERY_SOURCES}
        rooms = {r['id'] for r in self.research['rooms'].get('rooms', [])}
        sections = []
        for key, ids, venue in DISCOVERY_SECTIONS.get(kind, []):
            # A venue claim is published only with its reviewed supporting record.
            if venue and (venue[0] not in self.cinemas or f'{venue[0]}:{venue[1]}' not in rooms):
                continue
            if any(not safe_url(sources.get(sid, {}).get('url')) for sid in ids):
                continue
            body = f'<section class="editorial"><h2>{text(d[key + "_title"])}</h2><p>{text(d[key + "_body"])}</p>'
            if ids:
                body += '<p class="source-note">' + self.citations(ids, sources, lang) + '</p>'
            if venue:
                cid, room = venue
                body += '<p>' + link(self.entity_path('cinemas', cid, lang) + '#sala-' + room,
                                    self.cinemas[cid]['name'] + ' · ' + COPY[lang]['room'] + ' ' + room) + '</p>'
            sections.append(body + '</section>')
        return ''.join(sections)

    def collection_guide(self, kind, lang):
        d = DISCOVERY_COPY[lang]
        body = ''
        if kind == 'eixample':
            body += f'<section class="editorial"><h2>{text(d["eixample_venues"])}</h2><p>{text(d["eixample_places"])}</p>'
            for cid, (area, address, sid) in EIXAMPLE_VENUES.items():
                if cid not in self.cinemas:
                    continue
                body += f'<article><h3>{link(self.entity_path("cinemas", cid, lang), d[area])}</h3><p>{text(address)}</p><p class="source-note">{self.citations([sid], COLLECTION_SOURCES, lang)}</p></article>'
            body += f'<p>{text(d["eixample_aribau"])}</p><p class="source-note">{self.citations(["aribau-rooms"], COLLECTION_SOURCES, lang)}</p></section>'
            related = ('gracia', 'classics', 'discounts', 'english')
        else:
            for prefix in ('classics_edition', 'classics_plan'):
                body += f'<section class="editorial"><h2>{text(d[prefix + "_title"])}</h2><p>{text(d[prefix + "_body"])}</p></section>'
            related = ('film', 'eixample', 'discounts')
        return body + '<ul>' + ''.join('<li>' + link(DISCOVERY_PATHS[k][lang], d[k]) + '</li>' for k in related) + '</ul>'

    def discount_offers(self, lang):
        d = DISCOVERY_COPY[lang]
        body = f'<p class="freshness">{text(d["offers_reviewed"])}: <time datetime="{REVIEWED_ON}">{REVIEWED_ON}</time></p><div class="comparison-rooms discount-offers">'
        for key, venues, source, amount in OFFERS:
            price = ('€' + amount if lang == 'en' else amount.replace('.', ',') + ' €') if amount else d[key + '_price']
            cinemas = [cid for cid in venues if cid in self.cinemas]
            body += f'<article class="comparison-room discount-offer" id="{key}"><h2>{text(d[key])}</h2><dl><dt>{text(d["published_price"])}</dt><dd>{text(price)}</dd><dt>{text(d["offer_conditions"])}</dt><dd>{text(d[key + "_body"])}</dd></dl><p class="source-note">{self.citations([source], COLLECTION_SOURCES, lang)}</p>'
            if cinemas:
                body += '<details><summary>' + text(d['venue_programme']) + '</summary><ul>' + ''.join('<li>' + link(self.entity_path('cinemas', cid, lang), self.cinemas[cid]['name']) + '</li>' for cid in cinemas) + '</ul></details>'
            body += '</article>'
        body += '</div><p class="editorial">' + text(d['mooby_fees']) + ' ' + self.citations(['mooby-prices'], COLLECTION_SOURCES, lang) + '</p>'
        for key in ('memberships', 'price_check'):
            body += f'<section class="editorial"><h2>{text(d[key + "_title"])}</h2><p>{text(d[key + "_body"])}</p>'
            if key == 'memberships':
                body += '<p class="source-note">' + self.citations(['verdi-prices', 'renoir-prices'], COLLECTION_SOURCES, lang) + '</p>'
            body += '</section>'
        return body

    def gracia_guide(self, lang):
        d = DISCOVERY_COPY[lang]
        body = f'<section class="editorial"><h2>{text(d["gracia_venues"])}</h2>'
        for cid, sid in GRACIA_VENUES.items():
            if cid not in self.cinemas:
                continue
            body += f'<article><h3>{link(self.entity_path("cinemas", cid, lang), self.cinemas[cid]["name"])}</h3><p>{text(d[cid + "_note"])}</p><p class="source-note">{self.citations([sid], LOCAL_SOURCES, lang)}</p></article>'
        body += f'</section><section class="editorial"><h2>{text(d["gracia_seats_title"])}</h2><p>{text(d["gracia_seats_body"])}</p></section>'
        body += '<p>' + link(DISCOVERY_PATHS['vosc'][lang], d['vosc']) + ' · ' + link(DISCOVERY_PATHS['english'][lang], d['english']) + '</p>'
        return body

    def room_comparison(self, lang):
        t, d = COPY[lang], DISCOVERY_COPY[lang]
        sources = self.research['rooms'].get('sources', {})
        if isinstance(sources, list):
            sources = {s['id']: s for s in sources}
        selected = {'phenomena:1', 'mooby-balmes:9', 'cinesa-diagonal-mar:9', 'cinesa-diagonal-mar:10',
                    'kinepolis-splau:18', 'cinesa-parc-valles:imax'}
        cards, navigation = [], []
        for room in self.research['rooms'].get('rooms', []):
            if room['id'] not in selected or room['cinema_id'] not in self.cinemas:
                continue
            cid, rid = room['cinema_id'], str(room['room'])
            url = self.entity_path('cinemas', cid, lang) + '#sala-' + rid.lower().replace(' ', '-')
            label = self.cinemas[cid]['name'] + ' · ' + t['room'] + ' ' + rid
            if cid == 'kinepolis-splau':
                label += ' · Cornellà de Llobregat'
            elif cid == 'cinesa-parc-valles':
                label += ' · Terrassa'
            brand = next((i['value'] for i in room.get('features', []) if i['value'] in ('IMAX', 'iSense')), None)
            if brand:
                label += ' · ' + brand
            anchor = 'compare-' + cid + '-' + rid.lower()
            path = f'/{lang}/{SECTIONS[lang]["guides"]}/{GUIDES["formats"][lang]}/'
            navigation.append('<li>' + link(path + '#' + anchor, label) + '</li>')
            screen = room.get('screen') or {}
            dimensions = text(t['unknown'])
            if screen.get('width_m') and screen.get('height_m'):
                if 'inferred' in screen.get('orientation', ''):
                    # Preserve the source order, rather than presenting inferred axes as measurements.
                    dimensions = text(d['screen_raw'].format(dimensions=screen.get('raw_dimensions', t['unknown'])))
                else:
                    height = ('≈' if screen.get('height_approximate') else '') + str(screen['height_m'])
                    dimensions = text(d['screen_explicit'].format(width=screen['width_m'], height=height))
                dimensions += ' ' + self.citations(screen.get('source_ids'), sources, lang)
            facts = [(t['screen'], dimensions)]
            for key, limit in [('projection', 2), ('sound', 1), ('seating', 1)]:
                items = (room.get(key) or [])[:limit]
                value = '<ul>' + ''.join('<li>' + self.research_text(i['value'], lang) + ' ' + self.citations(i.get('source_ids'), sources, lang) + '</li>' for i in items) + '</ul>' if items else text(t['unknown'])
                if key == 'seating' and cid == 'phenomena':
                    practical = self.research.get('practical', {})
                    policy = next((f for f in practical.get('facts', []) if f['id'] == 'phenomena-seating'), None)
                    if policy:
                        value = self.research_text(policy['value'], lang) + ' ' + self.citations(policy['source_ids'], practical.get('sources', {}), lang)
                facts.append((d['seating'] if key == 'seating' else t[key], value))
            cards.append(f'<article class="comparison-room" id="{text(anchor)}"><h3>{text(label)}</h3><dl>' + ''.join(f'<dt>{text(k)}</dt><dd>{v}</dd>' for k, v in facts) + f'</dl><p>{link(url, d["comparison_more"])}</p></article>')
        if not cards:
            return ''
        body = f'<section><h2>{text(d["comparison_title"])}</h2><p class="editorial">{text(d["comparison_intro"])}</p><p class="editorial">{text(t["size_note"])}</p>'
        body += f'<nav class="discovery-sections" aria-label="{text(d["on_this_page"])}"><ul>{"".join(navigation)}</ul></nav><div class="comparison-rooms">{"".join(cards)}</div></section>'
        for key in ('comparison_size', 'comparison_seats'):
            body += f'<section class="editorial"><h2>{text(d[key + "_title"])}</h2><p>{text(d[key + "_body"])}</p></section>'
        body += '<ul>' + ''.join('<li>' + link(DISCOVERY_PATHS[key][lang], d[key]) + '</li>' for key in ('imax', 'film', 'english')) + '</ul>'
        return body


def compact_programme(programme, registry, now):
    result = browser_programme(programme, now)
    for value in result['films']:
        record = resolve(registry, 'films', value['id'])
        value['urls'] = {l: path_for(record, l) for l in LOCALES}
        for session in value['sessions']:
            # Store the suffix once instead of repeating three complete film URLs.
            session['anchor'] = '#screening-' + hashlib.sha256(session['id'].encode()).hexdigest()[:16]
    for cinema in result['cinemas']:
        record = resolve(registry, 'cinemas', cinema['id'])
        cinema['urls'] = {l: path_for(record, l) for l in LOCALES}
    return result


def build(*, programme_path=ROOT / 'static/preview-data/screenings.json', output=PUBLIC,
          registry_path=ROOT / 'data/site-registry.json', docs=ROOT / 'docs', now=None, origin=ORIGIN):
    now = now or datetime.now(timezone.utc)
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('Canonical origin must be an HTTPS origin without path, query or credentials')
    origin = origin.rstrip('/')
    output, registry_path = Path(output), Path(registry_path)
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'build.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        programme = read_json(programme_path)
        validate_programme(programme)
        prepare_images(programme['films'])
        optimize_logo()
        optimize_mascot_animation()
        research = {'dossiers': read_json(docs / 'cinema-dossiers.json'), 'rooms': read_json(docs / 'auditoriums.json'),
                    'practical': read_json(docs / 'cinema-practical-info.json', {})}
        venues = {v['id']: v for v in programme['cinemas']}
        venues.update({v['id']: {**venues.get(v['id'], {}), **v} for v in research['dossiers']['cinemas']})
        previous = read_json(output / 'current/manifest.json', {})
        checkpoint = os.environ.get('INDEXNOW_STATE_DIR')
        if not previous and checkpoint:
            published = read_json(Path(checkpoint) / 'published-pages.json', {})
            if published.get('origin') == origin:
                previous = published
        registry = read_json(output / 'current/registry.json', read_json(registry_path, new_registry()))
        registry = update_registry(registry, programme, list(venues.values()), now.isoformat(), read_json(ROOT / 'data/site-slug-overrides.json', {}))
        prepare_images([record['film'] for record in registry['entities'].values() if record['kind'] == 'films'])
        releases = output / 'releases'
        releases.mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix='build-', dir=releases))
        dest = stage / 'public'
        dest.mkdir()
        try:
            site = Publication(dest, programme, registry, research, previous, now, origin)
            site.indexes()
            site.films()
            site.venue_pages()
            site.editorial()
            site.discovery_pages()
            date_views = build_date_views(site, language_name)
            # Explicit public assets; collectors, raw research and legacy checkout are not shipped.
            for name in ('theme.js', 'theme.css', 'cinemas.css', 'cinemas.js', 'cinema-search.js', 'search-intent.js', 'smart-search-ui.js', 'search-dates.js', 'cinema-service.js', 'webmcp.js', 'webmcp-registration.js', 'webmcp-sdk.js', 'webmcp-sdk.LICENSE.txt',
                         'site-header.js', 'complete-programme.js', 'clint-idle.webp', 'barcelona-mascot-point-right-brow-refined.webp', 'barcelona-mascot-poke.webp',
                         'listing-view.js', 'site.css', 'site-page.js', 'discovery-page.js', 'today-links.js', 'cinema-copy.js', 'film-dialog.js', 'film-view.js', 'film-page.js', 'cinema-directory.js', 'ticket-events.js', 'analytics.js', 'progressive-images.js', 'programme-data.js', 'programme-cache.js', 'clint.png', 'clint-logo.webp', 'favicon.svg', 'paper-grain.svg', 'barcelona-cinema-background.svg', 'barcelona-cinema-background.webp',
                         'webmcp-guide.css', 'webmcp-tools.json'):
                shutil.copy2(ROOT / 'static' / name, dest / name)
            guide = (ROOT / 'static/webmcp.html').read_text().replace('/cinemas.html', '/en/')
            guide = guide.replace('</head>', f'<link rel="canonical" href="{origin}/webmcp/"><script type="module" src="/analytics.js"></script></head>')
            guide_path = dest / 'webmcp/index.html'
            guide_path.parent.mkdir(parents=True, exist_ok=True)
            guide_path.write_text(guide)
            digest = hashlib.sha256(guide.encode()).hexdigest()
            old = previous.get('pages', {}).get('/webmcp/', {})
            site.pages['/webmcp/'] = {'hash': digest, 'lastmod': old.get('lastmod') if old.get('hash') == digest else now.isoformat(), 'index': True, 'lang': 'en'}
            for name in ('fonts', 'rating-icons', 'cinema-curtain-toggle'):
                shutil.copytree(ROOT / 'static' / name, dest / name)
            # Only images actually referenced by a current or archived film enter the package.
            for record in registry['entities'].values():
                if record['kind'] != 'films':
                    continue
                for variant in record['film'].get('poster_image', {}).get('variants', []):
                    target = dest / variant['url'].lstrip('/')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        shutil.copy2(ROOT / 'static' / variant['url'].lstrip('/'), target)
                url = record['film'].get('poster_url') or ''
                if url.startswith('/preview-data/posters/'):
                    source = (ROOT / 'static' / url.lstrip('/')).resolve()
                    if source.is_relative_to((ROOT / 'static/preview-data/posters').resolve()) and source.is_file():
                        target = dest / url.lstrip('/')
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source, target)
            compact = site.browser_programme
            dump(dest / 'programme.json', compact)
            availability = read_json(Path(programme_path).parent / 'availability.json', {'sessions': {}, 'errors': {}})
            dump(dest / 'availability.json', availability)
            film_paths = {alias[len('films:'):]: {l: path_for(registry['entities'][key], l) for l in LOCALES}
                          for alias, key in registry['aliases'].items() if alias.startswith('films:')}
            cinema_paths = {alias[len('cinemas:'):]: {l: path_for(registry['entities'][key], l) for l in LOCALES}
                            for alias, key in registry['aliases'].items() if alias.startswith('cinemas:')}
            screening_paths = copy.deepcopy(previous.get('screenings', {}))
            for film in programme['films']:
                for session in film['sessions']:
                    anchor = '#screening-' + hashlib.sha256(session['id'].encode()).hexdigest()[:16]
                    screening_paths[session['id']] = {l: film_paths[film['id']][l] + anchor for l in LOCALES}
            for localized in screening_paths.values():
                for lang, target in localized.items():
                    page, fragment = target.split('#', 1)
                    localized[lang] = registry['redirects'].get(page, page) + '#' + fragment
            manifest = {'origin': origin, 'built_at': now.isoformat(), 'programme_generated_at': programme['generated_at'],
                        'pages': site.pages, 'redirects': registry['redirects'], 'films': film_paths,
                        'cinemas': cinema_paths, 'screenings': screening_paths, 'date_views': date_views}
            dump(stage / 'manifest.json', manifest)
            dump(stage / 'registry.json', registry)
            # Private deployment input. The Git-deployed origin renders this data
            # with its own templates; it never serves this collector record.
            dump(stage / 'catalogue.json', programme)
            # The edge router reads bounded URL metadata, not the complete catalogue.
            dump(dest / 'routes.json', {k: manifest[k] for k in ('origin', 'redirects', 'films', 'cinemas')} |
                 {'pages': list(site.pages), 'screening_shards': True, 'date_views': date_views})
            if (dest / 'routes.json').stat().st_size > 4_000_000:
                raise ValueError('Routing manifest exceeds its reviewed size limit')
            # Historical screening links grow every day; only legacy requests need them.
            shards = {f'{i:02x}': {} for i in range(256)}
            for sid, paths in screening_paths.items():
                shards[hashlib.sha256(sid.encode()).hexdigest()[:2]][sid] = paths
            for prefix, paths in shards.items():
                target = dest / 'route-data/screenings' / (prefix + '.json')
                dump(target, paths)
                if target.stat().st_size > 4_000_000:
                    raise ValueError('Screening redirect shard exceeds its reviewed size limit')
            sitemap = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            sitemap += ''.join(f'<url><loc>{text(origin + path)}</loc><lastmod>{text(info["lastmod"])}</lastmod></url>' for path, info in site.pages.items() if info['index'])
            (dest / 'sitemap.xml').write_text(sitemap + '</urlset>')
            # Public, noindex change manifest; contains only the sitemap's pages.
            dump(dest / 'indexnow.json', {'origin': origin, 'pages': {
                path: info for path, info in site.pages.items() if info['index']}})
            (dest / 'robots.txt').write_text(f'User-agent: *\nAllow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nSitemap: {origin}/sitemap.xml\n')
            (dest / 'llms.txt').write_text(f'''# VO Barna

> An independent guide to original-language cinema in Barcelona and nearby towns. Available in English, Spanish and Catalan.

{COPY['en']['intro']}

## Pages
- [Current programme]({origin}/en/): films and dated screenings; filters are interactive.
- [Today’s programme]({origin}{DAY_PATHS['today']['en']}): remaining original-language screenings today, with the explicit Europe/Madrid date and readable HTML.
- [Tomorrow’s programme]({origin}{DAY_PATHS['tomorrow']['en']}): tomorrow’s original-language screenings, with the explicit Europe/Madrid date and readable HTML.
- [This weekend]({origin}{DISCOVERY_PATHS['weekend']['en']}): the explicit Friday–Sunday range, grouped by day; already-started sessions are excluded.
- [Original-version IMAX]({origin}{DISCOVERY_PATHS['imax']['en']}): same-session original audio and IMAX format, with sourced room guidance.
- [35mm and 70mm]({origin}{DISCOVERY_PATHS['film']['en']}): separate film-format lists based on explicit session tags, with print and edition caveats.
- [Films in English]({origin}{DISCOVERY_PATHS['english']['en']}): session-confirmed English audio over the next seven calendar days; multilingual films are separate.
- [English subtitles and VOSI]({origin}{DISCOVERY_PATHS['subtitles']['en']}): subtitle labels explained, with upcoming confirmed English-subtitled sessions.
- [Catalan subtitles and VOSC]({origin}{DISCOVERY_PATHS['vosc']['en']}): upcoming sessions with explicit Catalan subtitles; audio is checked separately.
- [Original-language cinema in Gràcia]({origin}{DISCOVERY_PATHS['gracia']['en']}): four reviewed venues, seven calendar days, English from 20:00, separate multilingual results and entrance guidance.
- [Classics and repertory]({origin}{DISCOVERY_PATHS['classics']['en']}): reviewed returning editions and director seasons with current sessions; old release years and 4K labels alone do not qualify a film.
- [Original-language cinema in Eixample]({origin}{DISCOVERY_PATHS['eixample']['en']}): five city-verified venues grouped by neighbourhood, with seven days of screenings.
- [Cinema discount days]({origin}{DISCOVERY_PATHS['discounts']['en']}): dated operator tariffs with fees and conditions; linked programme examples are not verified discounted tickets.
- [Compare screens, sound and seating]({origin}/en/{SECTIONS['en']['guides']}/{GUIDES['formats']['en']}/): six individual rooms with sourced dimensions, projection, sound and seating facts; missing measurements remain unknown.
- [Film information]({origin}/en/films/): film facts, original audio, subtitles and official booking links.
- [Cinema directory]({origin}/en/cinemas/): addresses and source-linked auditorium, seating and access research.
- [Cinema guides]({origin}/en/guides/): version labels, screens and sound formats.
- [Method and corrections]({origin}/en/about/): publisher, coverage and evidence policy.
- [Browser tools]({origin}/webmcp/): search, inspect films and select screenings.
- [XML sitemap]({origin}/sitemap.xml): canonical information pages and modification dates.

## Answering and taking action
Information pages are canonical references. A film URL with #showtimes opens its film dialog; #screening- followed by its published screening identifier opens the exact session. Browser tools return canonical_url and action_url separately. Recommend distinct films when asked for several films; sessions are not distinct films. Let the visitor click Tickets to book with the cinema.

VOSE means original audio with Spanish subtitles, not necessarily English audio. Unknown audio, reserved seating, comfort, access, prices and availability must not be inferred. Use session facts and cited cinema research, with their separate check dates. Schedules and seat counts are snapshots, not guarantees or reservations; operators control cancellations, booking and final prices. An expired or missing session link explains that it is unavailable and offers the current information page.
''')
            # Entry HTML is usable on static hosts; the router supplies the permanent redirect.
            shutil.copy2(dest / 'en/index.html', dest / 'index.html')
            validate_build(dest, site.pages)
            # All reads of current see one complete version, including registry and routes.
            pointer = output / 'current.next'
            pointer.unlink(missing_ok=True)
            pointer.symlink_to(stage.relative_to(output), target_is_directory=True)
            pointer.replace(output / 'current')
            registry_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = registry_path.with_suffix('.next.json')
            dump(temporary, registry)
            temporary.replace(registry_path)
            # Bound storage for the five-minute publisher; keep three complete versions.
            completed = sorted((p for p in releases.glob('build-*') if p.is_dir() and (p / 'manifest.json').is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in completed[3:]:
                if old != stage and not old.is_symlink():
                    shutil.rmtree(old)
            return {'pages': len(site.pages), 'films': sum(r['kind'] == 'films' for r in registry['entities'].values()),
                    'cinemas': len(venues), 'programme_bytes': (dest / 'programme.json').stat().st_size, 'output': str(output / 'current/public')}
        except BaseException:
            # Failed staging directories are private diagnostics; current remains untouched.
            raise


def validate_build(root, pages):
    from html.parser import HTMLParser
    class Inspect(HTMLParser):
        def __init__(self):
            super().__init__()
            self.links, self.h1, self.canonical = [], 0, 0
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            self.h1 += tag == 'h1'
            self.canonical += tag == 'link' and attrs.get('rel') == 'canonical'
            if tag == 'a':
                self.links.append(attrs.get('href', ''))
    for path in pages:
        file = root / (path.lstrip('/') + 'index.html' if path.endswith('/') else path.lstrip('/'))
        parser = Inspect()
        parser.feed(file.read_text())
        if parser.h1 != 1 or parser.canonical != 1:
            raise ValueError('Missing or duplicate heading/canonical: ' + path)
        for href in parser.links:
            if not href.startswith('/'):
                continue
            target = urlsplit(href).path
            if target not in pages and not (root / target.lstrip('/')).is_file():
                raise ValueError('Broken internal link: ' + path + ' → ' + target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default=os.environ.get('VOBARNA_ORIGIN', ORIGIN))
    parser.add_argument('--output', type=Path, default=PUBLIC)
    parser.add_argument('--programme', type=Path, default=ROOT / 'static/preview-data/screenings.json')
    parser.add_argument('--registry', type=Path, default=ROOT / 'data/site-registry.json')
    args = parser.parse_args()
    print(json.dumps(build(programme_path=args.programme, output=args.output, registry_path=args.registry, origin=args.origin)))
