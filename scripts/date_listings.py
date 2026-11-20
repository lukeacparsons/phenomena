"""Published date fragments and reusable shells; requests never scrape a cinema."""
from datetime import date, datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo

from complete_programme import render_complete_programme
from site_content import COPY as SITE_COPY

MADRID = ZoneInfo('Europe/Madrid')
DATE_TOKEN = '__VOBARNA_DATE__'
LISTING_TOKEN = '__VOBARNA_DATE_LISTING__'
DAY_PATHS = {
    'today': {'en': '/en/showtimes/today/', 'es': '/es/cartelera/hoy/', 'ca': '/ca/cartellera/avui/'},
    'tomorrow': {'en': '/en/showtimes/tomorrow/', 'es': '/es/cartelera/manana/', 'ca': '/ca/cartellera/dema/'},
}
COPY = {
    'en': {
        'today': 'Original-language films in Barcelona today',
        'tomorrow': 'Original-language films in Barcelona tomorrow',
        'date': 'Original-language films in Barcelona',
        'today_link': 'Today’s programme', 'tomorrow_link': 'Tomorrow’s programme',
        'intro': 'Find original-language screenings in Barcelona and nearby towns on {date}. Compare audio, subtitles, times and formats, then book directly with the cinema.',
        'scope': 'Screenings on {date}. Times are local to Barcelona (Europe/Madrid).',
        'empty': 'No upcoming screenings for this date in our collected programme. Unpublished dates and missing listings remain unknown; check the cinema’s official programme.',
        'snapshot': 'Programme collected', 'all': 'Browse all dates',
    },
    'es': {
        'today': 'Películas en versión original en Barcelona hoy',
        'tomorrow': 'Películas en versión original en Barcelona mañana',
        'date': 'Películas en versión original en Barcelona',
        'today_link': 'Cartelera de hoy', 'tomorrow_link': 'Cartelera de mañana',
        'intro': 'Encuentra sesiones en versión original en Barcelona y alrededores el {date}. Compara audio, subtítulos, horarios y formatos, y compra las entradas directamente en la web del cine.',
        'scope': 'Sesiones del {date}. Hora local de Barcelona (Europe/Madrid).',
        'empty': 'No hay próximas sesiones para esta fecha en nuestra cartelera recopilada. Las fechas no publicadas y las sesiones no recopiladas son desconocidas; consulta la programación oficial del cine.',
        'snapshot': 'Cartelera recopilada', 'all': 'Ver todas las fechas',
    },
    'ca': {
        'today': 'Pel·lícules en versió original a Barcelona avui',
        'tomorrow': 'Pel·lícules en versió original a Barcelona demà',
        'date': 'Pel·lícules en versió original a Barcelona',
        'today_link': 'Cartellera d’avui', 'tomorrow_link': 'Cartellera de demà',
        'intro': 'Troba sessions en versió original a Barcelona i rodalia el {date}. Compara àudio, subtítols, horaris i formats, i compra les entrades directament al web del cinema.',
        'scope': 'Sessions del {date}. Hora local de Barcelona (Europe/Madrid).',
        'empty': 'No hi ha pròximes sessions per a aquesta data a la cartellera recopilada. Les dates no publicades i les sessions no recopilades són desconegudes; consulta la programació oficial del cinema.',
        'snapshot': 'Cartellera recopilada', 'all': 'Veure totes les dates',
    },
}


def valid_date(value):
    try:
        return len(value) == 10 and date.fromisoformat(value).isoformat() == value
    except (ValueError, TypeError):
        return False


def published_dates(programme, now):
    return sorted({datetime.fromisoformat(s['starts_at']).astimezone(MADRID).date().isoformat()
                   for film in programme['films'] for s in film['sessions']
                   if datetime.fromisoformat(s['starts_at']) >= now})


def date_view(path, query, now=None):
    """Only canonical programme/date views use these fragments, not venue pages."""
    now = now or datetime.now(MADRID)
    for kind, paths in DAY_PATHS.items():
        for lang, route in paths.items():
            if path == route:
                day = now.astimezone(MADRID).date() + timedelta(days=kind == 'tomorrow')
                return {'lang': lang, 'kind': kind, 'date': day.isoformat()}
    lang = path.strip('/')
    if lang in COPY and 'date' in query:
        values = query['date']
        if len(values) == 1 and valid_date(values[0]):
            return {'lang': lang, 'kind': 'date', 'date': values[0]}
    return None


def fill_template(template, fragment, day):
    if not valid_date(day):
        raise ValueError('Invalid listing date')
    # Replace only template tokens, never title/source text inside the fragment.
    return template.replace(DATE_TOKEN, day).replace(LISTING_TOKEN, fragment)


def render_date_view(root, manifest, view):
    lang, kind, day = (view[k] for k in ('lang', 'kind', 'date'))
    name = day if day in manifest['date_views']['dates'] else 'empty'
    template = (root / 'date-views' / lang / (kind + '.txt')).read_text()
    fragment = (root / 'date-views' / lang / (name + '.txt')).read_text()
    return fill_template(template, fragment, day)


def build_date_views(site, language_name, stamp):
    today = site.now.astimezone(MADRID).date()
    for lang, copy in COPY.items():
        directory = site.dest / 'date-views' / lang
        directory.mkdir(parents=True, exist_ok=True)
        fragments = {}
        for day in [*site.dates, 'empty']:
            listing = site.programme_listing(lang, date=day)
            if day == 'empty':
                listing = listing.replace(escape(SITE_COPY[lang]['none']), escape(copy['empty']))
            else:
                films = []
                for film in site.browser_programme['films']:
                    sessions = [s for s in film['sessions'] if datetime.fromisoformat(s['starts_at']).astimezone(MADRID).date().isoformat() == day]
                    if sessions:
                        films.append({**film, 'sessions': sessions})
                listing += render_complete_programme({**site.browser_programme, 'films': films}, lang, site.now,
                                                     language_name=language_name)
            if len(listing.encode()) > 4_000_000:
                raise ValueError('Date listing exceeds the reviewed HTML size limit')
            fragments[day] = listing
            (directory / (day + '.txt')).write_text(listing)
        for kind in ('today', 'tomorrow', 'date'):
            paths = DAY_PATHS[kind] if kind != 'date' else {l: f'/{l}/?date={DATE_TOKEN}' for l in COPY}
            title = copy[kind] + ' · ' + DATE_TOKEN
            body = f'<section class="date-heading"><h1>{escape(copy[kind])}</h1><p data-date-label>{copy["scope"].format(date=f"<time datetime=\"{DATE_TOKEN}\">{DATE_TOKEN}</time>")}</p>'
            body += f'<p class="fineprint">{escape(copy["snapshot"])}: {stamp(site.data["generated_at"])}</p>'
            body += f'<p><a href="/{lang}/">{escape(copy["all"])}</a></p></section>{LISTING_TOKEN}'
            template = site.page(paths[lang], lang, title + ' | VO Barna', copy['intro'].format(date=DATE_TOKEN), body,
                                 alternatives=paths, interactive=True, index=kind != 'date',
                                 date_scope={'date': DATE_TOKEN, 'kind': kind}, write=False)
            (directory / (kind + '.txt')).write_text(template)
            if kind != 'date':
                day = (today + timedelta(days=kind == 'tomorrow')).isoformat()
                site.save_page(paths[lang], lang, fill_template(template, fragments.get(day, fragments['empty']), day), True)
    return {'version': 1, 'dates': site.dates}
