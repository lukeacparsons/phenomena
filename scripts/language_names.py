"""Exact language labels, with lossless handling of unfamiliar source values.

This is deliberately not language detection. Names must come from an audio
field, never from a title, country, synopsis, or subtitle field.
"""
import re
import unicodedata


def fold(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or ''))
                   if not unicodedata.combining(c)).casefold().strip()


def without_language_placeholder(value):
    """Generic provider categories are not audio-language evidence."""
    return None if fold(value) in ('', 'otras lenguas', 'otros idiomas', 'altres llengues',
                                  'altres idiomes', 'other languages', 'unknown', 'und') else value


# ISO 639 codes; distinguish Chinese varieties rather than erase specificity.
LABELS = {
    'es': 'Spanish|spa|esp|cas|castellano|castellà|español|espanyol|European Spanish|Latin American Spanish',
    'ca': 'Catalan|cat|català|catalán|valencià|valenciano|Catalan/Valencian',
    'en': 'English|eng|ang|inglés|anglès|British English|American English',
    'fr': 'French|fra|fre|français|francés|francès|Canadian French|French (France)|French (Canada)',
    'de': 'German|deu|ger|alemán|alemany|alem', 'it': 'Italian|ita|italiano|italià',
    'ja': 'Japanese|jpn|japonés|japonès', 'ko': 'Korean|kor|coreano|coreà',
    'pt': 'Portuguese|por|portugués|portuguès|Brazilian Portuguese|Portuguese (Brazil)',
    'eu': 'Basque|eus|baq|euskera|basc|vasco', 'gl': 'Galician|glg|gallego|gallec',
    'zh': 'Chinese|zho|chi|chino|xinès', 'cmn': 'Mandarin|Mandarin Chinese|mandarín|mandarí',
    'yue': 'Cantonese|cantonés|cantonès', 'ar': 'Arabic|ara|árabe|àrab',
    'ru': 'Russian|rus|ruso', 'hi': 'Hindi|hin', 'fa': 'Persian|fas|per|persa|farsi',
    'sv': 'Swedish|swe|sueco|suec', 'no': 'Norwegian|nor|noruego|noruec',
    'nb': 'Norwegian Bokmål|nob|bokmål', 'nn': 'Norwegian Nynorsk|nno|nynorsk',
    'da': 'Danish|dan|danés|danès', 'fi': 'Finnish|fin|finés|finlandés|finès',
    'is': 'Icelandic|isl|ice|islandés|islandès', 'nl': 'Dutch|nld|dut|neerlandés|neerlandès|holandés|holandès',
    'he': 'Hebrew|heb|hebreo|hebreu', 'pl': 'Polish|pol|polaco|polonès',
    'uk': 'Ukrainian|ukr|ucraniano|ucraïnès', 'cs': 'Czech|ces|cze|checo|txec',
    'sk': 'Slovak|slk|slo|eslovaco|eslovac', 'hu': 'Hungarian|hun|húngaro|hongarès',
    'ro': 'Romanian|ron|rum|rumano|romanès', 'bg': 'Bulgarian|bul|búlgaro|búlgar',
    'el': 'Greek|ell|gre|griego|grec', 'tr': 'Turkish|tur|turco|turc',
    'hr': 'Croatian|hrv|croata', 'sr': 'Serbian|srp|serbio|serbi',
    'bs': 'Bosnian|bos|bosnio|bosnià', 'sl': 'Slovenian|slv|esloveno|eslovè',
    'sq': 'Albanian|sqi|alb|albanés|albanès', 'mk': 'Macedonian|mkd|mac|macedonio|macedoni',
    'ka': 'Georgian|kat|geo|georgiano|georgià', 'hy': 'Armenian|hye|arm|armenio|armeni',
    'et': 'Estonian|est|estonio|estonià', 'lv': 'Latvian|lav|letón|letó',
    'lt': 'Lithuanian|lit|lituano|lituà', 'ga': 'Irish|gle|irlandés|irlandès',
    'cy': 'Welsh|cym|wel|galés|gal·lès', 'gd': 'Scottish Gaelic|gla|gaèlic escocès',
    'ur': 'Urdu|urd|urdú', 'bn': 'Bengali|ben|bengalí', 'pa': 'Punjabi|pan|punyabí|panjabi',
    'ta': 'Tamil|tam|tàmil', 'te': 'Telugu|tel', 'ml': 'Malayalam|mal',
    'mr': 'Marathi|mar|maratí', 'kn': 'Kannada|kan', 'gu': 'Gujarati|guj',
    'ne': 'Nepali|nep|nepalés|nepalès', 'si': 'Sinhala|sin|cingalés|singalès',
    'th': 'Thai|tha|tailandés|tailandès', 'vi': 'Vietnamese|vie|vietnamita',
    'id': 'Indonesian|ind|indonesio|indonesi', 'ms': 'Malay|msa|may|malayo|malai',
    'tl': 'Tagalog|tgl|tagalo|tagàlog', 'fil': 'Filipino|filipí',
    'km': 'Khmer|khm|jemer', 'lo': 'Lao|lao|laosiano|laosià',
    'my': 'Burmese|mya|bur|birmano|birmà', 'mn': 'Mongolian|mon|mongol',
    'bo': 'Tibetan|bod|tib|tibetano|tibetà', 'ku': 'Kurdish|kur|kurdo|kurd',
    'ps': 'Pashto|pus|pastún', 'az': 'Azerbaijani|aze|azerí',
    'kk': 'Kazakh|kaz|kazajo|kazakh', 'uz': 'Uzbek|uzb|uzbeko',
    'sw': 'Swahili|swa|suajili|suahili', 'wo': 'Wolof|wol',
    'am': 'Amharic|amh|amhárico|amhàric', 'so': 'Somali|som|somalí',
    'ha': 'Hausa|hau', 'yo': 'Yoruba|yor', 'ig': 'Igbo|ibo',
    'zu': 'Zulu|zul|zulú', 'xh': 'Xhosa|xho', 'af': 'Afrikaans|afr|afrikáans',
    'la': 'Latin|lat|latín|llatí', 'oc': 'Occitan|oci|occitano|occità',
    'qu': 'Quechua|que|quítxua', 'gn': 'Guarani|grn|guaraní',
    'ht': 'Haitian Creole|hat|criollo haitiano|crioll haitià',
    'ase': 'American Sign Language|ASL', 'bfi': 'British Sign Language|BSL',
    'csc': 'Catalan Sign Language|llengua de signes catalana',
    'ssp': 'Spanish Sign Language|lengua de signos española',
    'zxx': 'No spoken language|no dialogue|sin diálogos|sense diàlegs|sense diàleg|sin diálogo',
}
LANGUAGE_NAMES = {code: labels.split('|')[0] for code, labels in LABELS.items()}
ALIASES = {fold(label): code for code, labels in LABELS.items() for label in [code, *labels.split('|')]}


def language_code(value):
    return ALIASES.get(fold(value).strip(' ,.;'))


def parse_languages(value):
    """Return both known codes and unrecognised labels; never pretend partial is complete."""
    values = value if isinstance(value, (list, tuple)) else [value]
    codes, unknown = [], []
    for raw in values:
        if not raw:
            continue
        # Some names contain slashes. Recognise the entire name first.
        parts = [str(raw)] if language_code(raw) else re.split(
            r'\s*[,;/&+]\s*|\s+(?:y|i|and|et|e)\s+', str(raw).strip(' .,:;'), flags=re.I)
        for part in parts:
            code = language_code(part)
            if code:
                if code not in codes: codes.append(code)
            elif part.strip() and part.strip() not in unknown:
                unknown.append(part.strip())
    return {'codes': codes, 'unknown': unknown, 'complete': bool(codes) and not unknown}


def language_codes(value):
    return parse_languages(value)['codes']
