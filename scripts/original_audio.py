"""Conservative, source-backed original-audio qualification.

A language name alone is never proof of original audio. Explicit dubbing wins
over every other signal. Subtitle language and original audio are independent.
"""
import re
from language_names import fold, language_code, language_codes, LANGUAGE_NAMES, without_language_placeholder


def original_audio(version, *, audio=None, original=None, subtitles=None, evidence=None):
    label = fold(version)
    compact = re.sub(r'(?<=\w)\.(?=\w)|\.(?=\s|$)', '', label)
    if re.search(r'\b(?:doblad\w*|doblat\w*|dob\b|dubb\w*|vde|vdc|doe|doc)\b', compact):
        return None
    if language_code(audio) and language_code(original) and language_code(audio) != language_code(original):
        return None
    explicit = bool(re.search(r'\b(?:vo(?:s(?:e|c|i|a|cat|cast)?|e|c|cat|catalan)?|versio[n]? original|original)\b', compact))
    silent = bool(re.search(r'\b(?:sense dialegs|sin dialogos|sense so|muda? amb intertitols|silent)\b', compact))
    same = bool(language_code(audio) and language_code(audio) == language_code(original))
    if not (explicit or silent or same):
        return None
    sub = subtitles or None
    code = language_code(sub)
    if re.search(r'\bvose\b', compact) or ('sub' in compact and re.search(r'castell|espan', compact)):
        sub, code = 'Español', 'es'
    elif re.search(r'\b(?:vosc|voscat)\b', compact) or ('sub' in compact and 'catal' in compact):
        sub, code = 'Català', 'ca'
    elif re.search(r'\b(?:vosi|vosa)\b', compact) or ('sub' in compact and re.search(r'ingles|angles', compact)):
        sub, code = 'English', 'en'
    if fold(sub) in ('sin subtitulos', 'sense subtitols', 'nosubt', 'none'):
        sub, code = None, None
    tag = {'es': 'VOSE', 'ca': 'VOSC', 'en': 'VOSI'}.get(code, 'Silent' if silent else 'VO')
    return {'original_audio': True, 'version': tag, 'source_version': str(version or ''),
            'language': without_language_placeholder(audio) or without_language_placeholder(original),
            'screening_audio': without_language_placeholder(audio) or without_language_placeholder(original), 'subtitles': sub,
            'original_language_raw': original,
            'original_language_evidence': 'explicit_original_language' if original else None,
            'original_audio_evidence': evidence or ('explicit_original_version' if explicit or silent else 'audio_matches_original_language')}


def a1_audio(event):
    # Variant-specific dubbing labels take precedence over film-level metadata.
    label = ' '.join(str(event.get(k) or '') for k in ('version', 'wprovinceversio', 'wfeatureversion'))
    label += ' ' + ' '.join(re.findall(r'\(([^)]+)\)', event.get('locale_title') or ''))
    return original_audio(label, audio=event.get('language') or language_code(event.get('version')),
                          original=event.get('woriginalversio'),
                          subtitles=event.get('subtitles_lang') or event.get('wlanguagesubtitles'))


def original_language_registry(payloads):
    """Exact IMDb identity only; never infer originals from translated titles."""
    values = {}
    for payload in payloads:
        for event in payload['result']:
            imdb = event.get('imdbid', '')
            language = language_code(event.get('woriginalversio'))
            if re.fullmatch(r'tt\d{7,10}', imdb) and language:
                values.setdefault(imdb, set()).add(language)
    return {key: next(iter(languages)) for key, languages in values.items() if len(languages) == 1}
