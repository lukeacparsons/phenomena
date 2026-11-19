"""Small, readable HTML for the entire programme, independent of the JS grid."""
from collections import defaultdict
from datetime import datetime
from html import escape
import hashlib
import json
from zoneinfo import ZoneInfo

from site_content import COPY

MADRID = ZoneInfo('Europe/Madrid')
LABELS = {
    'en': ('Complete programme', 'All collected upcoming screenings. Times are local to Barcelona (Europe/Madrid).',
           'Programme snapshot', '{films} films · {sessions} screenings', 'Sold out'),
    'es': ('Cartelera completa', 'Todas las próximas sesiones recopiladas. Hora local de Barcelona (Europe/Madrid).',
           'Fecha de la cartelera', '{films} películas · {sessions} sesiones', 'Agotado'),
    'ca': ('Cartellera completa', 'Totes les pròximes sessions recopilades. Hora local de Barcelona (Europe/Madrid).',
           'Data de la cartellera', '{films} pel·lícules · {sessions} sessions', 'Exhaurit'),
}


def render_complete_programme(programme, lang, now, *, language_name, disclosure=True):
    """Render every provided future session once as ordinary HTML.

    No images, fetches or client-side templates: plain HTML readers receive the
    full programme. The independent disclosure survives grid filtering and a
    failed catalogue request. Only confirmed session language facts are used.
    """
    t = COPY[lang]
    title, introduction, updated, count_label, sold_out_label = LABELS[lang]
    cinemas = {cinema['id']: cinema for cinema in programme['cinemas']}
    articles, total = [], 0
    for film in sorted(programme['films'], key=lambda f: (f['title'].casefold(), f['id'])):
        sessions = sorted((s for s in film['sessions'] if datetime.fromisoformat(s['starts_at']) >= now),
                          key=lambda s: (s['starts_at'], s['cinema_id'], s['id']))
        if not sessions:
            continue
        total += len(sessions)
        film_url = film['urls'][lang]
        groups = defaultdict(list)
        for session in sessions:
            local = datetime.fromisoformat(session['starts_at']).astimezone(MADRID)
            key = (local.date().isoformat(), session['cinema_id'], session.get('room'),
                   language_name(session.get('language'), lang), language_name(session.get('subtitles'), lang),
                   session.get('version'), tuple(session.get('formats') or []))
            groups[key].append((session, local))
        rows = []
        for (date, cinema_id, room, audio, subtitles, version, formats), group in groups.items():
            cinema = cinemas[cinema_id]
            facts = [f'{t["audio"]}: {audio}', f'{t["subtitles"]}: {subtitles}']
            if room:
                facts.append(f'{t["room"]}: {room}')
            if version:
                facts.append(f'{t["version"]}: {version}')
            if formats:
                facts.append(f'{t["formats"]}: {", ".join(formats)}')
            times = []
            for session, local in group:
                # Reuse the homepage's existing delegated modal action. Without
                # JavaScript, this opens the canonical static screening page.
                href = film_url + session['anchor']
                sold_out = f' ({sold_out_label})' if session.get('is_sold_out') else ''
                times.append(f'<a href="{escape(href, quote=True)}" data-programme-session aria-haspopup="dialog">'
                             f'<time datetime="{escape(session["starts_at"], quote=True)}">{local:%H:%M}</time>{sold_out}</a>')
            rows.append(f'<li><a href="{escape(cinema["urls"][lang], quote=True)}">{escape(cinema["name"])}</a> · '
                        f'<time datetime="{date}">{date}</time> · {escape(" · ".join(facts))}: '
                        f'<span class="programme-times">{", ".join(times)}</span></li>')
        articles.append(f'<article data-programme-film="{escape(film["id"], quote=True)}"><h3><a href="{escape(film_url, quote=True)}" data-open="{escape(film["id"], quote=True)}">'
                        f'{escape(film["title"])}</a></h3><ul>{"".join(rows)}</ul></article>')
    generated = datetime.fromisoformat(programme['generated_at']).astimezone(MADRID)
    counts = count_label.format(films=len(articles), sessions=total)
    content = ''.join(articles) if articles else f'<p>{escape(t["none"])}</p>'
    tag = 'details' if disclosure else 'section'
    heading = f'<summary>{title}</summary>' if disclosure else ''
    return (f'<{tag} class="complete-programme" id="complete-programme" data-films="{len(articles)}" data-sessions="{total}">'
            f'{heading}<div class="complete-programme-content"><h2>{title}</h2>'
            f'<p>{escape(counts)}. {introduction}</p><p class="fineprint">{updated}: '
            f'<time datetime="{escape(programme["generated_at"], quote=True)}">{generated:%Y-%m-%d %H:%M} Europe/Madrid</time>. '
            f'{escape(t["stale"])}</p><div data-programme-entries>{content}</div></div></{tag}>')


