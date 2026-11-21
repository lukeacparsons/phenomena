"""Session-backed copy for the closed information area of film and cinema pages."""
from datetime import datetime

from discovery_content import select_sessions
from language_names import LANGUAGE_NAMES, parse_languages, without_language_placeholder


COPY = {
    'en': {
        'film_heading': '{title}: cinemas and screening details',
        'subtitle_heading': '{title}: English subtitles{version} in Barcelona',
        'subtitle_description': '{title} in Barcelona: confirmed English-subtitled screenings{version}. Find cinemas, showtimes and official tickets.',
        'subtitle_empty': 'No upcoming screenings with English subtitles are currently listed.',
        'subtitle_empty_description': '{title} in Barcelona: no upcoming English-subtitled screenings currently listed. Check the film programme for new dates and other versions.',
        'venue_heading': 'Original-version films at {name}',
        'film_intro': 'Compare the collected screenings of {title} in Barcelona and nearby towns. Audio, subtitles and formats below belong to the particular screening shown.',
        'venue_intro': 'Explore the collected original-version programme at {name}. Each film below links to a specific screening, with its own audio, subtitles and advertised format.',
        'film_count': 'Upcoming screenings: {sessions} · Cinemas: {cinemas}',
        'venue_count': 'Upcoming screenings: {sessions} · Films and events: {films}',
        'next': 'Next listed screening',
        'film_selection': 'One upcoming screening per cinema. See the showtimes above for other dates and versions.',
        'venue_selection': 'A selection of up to six films or events, with one upcoming screening each. The programme above contains the other collected dates and titles.',
        'related': 'Guides for these screenings',
        'snapshot': 'Programme snapshot',
        'film_description': '{title} in Barcelona and nearby cinemas. {languages} Compare showtimes and official tickets.',
        'film_empty_description': 'Film details for {title}. No upcoming screenings in our collected Barcelona-area programme; check the cinemas for new dates.',
        'venue_title': '{name}: original-version showtimes and tickets',
        'venue_empty_title': '{name}: venue information and programme',
        'venue_description': '{name}. Programme includes {films}. Compare audio, subtitles, showtimes and official tickets.',
    },
    'es': {
        'film_heading': '{title}: cines y detalles de las sesiones',
        'subtitle_heading': '{title}: subtítulos en inglés{version} en Barcelona',
        'subtitle_description': '{title} en Barcelona: sesiones confirmadas con subtítulos en inglés{version}. Cines, horarios y entradas oficiales.',
        'subtitle_empty': 'No hay próximas sesiones con subtítulos en inglés anunciadas.',
        'subtitle_empty_description': '{title} en Barcelona: no hay próximas sesiones con subtítulos en inglés anunciadas. Consulta nuevas fechas y otras versiones.',
        'venue_heading': 'Películas en versión original en {name}',
        'film_intro': 'Compara las sesiones recopiladas de {title} en Barcelona y localidades cercanas. El audio, los subtítulos y los formatos indicados corresponden a la sesión concreta.',
        'venue_intro': 'Consulta la programación en versión original recopilada de {name}. Cada película enlaza a una sesión concreta, con su audio, subtítulos y formato anunciado.',
        'film_count': 'Próximas sesiones: {sessions} · Cines: {cinemas}',
        'venue_count': 'Próximas sesiones: {sessions} · Películas y eventos: {films}',
        'next': 'Próxima sesión recopilada',
        'film_selection': 'Una próxima sesión por cine. Consulta los horarios de arriba para otras fechas y versiones.',
        'venue_selection': 'Una selección de hasta seis películas o eventos, con una próxima sesión de cada uno. La cartelera de arriba incluye las demás fechas y títulos recopilados.',
        'related': 'Guías para estas sesiones',
        'snapshot': 'Programación recopilada',
        'film_description': '{title} en Barcelona y cines cercanos. {languages} Compara horarios y entradas oficiales.',
        'film_empty_description': 'Ficha de {title}. No hay próximas sesiones en nuestra programación recopilada de Barcelona y alrededores; consulta nuevas fechas con los cines.',
        'venue_title': '{name}: cartelera en versión original y entradas',
        'venue_empty_title': '{name}: información y programación',
        'venue_description': '{name}. La programación incluye {films}. Compara audio, subtítulos, horarios y entradas oficiales.',
    },
    'ca': {
        'film_heading': '{title}: cinemes i detalls de les sessions',
        'subtitle_heading': '{title}: subtítols en anglès{version} a Barcelona',
        'subtitle_description': '{title} a Barcelona: sessions confirmades amb subtítols en anglès{version}. Cinemes, horaris i entrades oficials.',
        'subtitle_empty': 'No hi ha pròximes sessions amb subtítols en anglès anunciades.',
        'subtitle_empty_description': '{title} a Barcelona: no hi ha pròximes sessions amb subtítols en anglès anunciades. Consulta noves dates i altres versions.',
        'venue_heading': 'Pel·lícules en versió original a {name}',
        'film_intro': 'Compara les sessions recopilades de {title} a Barcelona i rodalia. L’àudio, els subtítols i els formats indicats corresponen a la sessió concreta.',
        'venue_intro': 'Consulta la programació en versió original recopilada de {name}. Cada pel·lícula enllaça a una sessió concreta, amb el seu àudio, subtítols i format anunciat.',
        'film_count': 'Pròximes sessions: {sessions} · Cinemes: {cinemas}',
        'venue_count': 'Pròximes sessions: {sessions} · Pel·lícules i esdeveniments: {films}',
        'next': 'Pròxima sessió recopilada',
        'film_selection': 'Una pròxima sessió per cinema. Consulta els horaris de dalt per a altres dates i versions.',
        'venue_selection': 'Una selecció de fins a sis pel·lícules o esdeveniments, amb una pròxima sessió de cadascun. La cartellera de dalt inclou les altres dates i títols recopilats.',
        'related': 'Guies per a aquestes sessions',
        'snapshot': 'Programació recopilada',
        'film_description': '{title} a Barcelona i cinemes propers. {languages} Compara horaris i entrades oficials.',
        'film_empty_description': 'Fitxa de {title}. No hi ha pròximes sessions a la nostra programació recopilada de Barcelona i rodalia; consulta noves dates amb els cinemes.',
        'venue_title': '{name}: cartellera en versió original i entrades',
        'venue_empty_title': '{name}: informació i programació',
        'venue_description': '{name}. La programació inclou {films}. Compara àudio, subtítols, horaris i entrades oficials.',
    },
}


