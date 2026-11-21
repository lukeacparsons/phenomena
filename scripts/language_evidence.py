"""Resolve original-language claims without merging disagreeing sources."""
import re
from urllib.parse import urlsplit
from language_names import parse_languages, LANGUAGE_NAMES

FIELDS = ('languages', 'original_languages', 'spoken_languages', 'language_reports',
          'language_selection', 'language_provenance', 'language_status', 'language_identity')


def invalid_legacy_cinema_report(report):
    """Pre-v5 CineBaix extraction mistook the site-wide code legend for audio."""
    return (report.get('source') == 'cinema'
            and (urlsplit(report.get('source_url') or '').hostname or '').removeprefix('www.') == 'cinebaix.cat'
            and report.get('parser_version', 0) < 5)


def repair_legacy_cinema_languages(film, now):
    """Withdraw bad cached evidence on publication, without requiring a crawl."""
    details = film.get('details') or {}
    reports = details.get('language_reports', [])
    if not any(invalid_legacy_cinema_report(r) for r in reports): return False
    from film_details import filter_language_aliases
    aliases = filter_language_aliases(details, details.get('search_aliases', []))
    # Remove aliases from the withdrawn claim as well as its derived selection.
    bad_names = {v.casefold() for r in reports if invalid_legacy_cinema_report(r) for v in r.get('languages', [])}
    aliases = [v for v in aliases if v.casefold() not in bad_names]
    resolve(details, reports, now)
    details['language_provenance'] = [r for r in details.get('language_provenance', []) if not invalid_legacy_cinema_report(r)]
    details['search_aliases'] = filter_language_aliases(details, [*aliases, *details['languages']])
    return True


def normalise(report):
    raw = report.get('raw', report.get('languages', []))
    parsed = parse_languages(raw)
    # A parser may already know that part of its original label was unreadable.
    unknown = list(dict.fromkeys([*parsed['unknown'], *report.get('unknown', [])]))
    return {**report, 'raw': raw, 'codes': parsed['codes'], 'unknown': unknown,
            'complete': bool(parsed['codes']) and not unknown,
            'languages': [LANGUAGE_NAMES[c] for c in parsed['codes']]}


def session_reports(film):
    reports = []
    for session in film.get('sessions', []):
        provider = session.get('provider', 'cinema')
        raw, evidence = session.get('original_language_raw'), session.get('original_language_evidence')
        # These providers receive originals from our own registry. Counting
        # those as new independent evidence would create circular confirmation.
        if provider in ('mooby', 'filmax'):
            raw, evidence = None, None
        if not raw:
            label = session.get('source_version') or ''
            match = re.match(r'^(.+?)\s+SUBTITULAD[OA]\s+EN\s+', label, re.I) if provider == 'yelmo' else None
            raw = match[1].strip() if match else session.get('screening_audio') or session.get('language')
            if raw and session.get('original_audio') and session.get('original_audio_evidence') in (
                    'explicit_original_version', 'audio_matches_original_language', 'screening_audio_matches_reviewed_original'):
                evidence = 'original_version_audio'
            else:
                raw = None
        if not raw and re.search(r'\b(?:sin di[aá]logos?|sense di[aà]legs?|no dialogue)\b', session.get('source_version') or '', re.I):
            raw, evidence = 'zxx', 'explicit_original_language'
        if not raw: continue
        reports.append({'source': provider, 'source_url': session.get('original_language_source') or session.get('source_url'),
            'raw': raw, 'evidence': evidence or 'explicit_original_language',
            'checked_at': session.get('schedule_fetched_at'), 'status': 'ok',
            'provider_film_id': session.get('film_id')})
    return reports


def priority(report):
    if report.get('source') == 'reviewed': return 0
    if report.get('source') == 'wikidata': return 80
    if report.get('evidence') == 'original_version_audio': return 50
    return {'rotten_tomatoes': 10, 'tmdb': 30}.get(report.get('source'), 20)


