"""The browser's complete search catalogue, without duplicated crawler records."""
from copy import deepcopy
from datetime import datetime
from language_names import without_language_placeholder
from film_synopsis import unique_synopses
from search_evidence import session_evidence, confirmed_no_subtitles

FILM_FIELDS = ('id', 'title', 'titles', 'original_title', 'english_title', 'release_year', 'imdb_id',
               'runtime_minutes', 'details', 'ratings', 'poster_url', 'poster_width', 'poster_height',
               'poster_image', 'merged_ids', 'synopsis')
SESSION_FIELDS = ('id', 'cinema_id', 'provider', 'starts_at', 'date', 'time', 'room', 'version', 'formats',
                  'language', 'subtitles', 'big_screen', 'booking_url', 'booking_scope',
                  'source_url', 'schedule_fetched_at', 'seat_data', 'is_sold_out', 'price_data', 'runtime_minutes', 'ends_at',
                  'search_facts', 'subtitles_confirmed_none')


def browser_programme(programme, now=None):
    # Keep all metadata and aliases used by search and WebMCP, including credits,
    # release dates, ratings and their sources. Per-session film titles, artwork,
    # synopses, provider responses and collector diagnostics are redundant here.
    result = {key: deepcopy(programme[key]) for key in ('generated_at', 'timezone', 'cinemas', 'coverage') if key in programme}
    result['films'] = []
    for film in programme['films']:
        value = {key: deepcopy(film[key]) for key in FILM_FIELDS if key in film}
        details = value.get('details', {})
        value['synopses'] = unique_synopses([film.get('synopsis'), *film.get('synopses', []),
            details.get('synopsis'), *details.get('synopses', []), *(s.get('synopsis') for s in film['sessions'])])
        value['synopsis'] = next(iter(value['synopses']), '')
        if 'synopsis' in details:
            details['synopsis'] = next(iter(unique_synopses([details['synopsis']])), '')
        value['sessions'] = [{key: deepcopy(session[key]) for key in SESSION_FIELDS if key in session}
                             for session in film['sessions']
                             if now is None or datetime.fromisoformat(session['starts_at']) >= now]
        originals = {s.get('id'): s for s in film['sessions']}
        for session in value['sessions']:
            original = originals.get(session.get('id'), {})
            evidence = session_evidence(original)
            if evidence:
                session['search_facts'] = evidence
            if confirmed_no_subtitles(original):
                session['subtitles_confirmed_none'] = True
            for field in ('language', 'subtitles'):
                if field in session:
                    session[field] = without_language_placeholder(session[field])
        result['films'].append(value)
    return result
