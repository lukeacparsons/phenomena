"""Audio evidence for one original-version screening, independently of subtitles."""
from language_names import parse_languages, without_language_placeholder


def screening_audio(film, session):
    raw = without_language_placeholder(session.get('language'))
    if raw:
        return {**parse_languages(raw), 'source_url': session.get('source_url'), 'derived': False}
    empty = {**parse_languages(None), 'source_url': None, 'derived': False}
    if session.get('original_audio') is False or str(session.get('version', '')).upper() not in ('VO', 'VOSE', 'VOSC', 'VOSI', 'VOSA'):
        return empty
    details = film.get('details') or {}
    # The cinema's own film page can resolve this screening even when another
    # publisher reports a different subset of a multilingual original.
    reports = [r for r in details.get('language_reports', [])
               if r.get('status') == 'ok' and r.get('evidence') == 'explicit_original_language'
               and r.get('source_url') and r['source_url'] == session.get('source_url')]
    if reports:
        parsed = [parse_languages(r.get('languages') or r.get('raw')) for r in reports]
        if all(p['complete'] and set(p['codes']) == set(parsed[0]['codes']) for p in parsed):
            return {**parsed[0], 'source_url': session['source_url'], 'derived': True}
        return empty
    selection = details.get('language_selection') or {}
    if details.get('language_status', {}).get('state') != 'conflict' and selection.get('evidence') == 'explicit_original_language' and selection.get('source_url'):
        return {**parse_languages(details.get('original_languages') or details.get('languages')),
                'source_url': selection['source_url'], 'derived': True}
    return empty


def has_non_english_audio(audio):
    return any(code not in ('en', 'zxx') for code in audio['codes'])