PROGRAMME_PATHS = {'en': '/en/programme/', 'es': '/es/cartelera/', 'ca': '/ca/cartellera/'}


def programme_path(lang, number=1):
    return PROGRAMME_PATHS[lang] + (f'page/{number}/' if number > 1 else '')


def paginate_programme(programme, now, *, language_name, budget=600000):
    """Partition every future screening once; bound HTML bytes in every locale.

    Split oversized batches, including a single film with many screenings. All
    locales share boundaries so their hreflang links refer to the same content.
    """
    screenings = [(film, session)
                  for film in sorted(programme['films'], key=lambda f: (f['title'].casefold(), f['id']))
                  for session in sorted(film['sessions'], key=lambda s: (s['starts_at'], s['cinema_id'], s['id']))
                  if datetime.fromisoformat(session['starts_at']) >= now]
    pages = []
    version_data = [programme['generated_at'], [(film['id'], film['title'], film['urls'], session) for film, session in screenings]]
    version = hashlib.sha256(json.dumps(version_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]

    def append(batch):
        films = {}
        for film, session in batch:
            films.setdefault(film['id'], {**film, 'sessions': []})['sessions'].append(session)
        subset = {**programme, 'films': list(films.values())}
        markup = {lang: render_complete_programme(subset, lang, now, language_name=language_name, disclosure=False)
                  for lang in LABELS}
        markup = {lang: html.replace('id="complete-programme"', f'id="complete-programme" data-programme-version="{version}"')
                  for lang, html in markup.items()}
        if max(len(html.encode()) for html in markup.values()) > budget:
            if len(batch) < 2:
                raise ValueError('A single screening exceeds the programme HTML budget')
            middle = len(batch) // 2
            append(batch[:middle]); append(batch[middle:])
        else:
            pages.append({'html': markup, 'sessions': len(batch), 'films': len(films),
                          'version': version, 'generated_at': programme['generated_at'],
                          'first': batch[0][0]['title'] if batch else '',
                          'last': batch[-1][0]['title'] if batch else ''})

    for start in range(0, len(screenings), 1000):
        append(screenings[start:start + 1000])
    if not pages:
        append([])
    return pages


def render_programme_directory(pages, lang):
    """Ordinary HTML links expose the full programme before any script runs."""
    title = LABELS[lang][0]
    generated = datetime.fromisoformat(pages[0]['generated_at']).astimezone(MADRID)
    links = ''.join(f'<li><a href="{programme_path(lang, number)}" data-programme-page>'
                    f'{COPY[lang]["page"]} {number}'
                    + (f': {escape(page["first"])} — {escape(page["last"])}' if page['sessions'] else '') + '</a></li>'
                    for number, page in enumerate(pages, 1))
    return (f'<details class="complete-programme" id="complete-programme" data-programme-version="{pages[0]["version"]}" data-sessions="{sum(p["sessions"] for p in pages)}">'
            f'<summary>{title}</summary><div class="complete-programme-content"><h2>{title}</h2>'
            f'<p>{LABELS[lang][1]}</p><p class="fineprint">{LABELS[lang][2]}: '
            f'<time datetime="{escape(pages[0]["generated_at"], quote=True)}">{generated:%Y-%m-%d %H:%M} Europe/Madrid</time>. '
            f'{escape(COPY[lang]["stale"])}</p><nav aria-label="{title}"><ul>{links}</ul></nav>'
            '<p data-programme-status role="status"></p><div data-programme-loaded></div></div></details>')
