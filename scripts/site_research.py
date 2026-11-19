"""Reviewed translations of published research, separate from source evidence.

Exact source text is the lookup key. Changed or new prose needs a new translation;
an older translation must never silently describe a different fact. Names, format
brands, addresses and bibliographic source titles retain their source spelling.
"""
import json
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[1] / 'data/site-research-translations.json'


class ResearchTranslations:
    def __init__(self, path=CATALOGUE):
        self.entries = json.loads(Path(path).read_text())['translations']

    def translate(self, value, lang):
        source = str(value or '').strip()
        if not source or lang == 'en':
            return source
        translated = self.entries.get(source, {}).get(lang)
        if not isinstance(translated, str) or not translated.strip():
            raise ValueError(f'Missing {lang} research translation: {source}')
        return translated
