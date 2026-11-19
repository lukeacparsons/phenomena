"""Small, readable HTML for the entire programme, independent of the JS grid."""
from collections import defaultdict
from datetime import datetime
from html import escape
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


def render_complete_programme(programme, lang, now, *, language_name):
    """Return a native, closed disclosure containing every future session once.

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
    return (f'<details class="complete-programme" id="complete-programme" data-films="{len(articles)}" data-sessions="{total}">'
            f'<summary>{title}</summary><div class="complete-programme-content"><h2>{title}</h2>'
            f'<p>{escape(counts)}. {introduction}</p><p class="fineprint">{updated}: '
            f'<time datetime="{escape(programme["generated_at"], quote=True)}">{generated:%Y-%m-%d %H:%M} Europe/Madrid</time>. '
            f'{escape(t["stale"])}</p>{content}</div></details>')