def source_family(report):
    host=urlsplit(report.get('source_url') or '').hostname
    return host.removeprefix('www.') if host else report.get('source')


def resolve(details, reports, now):
    unique = {}
    for report in reports:
        if invalid_legacy_cinema_report(report): continue
        item = normalise(report)
        key = (item.get('source'), item.get('source_url'), item.get('evidence'), tuple(item['codes']), tuple(item['unknown']))
        unique[key] = item
    reports = list(unique.values())
    valid = [r for r in reports if r['complete'] and r.get('status') in ('ok', 'stale', None)]
    issues = []
    if any(r['unknown'] for r in reports): issues.append('unrecognised_language_labels')
    if any(r.get('status') == 'stale' for r in valid): issues.append('stale_source')
    chosen = None
    if valid:
        chosen = min(valid, key=lambda r: (priority(r), -len(r['codes']), r.get('source_url') or ''))
        sets = {tuple(sorted(r['codes'])) for r in valid}
        if len(sets) > 1:
            issues.append('sources_disagree')
            # Keep an established explicit value if it still has supporting
            # evidence. Do not invent a new multilingual list by unioning claims.
            previous = set(parse_languages(details.get('languages', []))['codes'])
            old_source = details.get('language_selection', {}).get('source')
            prior = next((r for r in valid if set(r['codes']) == previous and r.get('source') == old_source), None)
            if prior and priority(prior) <= priority(chosen): chosen = prior
        details['languages'] = chosen['languages']
        details['language_selection'] = {k: chosen[k] for k in ('source', 'source_url', 'evidence', 'parser_version') if k in chosen}
        state = 'conflict' if 'sources_disagree' in issues else (
            'catalogue_only' if priority(chosen) >= 80 else
            'no_spoken_language' if chosen['codes'] == ['zxx'] else
            'corroborated' if len({source_family(r) for r in valid}) > 1 else 'supported')
        details['original_languages'] = chosen['codes'] if state != 'catalogue_only' else []
    else:
        state = 'unresolved'
        details['languages'] = []
        details['original_languages'] = []
        details.pop('language_selection', None)
    details['language_reports'] = reports
    details['language_status'] = {'state': state, 'issues': issues, 'checked_at': now.isoformat()}
    return details


def review_report(films, previous, now, *, tmdb_status):
    counts, providers, queue, regressions = {}, {}, [], []
    for film in films:
        details = film.get('details', {})
        status = details.get('language_status', {'state': 'unresolved', 'issues': []})
        state = status['state']; counts[state] = counts.get(state, 0) + 1
        for provider in {s.get('provider') for s in film.get('sessions', [])}:
            row = providers.setdefault(provider, {'total': 0, 'with_language': 0, 'needs_review': 0})
            row['total'] += 1; row['with_language'] += bool(details.get('languages'))
            row['needs_review'] += state in ('unresolved', 'conflict', 'catalogue_only') or bool(status['issues'])
        old = previous.get(film['id'], {})
        if old.get('languages') and not details.get('languages'): regressions.append(film['id'])
        if state in ('unresolved', 'conflict', 'catalogue_only') or status['issues']:
            queue.append({'id': film['id'], 'title': film.get('title', film['id']), 'imdb_id': film.get('imdb_id'),
                'state': state, 'issues': status['issues'], 'languages': details.get('languages', []),
                'sources': details.get('language_reports', []),
                'next_action': 'review_source_disagreement' if state == 'conflict' else
                    'normalise_unrecognised_labels' if 'unrecognised_language_labels' in status['issues'] else
                    'find_explicit_original_language' if film.get('imdb_id') else 'resolve_film_or_programme_identity'})
    return {'version': 1, 'checked_at': now.isoformat(), 'tmdb': tmdb_status,
            'total_entries': len(films), 'with_language': sum(bool(f.get('details', {}).get('languages')) for f in films),
            'states': counts, 'by_provider': providers, 'regressions': regressions, 'queue': queue}