def upcoming(pairs, now):
    return sorted((pair for pair in pairs if datetime.fromisoformat(pair[1]['starts_at']) > now),
                  key=lambda pair: (datetime.fromisoformat(pair[1]['starts_at']), pair[1]['id']))


def shared_language(pairs, field):
    """A page-wide language claim requires complete, matching session evidence."""
    values = [parse_languages(without_language_placeholder(s.get(field))) for _, s in pairs]
    if not values or any(not value['complete'] or len(value['codes']) != 1 for value in values):
        return None
    codes = {value['codes'][0] for value in values}
    return LANGUAGE_NAMES[next(iter(codes))] if len(codes) == 1 else None


def shared_version(pairs):
    values = {str(s.get('version') or '').strip().upper() for _, s in pairs}
    if len(values) == 1 and values <= {'VO', 'VOSE', 'VOSC', 'VOSI'}:
        return next(iter(values))
    return None


def examples(pairs, *, film_page):
    selected = {}
    for film, session in pairs:
        key = session['cinema_id'] if film_page else film['id']
        selected.setdefault(key, (film, session))
    return list(selected.values()) if film_page else list(selected.values())[:6]


def related_guides(pairs, now):
    # Reuse the guides' own selection rules, including their date windows.
    # A cinema's equipment, a title or VOSE alone cannot qualify a link.
    films = {}
    for film, session in pairs:
        films.setdefault(film['id'], {**film, 'sessions': []})['sessions'].append(session)
    programme = {'films': list(films.values())}
    return [kind for kind in ('english', 'subtitles', 'vosc', 'imax', 'film')
            if any(select_sessions(programme, kind, now).values())]
