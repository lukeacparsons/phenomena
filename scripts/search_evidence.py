"""Public search evidence. Never turn missing metadata into a negative fact."""
from copy import deepcopy
import re


def session_evidence(session):
    value = deepcopy(session.get('search_facts', []))
    source = session.get('source_url')
    if not session.get('id') or not isinstance(source, str) or not source.startswith('https://'):
        return value
    # Session labels are evidence for a special event; a film's general plot is not.
    label = ' '.join(str(session.get(k) or '') for k in ('title', 'source_version', 'event_title'))
    patterns = (
        ('event', 'q&a', r'\b(?:Q\s*&\s*A|coloquio|col·loqui|colloqui|debate con|presentaci[oó]n (?:y|amb) (?:coloquio|el director))\b'),
        ('event', 'live music', r'\b(?:live music|live musical accompaniment|m[uú]sica en (?:directo|directe)|acompanyament musical en directe)\b'),
        ('event', 'relaxed', r'\b(?:relaxed screening|cinema relax|sesi[oó]n relajada|sessi[oó] relaxada)\b'),
        ('event', 'audio description', r'\b(?:audio described|audiodescripci[oó]n?|audio description)\b'),
        ('edition', 'restored', r'\b(?:restored|restaurad[ao]|restaurad[ae]|restauraci[oó]n?)\b'),
        ('edition', 'director cut', r"\b(?:director['’]s cut|montaje del director|muntatge del director)\b"),
        ('edition', 'double bill', r'\b(?:double bill|programa doble|doble programa)\b'),
    )
    for field, fact, pattern in patterns:
        if re.search(pattern, label, re.I):
            value.append({'field': field, 'value': fact, 'source_url': source,
                          'checked_at': session.get('schedule_fetched_at'), 'session_id': session['id']})
    return value


def confirmed_no_subtitles(session):
    explicit = ' '.join(str(session.get(k) or '') for k in ('raw_attributes', 'source_version', 'subtitles'))
    return bool(re.search(r'\b(?:nosubt|no subtitles|without subtitles|sin subt[ií]tulos|sense subt[ií]tols)\b', explicit, re.I))


def public_venue_answers(research):
    """Keep research scope, conflicts, dates and source attribution together."""
    sources = research.get('sources', {})
    rows = []
    claims = research.get('claims', {})
    for venue in research.get('venues', []):
        answers = []
        for answer in venue.get('answers', []):
            passages = []
            for claim_id in answer.get('claim_ids', []):
                claim = claims.get(claim_id, {})
                text = claim.get('value')
                if not isinstance(text, str) or not text.strip():
                    continue
                links = [{'title': sources[s].get('title', 'Source'), 'url': sources[s]['url']}
                         for s in claim.get('source_ids', []) if s in sources and
                         str(sources[s].get('url', '')).startswith('https://')]
                if not links:
                    continue
                passages.append({'text': text[:1800], 'scope': claim.get('scope_note') or claim.get('scope', ''),
                                 'status': claim.get('status', 'reported'), 'checked_at': claim.get('observed_on'),
                                 'sources': links[:2], 'conflicting': claim_id in answer.get('conflicting_claim_ids', [])})
            if passages:
                answers.append({'topic': answer['question_id'], 'passages': passages[:6],
                                'unresolved': answer.get('unresolved', [])[:2]})
        if answers:
            rows.append({'id': venue['id'], 'name': venue['name'], 'official_url': venue.get('official_url'), 'answers': answers})
    return rows
