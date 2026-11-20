"""Keep story text while rejecting publisher SEO descriptions in older caches."""
from html import unescape
import re


def clean_synopsis(value):
    if not isinstance(value, str):
        return ''
    text = re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', value))).strip()
    if re.search(r'discover reviews,? ratings|stay updated with critic and audience|watch trailers.*read.*reviews', text, re.I):
        return ''
    return text[:4000]


def unique_synopses(values):
    return list(dict.fromkeys(text for value in values if (text := clean_synopsis(value))))[:6]
