"""Resolve production countries from explicit credits, retaining claim evidence."""
from functools import lru_cache
import json
from pathlib import Path
import unicodedata

VERSION = 1


def key(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value).casefold()) if not unicodedata.combining(c)).strip()


NAMES = {
    'España': 'Spain', 'Francia': 'France', 'Italia': 'Italy', 'Estados Unidos': 'United States',
    'Reino Unido': 'United Kingdom', 'Alemania': 'Germany', 'Japón': 'Japan', 'Corea del Sur': 'South Korea',
    'China': 'China', "People's Republic of China": 'China', 'México': 'Mexico', 'Canadá': 'Canada',
    'Brasil': 'Brazil', 'Irán': 'Iran', 'Bélgica': 'Belgium', 'Irlanda': 'Ireland', 'Suecia': 'Sweden',
    'Polonia': 'Poland', 'Suiza': 'Switzerland', 'Hungría': 'Hungary', 'Países Bajos': 'Netherlands',
    'Dinamarca': 'Denmark', 'Noruega': 'Norway', 'Finlandia': 'Finland', 'Islandia': 'Iceland',
    'Grecia': 'Greece', 'Rumanía': 'Romania', 'República Checa': 'Czech Republic', 'Chequia': 'Czech Republic',
    'Rusia': 'Russia', 'Unión Soviética': 'Soviet Union', 'URSS': 'Soviet Union', 'Yugoslavia': 'Yugoslavia',
    'Turquía': 'Turkey', 'Ucrania': 'Ukraine', 'Bulgaria': 'Bulgaria', 'Croacia': 'Croatia',
    'Singapur': 'Singapore', 'Taiwán': 'Taiwan', 'Tailandia': 'Thailand', 'Filipinas': 'Philippines',
    'Indonesia': 'Indonesia', 'Malasia': 'Malaysia', 'Nueva Zelanda': 'New Zealand', 'Sudáfrica': 'South Africa',
    'Egipto': 'Egypt', 'Marruecos': 'Morocco', 'Argelia': 'Algeria', 'Túnez': 'Tunisia', 'Líbano': 'Lebanon',
    'Jordania': 'Jordan', 'Emiratos Árabes Unidos': 'United Arab Emirates', 'Perú': 'Peru',
    'República Centroafricana': 'Central African Republic', 'República Democrática del Congo': 'Democratic Republic of the Congo',
    'República Dominicana': 'Dominican Republic', 'Arabia Saudí': 'Saudi Arabia', 'Arabia Saudita': 'Saudi Arabia',
}
NAMES = {key(k): v for k, v in NAMES.items()}


def canonical(value):
    return NAMES.get(key(value), str(value).strip())


@lru_cache(maxsize=1)
def reviewed_countries():
    return json.loads((Path(__file__).with_name('film_country_evidence.json')).read_text())['films']


def resolve(sources, imdb=None):
    reports, accepted = [], {}

    def accept(country, source, url, evidence, checked_at=None):
        country = canonical(country)
        if country:
            accepted.setdefault(country, []).append(dict(source=source, source_url=url,
                evidence=evidence, checked_at=checked_at))

    for source, record in sources.items():
        facts = record.get('facts', {})
        countries = list(dict.fromkeys(canonical(v) for v in facts.get('countries', [])))
        if countries:
            reports.append(dict(source=source, source_url=record.get('url'), countries=countries))
        if source in ('filmaffinity', 'rotten_tomatoes'):
            for country in countries:
                accept(country, source, record.get('url'), facts.get('country_evidence', 'explicit_production_country'), record.get('checked_at'))

    # Wikidata alone is not corroboration: an imported-from marker is not a
    # supporting reference. Only claims with a reference URL or stated source
    # collected by the country-aware parser can supplement publisher credits.
    wd = sources.get('wikidata', {})
    for claim in wd.get('facts', {}).get('country_claims', []):
        if claim.get('reference_url') or claim.get('stated_in'):
            accept(claim['country'], 'wikidata', claim.get('reference_url') or wd.get('url'),
                   'referenced_country_statement', wd.get('checked_at'))

    reviewed = reviewed_countries().get(imdb)
    if reviewed:
        # A reviewed complete production list takes precedence over conflicting
        # aggregator claims. This is sourced film metadata, not a search boost.
        accepted = {}
        for country in reviewed['countries']:
            accept(country, reviewed['source'], reviewed['source_url'], 'reviewed_production_credits', reviewed['checked_at'])
    excluded = sorted({v for r in reports for v in r['countries']} - accepted.keys())
    return dict(countries=list(accepted), country_reports=reports,
        country_provenance=[dict(country=c, sources=s) for c, s in accepted.items()],
        country_status=dict(state='sourced' if accepted else 'unknown', excluded=excluded, version=VERSION))


def filter_aliases(details, aliases):
    excluded = {key(canonical(v)) for v in details['country_status']['excluded']}
    other = {key(canonical(v)) for field in ('cast', 'directors', 'writers', 'genres', 'topics', 'studios', 'based_on')
             for v in details.get(field, [])}
    return [v for v in aliases if key(canonical(v)) not in excluded - other]
