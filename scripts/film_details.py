"""Collect searchable film facts from exact-identity publisher pages and Wikidata."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from html.parser import HTMLParser
import json
import re
import unicodedata
from urllib.parse import urlencode

from cinesa_showtimes import atomic_write
from original_audio import language_code
from film_synopsis import clean_synopsis, unique_synopses
from film_countries import canonical as country_name, resolve as resolve_countries, filter_aliases as filter_country_aliases

VERSION = 1
WIKIDATA_VERSION = 4
SEARCH_CONTENT_VERSION = 3
LIST_FIELDS = ("directors", "writers", "cast", "producers", "composers", "cinematographers", "editors",
               "genres", "topics", "colours", "countries", "languages", "studios", "distributors", "based_on", "source_authors")
PROPERTIES = {"P57": "directors", "P58": "writers", "P161": "cast", "P725": "cast", "P162": "producers", "P86": "composers",
              "P344": "cinematographers", "P1040": "editors", "P136": "genres", "P495": "countries",
              "P364": "languages", "P272": "studios", "P750": "distributors", "P144": "based_on", "P462": "colours"}
GENRES = {
    "Science fiction": ["Sci-Fi", "scifi", "science fiction film", "Ciencia ficción", "Ciència-ficció"],
    "Action": ["action film", "Acción", "Acció"], "Adventure": ["adventure film", "Aventuras", "Aventures"],
    "Animation": ["animated film", "Animación", "Animació"], "Anime": ["anime film"], "Comedy": ["comedy film", "Comedia", "Comèdia"],
    "Drama": ["drama film"], "Documentary": ["documentary film", "Documental"],
    "Fantasy": ["fantasy film", "Fantástico", "Fantàstic"], "Horror": ["horror film", "Terror"],
    "Thriller": ["thriller film", "Suspense", "Suspens"], "Mystery": ["mystery film", "Misterio", "Misteri"],
    "Romance": ["romance film", "romantic film", "Romántico", "Romàntic"], "Musical": ["musical film"],
    "War": ["war film", "Bélico", "Bèl·lic"], "Western": ["western film"], "Family": ["family film", "Familiar"]}
GENRE_NAMES = {alias.casefold(): name for name, aliases in GENRES.items() for alias in [name, *aliases]}
LANGUAGE_VARIANTS = {"british english": "English", "american english": "English",
    "european spanish": "Spanish", "latin american spanish": "Spanish",
    "french (france)": "French", "french (canada)": "French", "canadian french": "French",
    "brazilian portuguese": "Portuguese", "portuguese (brazil)": "Portuguese"}


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def unique(values):
    result, seen = [], set()
    for value in values:
        value = clean(value)
        key = "".join(c for c in unicodedata.normalize("NFD", value.casefold()) if not unicodedata.combining(c))
        if value and key not in seen:
            result.append(value)
            seen.add(key)
    return result


class Node:
    def __init__(self, tag="", attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def text(self):
        return clean(" ".join(child.text() if isinstance(child, Node) else child for child in self.children))

    def find(self, tag=None, **attrs):
        result = []
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and all(child.attrs.get(k) == v for k, v in attrs.items()):
                    result.append(child)
                result.extend(child.find(tag, **attrs))
        return result


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, html):
        super().__init__()
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, value):
        self.stack[-1].children.append(value)


def movie_node(document):
    movies = []
    for node in document.find("script", type="application/ld+json"):
        try:
            value = json.loads(node.text())
        except ValueError:
            continue
        nodes = value if isinstance(value, list) else value.get("@graph", [value]) if isinstance(value, dict) else []
        movies.extend(n for n in nodes if isinstance(n, dict) and n.get("@type") == "Movie")
    if len(movies) != 1:
        raise ValueError("Expected one film metadata record")
    return movies[0]


def duration(value):
    value = clean(value)
    hours = re.search(r"(\d+)\s*h", value, re.I)
    minutes = re.search(r"(\d+)\s*m", value, re.I)
    total = (int(hours[1]) * 60 if hours else 0) + (int(minutes[1]) if minutes else 0)
    return total if 0 < total < 1000 else None


def parse_rt(html):
    doc = Document(html).root
    movie = movie_node(doc)
    facts = {}
    for source, field in (("director", "directors"), ("actor", "cast"), ("producer", "producers")):
        values = movie.get(source) or []
        if isinstance(values, dict):
            values = [values]
        facts[field] = unique(v.get("name") for v in values if isinstance(v, dict))
    genres = movie.get("genre") or []
    facts["genres"] = unique(genres if isinstance(genres, list) else [genres])
    synopsis = next((clean_synopsis(node.text()) for node in doc.find(**{"data-qa": "synopsis-value"}) if clean_synopsis(node.text())), '')
    synopsis = synopsis or clean_synopsis(movie.get("description"))
    if synopsis:
        facts["synopsis"] = synopsis
    if movie.get("contentRating"):
        facts["certification"] = clean(movie["contentRating"])
    labels = {"Director": "directors", "Screenwriter": "writers", "Producer": "producers", "Distributor": "distributors",
              "Original Language": "languages", "Production Co": "studios", "Genre": "genres"}
    for group in doc.find(**{"data-qa": "item"}):
        label = group.find(**{"data-qa": "item-label"})
        values = [n.text() for n in group.find(**{"data-qa": "item-value"})]
        if not label or not values:
            continue
        label = label[0].text()
        if label in labels:
            facts[labels[label]] = unique([*facts.get(labels[label], []), *values])
        elif label == "Runtime":
            facts["runtime_minutes"] = duration(values[0])
        elif label in ("Release Date (Theaters)", "Release Date (Streaming)"):
            match = re.search(r"\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b", values[0])
            if match:
                date = datetime.strptime(match[0], "%b %d, %Y").date().isoformat()
                facts.setdefault("release_dates", []).append({"date": date, "region": "United States",
                    "kind": "theatrical" if label.endswith("(Theaters)") else "streaming"})
    return facts


def parse_fa(html):
    doc = Document(html).root
    if not doc.find(id="main-title"):
        raise ValueError("FilmAffinity film page not found")
    facts = {}
    fields = {"Dirección": "directors", "Reparto": "cast", "Música": "composers", "Fotografía": "cinematographers",
              "Compañías": "studios", "Género": "genres"}
    for term in doc.find("dt"):
        siblings = term.parent.children
        following = [n for n in siblings[siblings.index(term) + 1:] if isinstance(n, Node)]
        if not following or following[0].tag != "dd":
            continue
        label, value = term.text(), following[0]
        if label in fields:
            # Only film credits; exclude the full-credits navigation link.
            links = [n.text() for n in value.find("a") if "name.php?" in n.attrs.get("href", "")]
            if label == "Género":
                links = [n.text() for n in value.find(itemprop="genre")]
                facts['topics'] = unique(n.text() for n in value.find('a') if 'movietopic.php?' in n.attrs.get('href', ''))
            elif label == "Compañías":
                coproduction = re.match(r'Coproducci[oó]n\s+([^;]+);', value.text())
                if coproduction:
                    facts['countries'] = [country_name(c) for c in coproduction[1].split('-') if c.strip()]
                    facts['country_evidence'] = 'explicit_coproduction'
                links = []
                role = 'production'
                for node in value.find():
                    if node.tag == "i":
                        role = 'distribution' if re.search(r'Distribuidora', node.text(), re.I) else 'other'
                        continue
                    if node.tag == "a" and "name.php?" in node.attrs.get("href", ""):
                        if role == 'distribution':
                            facts.setdefault('distributors', []).append(node.text())
                        elif role == 'production':
                            links.append(node.text())
            facts[fields[label]] = unique(links)
        elif label == "Guion":
            facts["writers"], facts["source_authors"] = [], []
            field = "writers"
            for node in value.find():
                if node.tag == "i" and re.search(r"novela|obra|cómic|comic|personajes|relato", node.text(), re.I):
                    field = "source_authors"
                if node.tag == "a" and "name.php?" in node.attrs.get("href", ""):
                    facts[field].append(node.text())
        elif label == "País":
            facts.setdefault('countries', [country_name(value.text())])
            facts.setdefault('country_evidence', 'explicit_production_country')
        elif label == "Duración":
            facts["runtime_minutes"] = duration(value.text())
        elif label == "Sinopsis":
            facts["synopsis"] = value.text()[:4000]
        elif label == "Año" and re.fullmatch(r"\d{4}", value.text()):
            facts["release_year"] = int(value.text())
    return facts


def wikidata_query(ids):
    properties = " ".join("wdt:" + prop for prop in PROPERTIES)
    return '''SELECT ?imdb ?item ?property ?value ?valueLabel ?esLabel ?caLabel ?precision ?placeLabel ?referenceURL ?statedIn WHERE {
      VALUES ?imdb { %s } ?item wdt:P345 ?imdb.
      { VALUES ?property { %s } ?item ?property ?value.
        OPTIONAL { FILTER(?property = wdt:P495)
          ?item p:P495 ?countryStatement. ?countryStatement ps:P495 ?value; prov:wasDerivedFrom ?reference.
          FILTER NOT EXISTS { ?countryStatement wikibase:rank wikibase:DeprecatedRank }
          OPTIONAL { ?reference pr:P854 ?referenceURL. }
          OPTIONAL { ?reference pr:P248 ?statedIn. }
        }
        OPTIONAL { ?value rdfs:label ?valueLabel. FILTER(LANG(?valueLabel)="en") }
        OPTIONAL { ?value rdfs:label ?esLabel. FILTER(LANG(?esLabel)="es") }
        OPTIONAL { ?value rdfs:label ?caLabel. FILTER(LANG(?caLabel)="ca") }
      } UNION {
        ?item p:P577 ?statement. ?statement psv:P577 ?dateNode. FILTER NOT EXISTS { ?statement wikibase:rank wikibase:DeprecatedRank }
        ?dateNode wikibase:timeValue ?value; wikibase:timePrecision ?precision.
        BIND(wdt:P577 AS ?property)
        OPTIONAL { ?statement pq:P291 ?place. ?place rdfs:label ?placeLabel. FILTER(LANG(?placeLabel)="en") }
      }
    }''' % (" ".join(json.dumps(imdb) for imdb in ids), properties)


def parse_wikidata(rows):
    grouped = {}
    for row in rows:
        value = {k: v.get("value") for k, v in row.items()}
        imdb, item = value.get("imdb"), value.get("item")
        if not re.fullmatch(r"tt\d{7,10}", imdb or "") or not re.fullmatch(r"https?://www.wikidata.org/entity/Q\d+", item or ""):
            continue
        entry = grouped.setdefault(imdb, {"items": set(), "facts": {}})
        entry["items"].add(item)
        facts, prop = entry["facts"], (value.get("property") or "").rsplit("/", 1)[-1]
        if prop in PROPERTIES:
            label = value.get("valueLabel") or value.get("esLabel") or value.get("caLabel")
            if label:
                facts.setdefault(PROPERTIES[prop], []).append(label)
                if prop == 'P495' and (value.get('referenceURL') or value.get('statedIn')):
                    facts.setdefault('country_claims', []).append({'country': label,
                        'reference_url': value.get('referenceURL'), 'stated_in': value.get('statedIn')})
                if PROPERTIES[prop] != "producers":
                    facts.setdefault("search_aliases", []).extend(value.get(key) for key in ("valueLabel", "esLabel", "caLabel"))
        elif prop == "P577":
            raw, precision = value.get("value") or "", int(value.get("precision") or 0)
            if re.match(r"\d{4}-\d{2}-\d{2}T", raw) and precision >= 9:
                date = raw[:10] if precision >= 11 else raw[:7] if precision == 10 else raw[:4]
                facts.setdefault("release_dates", []).append({"date": date, "region": value.get("placeLabel"), "kind": "release"})
    return {imdb: {"url": next(iter(entry["items"])).replace("http:", "https:"), "facts": entry["facts"]}
            for imdb, entry in grouped.items() if len(entry["items"]) == 1}


def fresh(record, now, hours):
    try:
        return timedelta(0) <= now - datetime.fromisoformat(record.get("attempted_at") or record["checked_at"]) < timedelta(hours=hours)
    except (KeyError, TypeError, ValueError):
        return False


def failure(old, url, now, error):
    previous = old if old.get("url") == url else {}
    return {**previous, "url": url, "status": "stale" if previous.get("facts") else "unavailable",
            "attempted_at": now.isoformat(), "last_error": error}


def filter_language_aliases(details, aliases):
    """Keep superseded catalogue language claims out of the flat search index.

    Country/credit matches remain independent, and the source reports are kept
    for inspection. In particular, a Spanish subtitle label is not English
    film audio, and an extra Wikidata language must not override a publisher.
    """
    def key(value):
        value = LANGUAGE_VARIANTS.get(clean(value).casefold(), value)
        return language_code(value) or clean(value).casefold()
    selected = {key(v) for v in details.get("languages", [])}
    reported = {key(v) for r in details.get("language_reports", []) for v in r["languages"]}
    other_facts = {key(v) for field in LIST_FIELDS if field not in ("languages", "producers") for v in details.get(field, [])}
    excluded = reported - selected - other_facts
    return unique(v for v in aliases if key(v) not in excluded)


def combine(sources, imdb=None):
    facts = {name: record.get("facts", {}) for name, record in sources.items()}
    result = {}
    for field in LIST_FIELDS:
        choices = [facts.get(name, {}).get(field, []) for name in ("rotten_tomatoes", "filmaffinity", "wikidata")]
        if field in ("genres", "countries", "languages"):
            # Prefer English taxonomy; keep every source's terms as search aliases.
            order = ("rotten_tomatoes", "wikidata", "filmaffinity") if field in ("genres", "languages") else ("wikidata", "rotten_tomatoes", "filmaffinity")
            values = next((facts.get(name, {}).get(field) for name in order if facts.get(name, {}).get(field)), [])
        elif field == 'distributors':
            # Different territories legitimately have different distributors.
            # Keep every explicit credit, including a sole RT distributor.
            values = [value for choice in choices for value in choice]
        else:
            # Use the fullest credit list, avoiding duplicate shortened/full names across sites.
            values = max(choices, key=len)
        result[field] = unique(GENRE_NAMES.get(value.casefold(), value) for value in values) if field == "genres" else unique(values)
        if field == "languages":
            result[field] = unique(LANGUAGE_VARIANTS.get(value.casefold(), value) for value in result[field])
    # RT's explicitly labelled Original Language field takes precedence over
    # an unranked catalogue list. Never select the first language from a list
    # or infer audio from nationality, title language, VOSE or subtitles.
    result["language_reports"] = [{"source": name, "source_url": r["url"],
        "languages": unique(r["facts"]["languages"]), "checked_at": r.get("checked_at"), "status": r["status"]}
        for name, r in sources.items() if r.get("facts", {}).get("languages")]
    selected = next((name for name in ("rotten_tomatoes", "wikidata", "filmaffinity") if facts.get(name, {}).get("languages")), None)
    if selected:
        result["language_selection"] = {"source": selected, "source_url": sources[selected]["url"],
            "evidence": "catalogue_language_list" if selected == "wikidata" else "explicit_original_language"}
    result['synopses'] = unique_synopses(facts.get(name, {}).get('synopsis') for name in ('rotten_tomatoes', 'filmaffinity', 'wikidata'))
    if result['synopses']:
        result['synopsis'] = result['synopses'][0]
    for field in ("runtime_minutes", "certification", "release_year"):
        value = next((facts.get(name, {}).get(field) for name in ("rotten_tomatoes", "filmaffinity", "wikidata") if facts.get(name, {}).get(field)), None)
        if value is not None:
            result[field] = value
    dates, seen = [], set()
    for source, record in sources.items():
        for date in record.get("facts", {}).get("release_dates", []):
            key = (date["date"], date.get("region"), date.get("kind"))
            generic = (key[0], key[1], "release")
            if key[2] == "release" and (key[0], key[1], "theatrical") in seen:
                continue
            if key[2] == "theatrical" and generic in seen:
                dates = [d for d in dates if (d["date"], d.get("region"), d.get("kind")) != generic]
                seen.remove(generic)
            if key not in seen:
                dates.append({**date, "source_url": record["url"]})
                seen.add(key)
    result["release_dates"] = sorted(dates, key=lambda d: (d["date"], d.get("region") or "", d.get("kind") or ""))
    search_fields = tuple(field for field in LIST_FIELDS if field != "producers")
    def name_key(value):
        return " ".join(re.sub(r"[^\w]+", " ", "".join(c for c in unicodedata.normalize("NFD", value.casefold())
                                                      if not unicodedata.combining(c))).split())
    searchable_names = {name_key(v) for record in facts.values() for field in search_fields for v in record.get(field, [])}
    producer_only = {name_key(v) for record in facts.values() for v in record.get("producers", [])} - searchable_names
    # Cached source aliases can still contain producer credits. Exclude those too,
    # unless another source credits the same person in a searchable role.
    result["search_aliases"] = unique(v for record in facts.values() for field in (*search_fields, "search_aliases")
                                      for v in record.get(field, []) if v and name_key(v) not in producer_only)
    for genre in result["genres"]:
        result["search_aliases"] = unique([*result["search_aliases"], genre, *GENRES.get(genre, [])])
    result["search_aliases"] = filter_language_aliases(result, result["search_aliases"])
    result.update(resolve_countries(sources, imdb))
    result['search_aliases'] = filter_country_aliases(result, result['search_aliases'])
    result['search_aliases'] = unique([*result['search_aliases'], *result['countries']])
    result["sources"] = [{"name": name, "url": r["url"], "checked_at": r.get("checked_at"), "status": r["status"]}
                         for name, r in sources.items() if r.get("facts")]
    return result


def enrich(data, output, mappings, fetch, now, *, force=False):
    manifest = output / "film-details.json"
    try:
        previous = json.loads(manifest.read_text())
    except (OSError, ValueError):
        previous = {}
    records, jobs, pending = {}, [], []
    for film in data["films"]:
        imdb = film.get("imdb_id")
        if not imdb:
            # Preserve independently sourced language evidence, not unrelated
            # IMDb credits left over after an identity was withdrawn.
            from language_evidence import FIELDS
            prior = film.get('details', {})
            film['details'] = {key: prior[key] for key in FIELDS if key in prior}
            continue
        old = previous.get("films", {}).get(imdb, {}) if previous.get("version") == VERSION else {}
        records[imdb] = dict(old)
        # Upcoming films may change their release/credit information; revisit daily.
        hours = 24 if (film.get("release_year") or now.year) >= now.year else 168
        wd = old.get("wikidata", {})
        if force or wd.get("schema_version") != WIKIDATA_VERSION or not fresh(wd, now, 1 if wd.get("status") in ("stale", "unavailable") else hours):
            pending.append(imdb)
        for provider in ("rotten_tomatoes", "filmaffinity"):
            url = mappings.get(imdb, {}).get(provider)
            if not url:
                records[imdb].pop(provider, None)
                continue
            cached = old.get(provider, {})
            if force or cached.get("synopsis_version") != SEARCH_CONTENT_VERSION or cached.get("url") != url or not fresh(cached, now, 1 if cached.get("status") in ("stale", "unavailable") else hours):
                jobs.append((imdb, provider, url, cached))
    def retrieve_wikidata(ids):
        try:
            raw = json.loads(fetch("https://query.wikidata.org/sparql?" + urlencode({"query": wikidata_query(ids), "format": "json"})))
            found = parse_wikidata(raw["results"]["bindings"])
            results = {}
            for imdb in ids:
                record = found.get(imdb, {})
                url = record.get("url") or mappings.get(imdb, {}).get("identity_source")
                results[imdb] = {**record, "url": url, "checked_at": now.isoformat(), "schema_version": WIKIDATA_VERSION, "status": "ok" if record else "unmatched"}
            return results
        except Exception as error:
            if len(ids) > 1:
                middle = len(ids) // 2
                return {**retrieve_wikidata(ids[:middle]), **retrieve_wikidata(ids[middle:])}
            imdb = ids[0]
            return {imdb: {**failure(records[imdb].get("wikidata", {}), mappings.get(imdb, {}).get("identity_source"), now, type(error).__name__), "schema_version": WIKIDATA_VERSION}}

    if pending or jobs:
        print(f"Film details: {len(pending)} identity lookups, {len(jobs)} publisher pages", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for found in pool.map(retrieve_wikidata, [pending[start:start + 6] for start in range(0, len(pending), 6)]):
            for imdb, record in found.items():
                records[imdb]["wikidata"] = record

    def retrieve(job):
        imdb, provider, url, old = job
        try:
            facts = (parse_rt if provider == "rotten_tomatoes" else parse_fa)(fetch(url).decode("utf-8"))
            record = {"url": url, "facts": facts, "checked_at": now.isoformat(), "status": "ok", "synopsis_version": SEARCH_CONTENT_VERSION}
        except Exception as error:
            record = failure(old, url, now, type(error).__name__)
        return imdb, provider, record

    with ThreadPoolExecutor(max_workers=4) as pool:
        for imdb, provider, record in pool.map(retrieve, jobs):
            records[imdb][provider] = record
    for film in data["films"]:
        if film.get("imdb_id"):
            old_details = film.get('details', {})
            film["details"] = combine(records[film["imdb_id"]], film['imdb_id'])
            if not film['details'].get('languages') and old_details.get('languages'):
                from language_evidence import FIELDS
                for field in FIELDS:
                    if field in old_details: film['details'][field] = old_details[field]
    # Cinema film pages can explicitly identify languages even when publishers
    # omit them or no global film identity has been resolved yet.
    from cinema_languages import enrich as enrich_cinema_languages
    cinema_languages = enrich_cinema_languages(data, output, fetch, now, force=force,
                                               discover_sources=True, use_tmdb=True)
    result = {"version": VERSION, "checked_at": now.isoformat(), "films": records,
              "has_failures": cinema_languages['has_failures'] or any(r.get("status") in ("stale", "unavailable") for sources in records.values() for r in sources.values()),
              "coverage": {field: sum(bool(f.get("details", {}).get(field)) for f in data["films"]) for field in (*LIST_FIELDS, "release_dates")}}
    atomic_write(manifest, result)
    return result
