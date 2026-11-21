"""Resolve films independently of artwork, using published titles and corroborating facts.

Search results only nominate candidates. A title alone never establishes identity.
The small on-disk cache is suitable for the scheduled runner; no API key is needed.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime
import hashlib
import json
from pathlib import Path
import re
import threading
from urllib.parse import quote, urlencode, urlsplit, urljoin

from cinesa_showtimes import atomic_write
from film_details import Document, Node, duration, parse_fa, parse_rt, movie_node
from film_grouping import title_key
from language_names import language_codes, parse_languages

VERSION = 1
API = "https://www.wikidata.org/w/api.php?"
LANGUAGES = ("en", "es", "ca", "mul")
IMDB = re.compile(r"tt\d{7,10}\Z")


def unique(values):
    return list(dict.fromkeys(v for v in values if v not in (None, "")))


def clean_title(value):
    # Programming labels aren't part of the film title. Do not strip arbitrary
    # parentheses, years, sequels, editions, or double bills.
    return re.sub(r"\s*\[(?:Wilder Cinema|Proyecto Viridiana|Loop Festival|Circles - Lesbian Film Festival|Reteena)\]\s*", "", value or "", flags=re.I).strip()


def keys(values):
    return {title_key(clean_title(v)) for v in values if v}


def titles(film):
    return unique([film.get(k) for k in ("english_title", "original_title", "source_title", "title")]
                  + film.get("titles", []) + [s.get("title") for s in film.get("sessions", [])]
                  + [s.get("localized_title") for s in film.get("sessions", [])])


def claims(entity, prop):
    return [s["mainsnak"]["datavalue"]["value"] for s in entity.get("claims", {}).get(prop, [])
            if s.get("rank") != "deprecated" and s.get("mainsnak", {}).get("snaktype") == "value"
            and "datavalue" in s["mainsnak"]]


def entity_titles(entity):
    values = [v["value"] for lang, v in (entity.get("labels") or {}).items() if lang in LANGUAGES]
    values += [v["value"] for lang, rows in (entity.get("aliases") or {}).items() if lang in LANGUAGES for v in rows]
    return unique(values + [v["text"] for v in claims(entity, "P1476")])


def source_urls(film):
    urls = list(film.get('language_source_urls', []))
    for session in film.get("sessions", []):
        provider = session.get("provider")
        if provider == "renoir" and str(session.get("film_id", "")).startswith("/pelicula/"):
            urls.append("https://www.cinesrenoir.com" + session["film_id"])
        elif session.get("film_url"):
            urls.append(session["film_url"])
        elif provider == "zumzeig" and "/cinema/films/" in session.get("source_url", ""):
            urls.append(session["source_url"])
        elif provider in ('institut-francais', 'cinebaix', 'casa-elizalde', 'caixaforum-barcelona',
                          'cinema-capri', 'cccb', 'can-carol', 'filmax', 'malda'):
            url = session.get('source_url', '')
            if len(urlsplit(url).path.strip('/').split('/')) >= 2:
                urls.append(url)
    return unique(urls)


def parse_source(html):
    """Read explicitly labelled film facts, never infer year from a screening."""
    doc = Document(html).root
    # CineBaix repeats a version-code legend on every film page. Its examples
    # "Versió original en català/espanyol" describe codes, not this film.
    for node in doc.find():
        if node.tag not in ('div', 'section', 'aside'): continue
        legend = any(isinstance(child, Node) and child.tag in ('h2', 'h3', 'h4')
                     and title_key(child.text()) in ('tipus de versions', 'tipos de versiones', 'version guide')
                     for child in node.children)
        if legend and node.parent:
            node.parent.children.remove(node)
    facts = {"titles": [], "directors": [], "cast": [], "years": [], "runtimes": [], "languages": [],
             "language_raw": [], "language_unknown": [], "language_evidence": []}
    movies = []
    def visit(value):
        if isinstance(value, list):
            for v in value:
                visit(v)
        elif isinstance(value, dict):
            if value.get("@type") == "Movie":
                movies.append(value)
            for k in ("@graph", "workPerformed", "about", "mainEntity"):
                visit(value.get(k))
    for node in doc.find("script", type="application/ld+json"):
        try:
            visit(json.loads(node.text()))
        except ValueError:
            pass
    # Some cinemas repeat the same movie under every screening Event.
    if len(keys(m.get("name") for m in movies)) == 1:
        movie = movies[0]
        alternate = movie.get("alternateName", [])
        facts["titles"] = unique([movie.get("name")] + (alternate if isinstance(alternate, list) else [alternate]))
        for field, properties in (("directors", ("director", "directors")), ("cast", ("actor", "actors"))):
            for prop in properties:
                rows = movie.get(prop, [])
                rows = rows if isinstance(rows, list) else [rows]
                facts[field].extend(v.get("name") if isinstance(v, dict) else v for v in rows)
        runtime = duration(movie.get("duration"))
        if runtime:
            facts["runtimes"].append(runtime)
        # dateCreated/datePublished may be a local re-release. They are not
        # authoritative production years, so cannot reject an older original.
    text = re.sub(r"\s+", " ", doc.text())
    labels = r"Títol original|Título original|Direcció|Dirección|País|Any|Año|Durada|Duración|Idioma original|Versió|Qualificació|Interpretes|Intérpretes"
    labelled = []
    for node in doc.find():
        if ('table-section-title' in node.attrs.get('class', '').split()
                or 'field-label' in node.attrs.get('class', '').split()):
            label = node.text().strip(' :')
            if re.fullmatch(labels, label, re.I):
                value = node.parent.text()[len(node.text()):].strip(' :')
                if value: labelled.append(label + ': ' + value)
        if node.tag == 'dt':
            label=node.text().strip(' :')
            siblings=node.parent.children
            index=siblings.index(node)
            value=next((n.text() for n in siblings[index+1:] if isinstance(n,Node) and n.tag=='dd'),None)
            if value and re.fullmatch(labels,label,re.I):labelled.append(label+': '+value)
            if value and label in ('Título internacional','Títol internacional'):facts['titles'].append(value)
        # Ohlalà's explicitly labelled director section, not biography prose.
        if 'director-info' in node.attrs.get('class','').split():
            for heading in node.find('h2'):
                facts['directors'].extend(re.split(r'\s+y\s+|\s+i\s+',heading.text()))
    if labelled: text = ' / '.join(labelled) + ' / ' + text
    for match in re.finditer(r"(" + labels + r")\s*:\s*(.*?)(?=(?:" + labels + r")\s*:|/|$)", text, re.I):
        label, value = title_key(match[1]), match[2].strip()
        if label in ("titol original", "titulo original"):
            facts["titles"].append(value)
        elif label in ("direccio", "direccion"):
            facts["directors"].extend(re.split(r"\s*[,;]\s*", value))
        elif label in ("any", "ano") and re.match(r"\d{4}\b", value):
            facts["years"].append(int(value[:4]))
        elif label in ("durada", "duracion") and re.match(r"\d{1,3}", value):
            facts["runtimes"].append(int(re.match(r"\d+", value)[0]))
    # Maldà publishes a compact original-title / country: year / director line.
    compact = re.search(r"«([^»]+)»\s*/[^/]{2,60}:\s*(\d{4})\s*/", text)
    if compact:
        facts["titles"].append(compact[1])
        facts["years"].append(int(compact[2]))
    runtime = re.search(r"/\s*(\d{2,3})\s*min\b", text)
    if runtime:
        facts["runtimes"].append(int(runtime[1]))
    # Original audio may contain several languages. Subtitle phrases are a
    # separate field, including Maldà's comma-separated "subtitulos en ...".
    stops = r"(?:con\s+|amb\s+)?subt[ií]t(?:ulos|ols|ulad[aoe]s?)|subtitles|Versi[oó](?:n)?|Estreno|Qualificaci[oó](?:n)?|Sinopsi[s]?|Direcci[oó](?:n)?|Duraci[oó](?:n)?|Durada|Pa[ií]s|Any|Año|Runtime|Director|Country|Year|Format|Festivals|No recom\w+|Para todos|Una producci[oó]"
    for language in re.finditer(r"\b(?:Idiomas? originales?\s*:?|Idioma original\s*:?|Original languages?\s*:?|Versi[oó](?:n)? original en)\s*"
                               r"(.{1,200}?)(?=\s*(?:" + stops + r")\b|[.]|$)", text, re.I):
        raw = language[1].strip(' ,;/')
        parsed = parse_languages(raw)
        facts['language_raw'].append(raw)
        facts["languages"].extend(parsed['codes'])
        facts['language_unknown'].extend(parsed['unknown'])
        facts['language_evidence'].append('explicit_original_language')
    # Texas labels audio within its technical information and marks the same
    # film variant VO/VOSC. Never read the subtitle or surrounding prose as audio.
    for node in doc.find():
        if 'info-extra' not in node.attrs.get('class','').split():continue
        for field in node.find():
            if 'duration' not in field.attrs.get('class','').split():continue
            value=field.text()
            if not re.search(r'\bVO(?:SC|SE|SI|CAT)?\b',value,re.I):continue
            raw=re.split(r'\s+SUBTITULAT\w*\s+|\s*/\s*',value,flags=re.I)[0].strip()
            parsed=parse_languages(raw)
            facts['language_raw'].append(raw)
            facts['languages'].extend(parsed['codes'])
            facts['language_unknown'].extend(parsed['unknown'])
            facts['language_evidence'].append('original_version_audio')
    return {k: unique(v) for k, v in facts.items()}


def source_facts(film, fetch):
    details = film.get("details", {})
    facts = {"titles": titles(film), "directors": details.get("directors", []), "cast": details.get("cast", []),
             "years": unique([film.get("release_year"), details.get("release_year")]
                             + [s.get("year") for s in film.get("sessions", [])]),
             "runtimes": unique([film.get("runtime_minutes"), details.get("runtime_minutes")]
                                + [s.get("runtime_minutes") for s in film.get("sessions", [])]), "sources": [], "languages": []}
    for url in source_urls(film)[:3]:
        try:
            html = fetch(url).decode("utf-8", "replace")
            extra = parse_source(html)
            if extra["titles"] and not keys(extra["titles"]).intersection(keys(facts["titles"])):
                # An explicitly labelled original title can differ, but the
                # document must still contain the scheduled local title.
                if not any(title_key(t) in title_key(Document(html).root.text()) for t in facts["titles"]):
                    continue
            for field, values in extra.items():
                facts[field] = unique(facts.get(field, []) + values)
            facts["sources"].append(url)
        except Exception:
            continue
    facts["years"] = [int(v) for v in facts["years"] if re.fullmatch(r"\d{4}", str(v))]
    facts["runtimes"] = [int(v) for v in facts["runtimes"] if str(v).isdigit() and int(v) > 0]
    return facts


def verify(facts, candidate, *, discovered=False):
    """Return the corroborating evidence, or None on ambiguity/conflict."""
    title_match = bool(keys(facts["titles"]) & keys(candidate.get("titles", [])))
    # Slash headings may contain alternate titles OR two different works.
    slash = [t for t in facts["titles"] if " / " in t]
    if slash and not all(all(keys([part]) & keys(candidate.get("titles", [])) for part in t.split(" / ")) for t in slash):
        return None
    dy, cy = set(facts.get("years", [])), set(candidate.get("years", []))
    dd, cd = keys(facts.get("directors", [])), keys(candidate.get("directors", []))
    dr, cr = facts.get("runtimes", []), candidate.get("runtimes", [])
    year = bool(dy & cy)
    director = bool(dd & cd)
    runtime = any(abs(a-b) <= max(5, min(a,b)*.05) for a in dr for b in cr)
    cast = len(keys(facts.get("cast", [])) & keys(candidate.get("cast", []))) >= 2
    if (dy and cy and not year) or (dd and cd and not director) or (dr and cr and not runtime):
        return None
    if (title_match and (year or director or (cast and runtime))) or (discovered and director and (year or runtime)):
        return [k for k, yes in (("published_title", title_match), ("director", director), ("release_year", year),
                                ("runtime", runtime), ("cast", cast)) if yes]
    return None


def publisher_facts(html, provider):
    doc = Document(html).root
    if provider == "filmaffinity":
        facts = parse_fa(html)
        heading_node = doc.find(id="main-title")[0]
        heading = next((n.text() for n in heading_node.find(itemprop="name")), heading_node.text())
        title = re.sub(r"\s*\(\d{4}\)\s*$", "", heading)
        result = {"titles": [title], "directors": facts.get("directors", []), "cast": facts.get("cast", []),
                  "years": [facts["release_year"]] if facts.get("release_year") else [],
                  "runtimes": [facts["runtime_minutes"]] if facts.get("runtime_minutes") else []}
        for term in doc.find("dt"):
            if title_key(term.text()) in ("titulo original", "original title"):
                siblings = term.parent.children
                following = [n for n in siblings[siblings.index(term)+1:] if isinstance(n, Node)]
                if following and following[0].tag == "dd":
                    result["original_title"] = re.sub(r"\s+aka$", "", following[0].text()).strip()
                    result["titles"].append(result["original_title"])
        return result
    movie = movie_node(doc)
    facts = parse_rt(html)
    result = {"titles": unique([movie.get("name")]), "directors": facts.get("directors", []), "cast": facts.get("cast", []),
              "years": [], "runtimes": [facts["runtime_minutes"]] if facts.get("runtime_minutes") else []}
    if re.match(r"\d{4}", movie.get("datePublished", "")):
        result["years"] = [int(movie["datePublished"][:4])]
    return result


def provider_url(url, provider):
    parts = urlsplit(url)
    return (parts.scheme == "https" and not parts.query and not parts.fragment and not parts.username
            and ((provider == "filmaffinity" and parts.netloc == "www.filmaffinity.com" and re.fullmatch(r"/(?:es|en)/film\d+\.html", parts.path))
                 or (provider == "rotten_tomatoes" and parts.netloc == "www.rottentomatoes.com" and re.fullmatch(r"/m/[\w-]+", parts.path))))


class Lookup:
    def __init__(self, fetch, old, now, force=False):
        self.fetch, self.cache, self.now, self.force = fetch, dict(old), now, force
        self.lock = threading.RLock()

    def json(self, url, hours=168):
        # Serialize cache misses to avoid hammering the public metadata APIs.
        with self.lock:
            prior = self.cache.get(url, {})
            if not self.force and is_fresh(prior, self.now, hours):
                return prior["value"]
            result = json.loads(self.fetch(url))
            if not isinstance(result, dict) or result.get("error"):
                raise ValueError("Metadata API response incomplete")
            if "entities" in result:
                # Keep only title/identity facts; full Wikidata references and
                # unrelated person statements would make the runner cache huge.
                result = {"entities": {key: {"id": entity.get("id", key), "labels": entity.get("labels") or {},
                    "aliases": entity.get("aliases") or {}, "claims": {prop: [
                        {"rank": row.get("rank"), "mainsnak": row.get("mainsnak", {})} for row in rows]
                        for prop, rows in entity.get("claims", {}).items()
                        if prop in ("P345", "P1476", "P577", "P57", "P161", "P2047", "P1258", "P480")}}
                    for key, entity in result["entities"].items()}}
            self.cache[url] = {"checked_at": self.now.isoformat(), "value": result}
            return result

    def entities(self, ids, *, names_only=False):
        ids = sorted(set(ids))
        result = {}
        for start in range(0, len(ids), 40):
            value = self.json(API + urlencode({"action": "wbgetentities", "ids": "|".join(ids[start:start+40]),
                "props": "labels|aliases" if names_only else "labels|aliases|claims", "languages": "|".join(LANGUAGES), "format": "json"}))
            result.update(value.get("entities", {}))
        return result

    def parsed(self, url, parser):
        with self.lock:
            prior = self.cache.get(url, {})
            if not self.force and is_fresh(prior, self.now, 168):
                return prior["value"]
            value = parser(self.fetch(url).decode("utf-8", "replace"))
            self.cache[url] = {"checked_at": self.now.isoformat(), "value": value}
            return value

    def publisher(self, facts, provider):
        """Search published aliases and validate each exact publisher page."""
        queries, seen, matches, failures = [], set(), {}, []
        for title in facts["titles"]:
            if title_key(title) not in seen:
                queries.append(clean_title(title))
                seen.add(title_key(title))
        for query in queries[:3]:
            base = "https://www.filmaffinity.com" if provider == "filmaffinity" else "https://www.rottentomatoes.com"
            url = base + ("/es/search.php?stext=" if provider == "filmaffinity" else "/search?search=") + quote(query, safe="")
            def links(html):
                root = Document(html).root
                panels = root.find("search-page-result", type="movie") if provider == "rotten_tomatoes" else []
                anchors = [a for panel in panels for a in panel.find("a")] if panels else root.find("a")
                urls = unique(urljoin(base, n.attrs.get("href", "")) for n in anchors
                              if provider_url(urljoin(base, n.attrs.get("href", "")), provider))
                # FilmAffinity may redirect a unique search directly to a film.
                urls = unique([n.attrs.get("href") for n in root.find("link", rel="canonical")
                               if provider_url(n.attrs.get("href", ""), provider)] + urls)
                return urls
            try:
                pages = self.parsed(url, links)[:6]
            except Exception as error:
                failures.append(type(error).__name__)
                continue
            for page in pages:
                try:
                    candidate = self.parsed(page, lambda html: publisher_facts(html, provider))
                    evidence = verify(facts, candidate, discovered=True)
                    if evidence:
                        matches[page] = {**candidate, provider: page, "evidence": evidence}
                except Exception as error:
                    # An unavailable unrelated search hit must not discard a
                    # successfully verified page from the same results list.
                    failures.append(type(error).__name__)
            if len(matches) == 1:
                return next(iter(matches.values()))
        if not matches and failures:
            raise OSError("Publisher candidate pages unavailable")
        return None

    def from_filmaffinity(self, facts):
        """Bridge a verified local-title page to IMDb through its English page."""
        candidate = self.publisher(facts, "filmaffinity")
        if not candidate:
            return None
        url = candidate["filmaffinity"]
        try:
            def english_title(html):
                nodes = Document(html).root.find(id="main-title")
                return re.sub(r"\s*\(\d{4}\)\s*$", "", nodes[0].text()) if nodes else None
            english = self.parsed(url.replace("/es/", "/en/"), english_title)
            if english:
                candidate["english_title"] = english
                candidate["titles"] = unique(candidate["titles"] + [english])
        except Exception:
            pass
        matches = {}
        for query in unique([candidate.get("english_title"), candidate.get("original_title"), *candidate["titles"]])[:3]:
            payload = self.json("https://v3.sg.media-imdb.com/suggestion/x/" + quote(query, safe="") + ".json", 24)
            for row in payload.get("d", []):
                if (row.get("qid") not in ("movie", "short") or not IMDB.fullmatch(row.get("id", ""))
                        or row.get("y") not in candidate["years"]):
                    continue
                cast = keys(row.get("s", "").split(", ")) & keys(candidate.get("cast", []))
                title = bool(keys([row.get("l")]) & keys(candidate["titles"]))
                # IMDb suggestions also search localized titles but return an
                # English label. For that bridge require all listed principal
                # cast (up to two), in addition to year and the verified page.
                all_cast = bool(candidate.get("cast")) and len(cast) >= min(2, len(keys(candidate["cast"])))
                if not title and not all_cast:
                    continue
                # Require an actor corroboration too when IMDb publishes cast.
                if row.get("s") and candidate.get("cast") and not cast:
                    continue
                matches[row["id"]] = row
        if len(matches) == 1:
            imdb, row = next(iter(matches.items()))
            return {**candidate, "imdb_id": imdb, "identity_source": url,
                    "release_year": row["y"], "english_title": row["l"], "titles": unique(candidate["titles"] + facts["titles"] + [row["l"]]),
                    **({"title_language": facts["languages"][0]} if len(facts.get("languages", [])) == 1 else {}),
                    "evidence": candidate["evidence"] + ["imdb_title_year_cast" if not keys([row["l"]]) & keys(candidate["titles"]) else "imdb_title_year"]}
        return None

    def items_for_imdb(self, ids):
        if not ids:
            return []
        query = 'SELECT ?item ?imdb WHERE { VALUES ?imdb { ' + ' '.join(json.dumps(i) for i in sorted(set(ids))) + ' } ?item wdt:P345 ?imdb. }'
        value = self.json("https://query.wikidata.org/sparql?" + urlencode({"query": query, "format": "json"}))
        return unique(row["item"]["value"].rsplit("/", 1)[-1] for row in value.get("results", {}).get("bindings", []))

    def candidates(self, facts, imdb=None, item=None):
        if imdb:
            ids = [item] if item and re.fullmatch(r"Q\d+", item) else self.items_for_imdb([imdb])
        else:
            ids, imdbs = [], []
            queries = list({title_key(t): clean_title(t) for t in reversed(facts["titles"])}.values())
            # The first alias retains cinema spelling/punctuation. Split slash
            # titles for discovery only; verify() checks both refer to one work.
            queries += unique(part.strip() for t in queries if " / " in t for part in t.split(" / "))
            for query in queries[:3]:
                value = self.json("https://v3.sg.media-imdb.com/suggestion/x/" + quote(query, safe="") + ".json", 24)
                imdbs += [r["id"] for r in value.get("d", []) if r.get("qid") in ("movie", "short") and IMDB.fullmatch(r.get("id", ""))][:6]
                for lang in ("es", "ca", "en"):
                    value = self.json(API + urlencode({"action": "wbsearchentities", "search": query,
                        "language": lang, "type": "item", "limit": 3, "format": "json"}), 24)
                    ids += [r["id"] for r in value.get("search", [])]
            ids += self.items_for_imdb(imdbs)
        entities = self.entities(ids)
        people = unique(v["id"] for e in entities.values() for prop in ("P57", "P161") for v in claims(e, prop))
        names = self.entities(people, names_only=True)
        results = []
        for entity in entities.values():
            identities = unique(v for v in claims(entity, "P345") if isinstance(v, str) and IMDB.fullmatch(v))
            if len(identities) != 1 or (imdb and identities[0] != imdb):
                continue
            result = {"imdb_id": identities[0], "titles": entity_titles(entity),
                      "identity_source": "https://www.wikidata.org/entity/" + entity["id"],
                      "years": unique(int(v["time"][1:5]) for v in claims(entity, "P577") if v.get("precision", 0) >= 9),
                      "runtimes": unique(round(float(v["amount"])) for v in claims(entity, "P2047") if v.get("unit", "").endswith("/Q7727"))}
            for prop, field in (("P57", "directors"), ("P161", "cast")):
                result[field] = unique(n for v in claims(entity, prop) for n in entity_titles(names.get(v["id"], {})))
            originals = claims(entity, "P1476")
            if len(originals) == 1:
                result.update(original_title=originals[0]["text"], title_language=originals[0]["language"])
            label = (entity.get("labels") or {}).get("en", {}).get("value")
            if not label:
                # 'mul' is a shared label, not necessarily an English title.
                # IMDb's exact-ID result supplies the English-facing title.
                payload = self.json("https://v3.sg.media-imdb.com/suggestion/x/" + identities[0] + ".json", 168)
                exact = [r for r in payload.get("d", []) if r.get("id") == identities[0]]
                label = exact[0].get("l") if len(exact) == 1 else None
            if label:
                result["english_title"] = label
                result["titles"] = unique(result["titles"] + [label])
            if result["years"]:
                result["release_year"] = min(result["years"])
            for prop, field, pattern, prefix, suffix in (
                    ("P1258", "rotten_tomatoes", r"m/[\w-]+", "https://www.rottentomatoes.com/", ""),
                    ("P480", "filmaffinity", r"\d+", "https://www.filmaffinity.com/es/film", ".html")):
                values = unique(claims(entity, prop))
                if len(values) == 1 and re.fullmatch(pattern, values[0]):
                    result[field] = prefix + values[0] + suffix
            results.append(result)
        return results


def is_fresh(record, now, hours):
    try:
        return timedelta(0) <= now - datetime.fromisoformat(record.get("attempted_at") or record["checked_at"]) < timedelta(hours=hours)
    except (KeyError, ValueError, TypeError):
        return False


def fingerprint(film):
    # Use raw source records, not aliases produced by this pass. Sessions and
    # show dates may change without invalidating the film identity cache.
    sources = sorted({(s.get("provider", ""), str(s.get("film_id", "")), s.get("title", ""),
                       str(s.get("year", "")), str(s.get("runtime_minutes", ""))) for s in film.get("sessions", [])})
    return hashlib.sha256(json.dumps([sources or [film.get("source_title") or film.get("title")],
                                     sorted(film.get('language_source_urls',[])), VERSION], ensure_ascii=False).encode()).hexdigest()


def enrich(data, output, fetch, now, identities, mappings, *, force=False):
    path = output / "film-identities.json"
    try:
        previous = json.loads(path.read_text())
    except (OSError, ValueError):
        previous = {}
    lookup = Lookup(fetch, previous.get("requests", {}), now, force)
    old = previous.get("films", {})
    records, resolved = {}, {}

    def resolve(film):
        imdb = identities.get(film["id"])
        signature = fingerprint(film)
        prior = next((old[k] for k in [film["id"], *film.get("merged_ids", [])] if k in old and old[k].get("fingerprint") == signature), {})
        ttl = 1 if prior.get("status") == "error" or prior.get("provider_errors") else 168 if prior.get("status") == "verified" and all(prior.get("metadata", {}).get(p) for p in ("rotten_tomatoes", "filmaffinity")) else 24
        if not force and prior.get("version") == VERSION and (not imdb or prior.get("imdb_id") == imdb) and is_fresh(prior, now, ttl):
            return film, prior
        record = {"version": VERSION, "fingerprint": signature, "checked_at": now.isoformat(), "status": "unresolved"}
        # Events/anthologies are deliberately not forced onto a single movie.
        if not imdb and re.search(r"\+|double bill|curtmetratges|cortometrajes|sessió|sesión|competició", film["title"], re.I):
            return film, {**record, "status": "programme_event"}
        try:
            facts = source_facts(film, fetch) if not imdb else {"titles": titles(film)}
            if not imdb and not (facts["years"] or facts["directors"] or len(facts["cast"]) >= 2):
                return film, {**record, "status": "needs_evidence", "source_facts": facts}
            item = (mappings.get(imdb, {}).get("identity_source") or "").rsplit("/", 1)[-1]
            candidates = lookup.candidates(facts, imdb, item)
            matches = [(c, ["exact_imdb_id"] if imdb else verify(facts, c, discovered=True)) for c in candidates]
            matches = [(c, evidence) for c, evidence in matches if evidence]
            if not matches and not imdb:
                fallback = lookup.from_filmaffinity(facts)
                if fallback:
                    matches = [(fallback, fallback["evidence"])]
            if len(matches) == 1:
                candidate, evidence = matches[0]
                # Exact cross-links take precedence. Missing providers can be
                # found by English/original/local aliases without changing UI.
                query_facts = {**candidate, "titles": unique([candidate.get("english_title"), candidate.get("original_title"),
                                                               *candidate.get("titles", []), *facts["titles"]])}
                for provider in ("filmaffinity", "rotten_tomatoes"):
                    if not candidate.get(provider):
                        try:
                            publisher = lookup.publisher(query_facts, provider)
                            if publisher:
                                candidate[provider] = publisher[provider]
                        except Exception as error:
                            record.setdefault("provider_errors", {})[provider] = type(error).__name__
                record.update(status="verified", imdb_id=candidate["imdb_id"], metadata=candidate,
                              evidence=evidence, source_facts=facts)
            else:
                record.update(status="ambiguous" if len(matches) > 1 else "unresolved", source_facts=facts,
                              candidates=[{k: c.get(k) for k in ("imdb_id", "titles", "years", "directors")} for c in candidates])
        except Exception as error:
            record.update(status="error", error=type(error).__name__)
            if prior.get("imdb_id") and prior.get("metadata") and (not imdb or prior.get("imdb_id") == imdb):
                record.update({k: prior[k] for k in ("imdb_id", "metadata", "evidence")})
                record.update(checked_at=prior["checked_at"], attempted_at=now.isoformat())
        return film, record

    with ThreadPoolExecutor(max_workers=4) as pool:
        for film, record in pool.map(resolve, data["films"]):
            records[film["id"]] = record
            if record.get("imdb_id") and record.get("metadata"):
                imdb, metadata = record["imdb_id"], record["metadata"]
                identities[film["id"]] = imdb
                film["imdb_id"] = imdb
                film["titles"] = unique(titles(film) + metadata.get("titles", []))
                film["identity_provenance"] = {"imdb_id": imdb, "source_url": metadata["identity_source"],
                    "evidence": record["evidence"], "checked_at": record["checked_at"]}
                resolved[imdb] = metadata
            if len(records) % 25 == 0:
                print(f"Film identities: {len(records)}/{len(data['films'])} checked", flush=True)
    result = {"version": VERSION, "checked_at": now.isoformat(), "films": records, "requests": lookup.cache,
              "verified": sum(bool(r.get("imdb_id")) for r in records.values())}
    atomic_write(path, result)
    return {"mappings": resolved, "failed": any(r.get("status") == "error" or r.get("provider_errors") for r in records.values())}
