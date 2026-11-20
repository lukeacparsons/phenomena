#!/usr/bin/env python3
"""Cache film ratings from their publishers; join sites by verified IMDb IDs."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timedelta, timezone
import gzip
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import threading
from urllib.parse import quote, urlencode

from cinesa_showtimes import atomic_write
from poster_fallbacks import IDENTITIES, SOURCES, identity, enrich as enrich_posters, meets_target
from poster_policy import copy_poster
from film_details import enrich as enrich_details
from film_grouping import deduplicate_programme
from film_identity import enrich as enrich_identities, VERSION as IDENTITY_VERSION

ROOT = Path(__file__).resolve().parents[1]
IMDB_DATASET = "https://datasets.imdbws.com/title.ratings.tsv.gz"
PROVIDERS = ("rotten_tomatoes", "filmaffinity", "imdb")
ASIAN_LANGUAGES = {"ja", "zh", "yue", "ko", "hi", "ta", "te", "kn", "ml", "bn", "mr", "gu", "pa", "ur", "si", "ne", "th", "lo", "km", "my", "vi", "id", "ms", "tl", "fil", "mn", "bo", "dz", "kk", "uz", "ky", "tg", "ps", "fa", "ar", "he", "tr"}


def asian_title(mapping):
    return (str(mapping.get("title_language") or "").split("-")[0] in ASIAN_LANGUAGES
            or bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0900-\u0fff]", mapping.get("original_title") or "")))


def film_identity(film, reviewed):
    imdb_id, _ = identity(film, reviewed)
    poster_id = film.get("poster_provenance", {}).get("imdb_id")
    superseded = {value for key in [film["id"], *film.get("merged_ids", [])]
                  for value in reviewed.get(key, {}).get("superseded_imdb_ids", [])}
    if poster_id and poster_id not in superseded and re.fullmatch(r"tt\d+", poster_id):
        if imdb_id and imdb_id != poster_id:
            raise ValueError("Conflicting IMDb identities")
        imdb_id = poster_id
    return imdb_id if re.fullmatch(r"tt\d{7,10}", imdb_id or "") else None


def fresh(value, now, hours):
    try:
        age = now - datetime.fromisoformat(value)
        return timedelta(0) <= age < timedelta(hours=hours)
    except (ValueError, TypeError):
        return False


def search_links(title):
    title = quote(title, safe="")
    return {
        "rotten_tomatoes": "https://www.rottentomatoes.com/search?search=" + title,
        "filmaffinity": "https://www.filmaffinity.com/es/search.php?stext=" + title,
        "imdb": "https://www.imdb.com/find/?s=tt&q=" + title,
    }


def parse_mappings(rows):
    grouped = {}
    for row in rows:
        imdb = row.get("imdb", {}).get("value", "")
        if not re.fullmatch(r"tt\d+", imdb):
            continue
        entry = grouped.setdefault(imdb, {"items": set(), "rt": set(), "fa": set(), "titles": set(), "english": set(), "years": set()})
        entry["items"].add(row["item"]["value"])
        for field in ("rt", "fa"):
            if row.get(field):
                entry[field].add(row[field]["value"])
        if row.get("originalTitle"):
            title = row["originalTitle"]
            entry["titles"].add((title["value"], title.get("xml:lang")))
        if row.get("englishTitle"):
            entry["english"].add(row["englishTitle"]["value"])
        if re.match(r"\d{4}-", row.get("date", {}).get("value", "")):
            entry["years"].add(int(row["date"]["value"][:4]))
    result = {}
    for imdb, entry in grouped.items():
        if len(entry["items"]) != 1:
            continue
        item = next(iter(entry["items"]))
        if not re.fullmatch(r"https?://www.wikidata.org/entity/Q\d+", item):
            continue
        record = {"identity_source": item.replace("http:", "https:")}
        if len(entry["titles"]) == 1:
            record["original_title"], record["title_language"] = next(iter(entry["titles"]))
        elif len(entry["english"]) == 1:
            # A primary English label is safe only when it is itself one of
            # the stated original titles, not merely a translated label.
            matching = [(title, lang) for title, lang in entry["titles"] if title in entry["english"]]
            if len(matching) == 1:
                record["original_title"], record["title_language"] = matching[0]
        if len(entry["english"]) == 1:
            record["english_title"] = next(iter(entry["english"]))
        if entry["years"]:
            record["release_year"] = min(entry["years"])
        if len(entry["rt"]) == 1:
            slug = next(iter(entry["rt"]))
            if re.fullmatch(r"m/[a-zA-Z0-9_-]+", slug):
                record["rotten_tomatoes"] = "https://www.rottentomatoes.com/" + slug
        if len(entry["fa"]) == 1:
            film_id = next(iter(entry["fa"]))
            if re.fullmatch(r"\d+", film_id):
                record["filmaffinity"] = "https://www.filmaffinity.com/es/film" + film_id + ".html"
        result[imdb] = record
    return result


def apply_titles(film, imdb, mapping):
    if not imdb:
        film.pop("imdb_id", None)
        return
    film["imdb_id"] = imdb
    for key in ("original_title", "english_title", "title_language", "release_year"):
        if mapping.get(key) is not None:
            film[key] = mapping[key]
    original = mapping.get("original_title")
    if original:
        # Retain cinema/localized titles for search, without changing film IDs.
        film["source_title"] = film.get("source_title") or film["title"]
        film["titles"] = list(dict.fromkeys([*film.get("titles", []), film["title"], original,
                                            *([mapping["english_title"]] if mapping.get("english_title") else [])]))
        film["title"] = mapping.get("english_title") if asian_title(mapping) and mapping.get("english_title") else original
        # These adaptations already have intentional year disambiguation.
        if imdb in ("tt0087182", "tt1160419"):
            film["title"] += " (" + ("1984" if imdb == "tt0087182" else "2021") + ")"
        film["title_provenance"] = {"source_url": mapping.get("title_source") or mapping.get("identity_source"), "imdb_id": imdb,
                                    "checked_at": mapping.get("checked_at")}


class RatingHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ld = []
        self.script = None
        self.script_kind = None
        self.scorecard = None
        self.fa_film = False
        self.fa = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type", "").lower() == "application/ld+json":
            self.script = ""
            self.script_kind = "ld"
        elif tag == "script" and attrs.get("id") == "media-scorecard-json":
            self.script = ""
            self.script_kind = "scorecard"
        if attrs.get("id") == "main-title":
            self.fa_film = True
        if attrs.get("id") == "movie-rat-avg":
            self.fa["score"] = attrs.get("content")
        if attrs.get("itemprop") == "ratingCount":
            self.fa["count"] = attrs.get("content")

    def handle_data(self, data):
        if self.script is not None:
            self.script += data

    def handle_endtag(self, tag):
        if tag == "script" and self.script is not None:
            try:
                value = json.loads(self.script)
                if self.script_kind == "scorecard":
                    self.scorecard = value
                else:
                    self.ld.append(value)
            except ValueError:
                pass
            self.script = None


def checked_score(score, count, scale):
    if score in (None, ""):
        return None
    value, votes = float(str(score).replace(",", ".")), int(count or 0)
    if not 0 <= value <= scale or votes < 0:
        raise ValueError("Invalid rating")
    return {"score": value, "count": votes, "scale": scale} if votes else None


def parse_rating(provider, html):
    page = RatingHTML()
    page.feed(html)
    if provider == "filmaffinity":
        if not page.fa_film:
            raise ValueError("FilmAffinity film page not found")
        return checked_score(page.fa.get("score"), page.fa.get("count"), 10)
    nodes = []
    for value in page.ld:
        nodes.extend(value if isinstance(value, list) else value.get("@graph", [value]))
    movies = [node for node in nodes if isinstance(node, dict) and node.get("@type") == "Movie"]
    if len(movies) != 1:
        raise ValueError("Rotten Tomatoes film page not found")
    rating = movies[0].get("aggregateRating") or {}
    if not rating:
        return None
    # Only the critics' Tomatometer, never an audience score or a star average.
    if rating.get("name") != "Tomatometer" or str(rating.get("bestRating")) != "100":
        raise ValueError("Unrecognised Rotten Tomatoes rating")
    result = checked_score(rating.get("ratingValue"), rating.get("ratingCount"), 100)
    # This is an editorial designation, never inferred from a score threshold.
    critics = (page.scorecard or {}).get('criticsScore') or {}
    if result is not None:
        result['certified_fresh'] = critics.get('certified') if isinstance(critics.get('certified'), bool) else None
    return result


def parse_audience_rating(html):
    """Read RT's displayed audience score (verified when the site uses it)."""
    page = RatingHTML()
    page.feed(html)
    if not isinstance(page.scorecard, dict):
        raise ValueError("Rotten Tomatoes audience scorecard not found")
    audience = page.scorecard.get("audienceScore") or {}
    value = audience.get("scorePercent")
    if not value:
        return None
    if not re.fullmatch(r"\d{1,3}%", str(value)):
        raise ValueError("Invalid audience percentage")
    score = int(value[:-1])
    if not 0 <= score <= 100:
        raise ValueError("Invalid audience percentage")
    path = audience.get("reviewsPageUrl") or ""
    return {"score": score, "scale": 100, "count_label": audience.get("bandedRatingCount"),
            "verified": path.endswith("/verified-audience"), "review_path": path}


def imdb_ratings(path, wanted):
    result = {}
    with gzip.open(path, "rt", encoding="utf-8") as source:
        for row in csv.DictReader(source, delimiter="\t"):
            if row["tconst"] in wanted:
                result[row["tconst"]] = checked_score(row["averageRating"], row["numVotes"], 10)
    return result


def preserve_failure(previous, url, now, error):
    if previous.get("url") == url and (previous.get("score") is not None
                                       or (previous.get("audience") or {}).get("score") is not None):
        return {**previous, "status": "stale", "attempted_at": now.isoformat(), "last_error": error}
    return {"url": url, "score": None, "status": "unavailable", "attempted_at": now.isoformat(), "last_error": error}


def enrich(data, output, fetch, now, *, force=False, reviewed=None):
    download = fetch
    page_cache = {}
    def fetch(url):
        # Ratings and film details share the same publisher-page request.
        if url not in page_cache:
            value = download(url)
            if "rottentomatoes.com/" in url or "filmaffinity.com/" in url:
                page_cache[url] = value
            return value
        return page_cache[url]
    output.mkdir(parents=True, exist_ok=True)
    cache = output / "ratings-cache"
    cache.mkdir(exist_ok=True)
    manifest = output / "ratings.json"
    try:
        previous = json.loads(manifest.read_text())
    except (OSError, ValueError):
        previous = {}
    reviewed = json.loads(IDENTITIES.read_text()) if reviewed is None else reviewed
    extra = Path(__file__).with_name("rating_identities.json")
    if extra.exists():
        reviewed = {**reviewed, **json.loads(extra.read_text())}
    identities, conflicts = {}, set()
    for film in data["films"]:
        try:
            identities[film["id"]] = film_identity(film, reviewed)
        except ValueError:
            identities[film["id"]] = None
            conflicts.add(film["id"])
    mappings = dict(previous.get("mappings", {}))
    from language_sources import discover
    discover(data['films'], output, fetch, now, force=force)
    identity_result = enrich_identities({"films": [f for f in data["films"] if f["id"] not in conflicts]},
                                 output, fetch, now, identities, mappings, force=force)
    resolved = identity_result["mappings"]
    wanted = {value for value in identities.values() if value}
    pending = sorted(imdb for imdb in wanted if force or mappings.get(imdb, {}).get("title_metadata_version") != 1
                     or not fresh(mappings.get(imdb, {}).get("checked_at"), now, 168))
    for start in range(0, len(pending), 15):
        ids = pending[start:start + 15]
        query = ('SELECT ?item ?imdb ?rt ?fa WHERE { VALUES ?imdb { '
                 + " ".join(json.dumps(imdb) for imdb in ids)
                 + ' } ?item wdt:P345 ?imdb. OPTIONAL {?item wdt:P1258 ?rt} OPTIONAL {?item wdt:P480 ?fa}'
                 + ' OPTIONAL {?item wdt:P1476 ?originalTitle} OPTIONAL {?item rdfs:label ?englishTitle. FILTER(LANG(?englishTitle)="en")}'
                 + ' OPTIONAL {?item wdt:P577 ?date} }')
        query = query.replace('SELECT ?item ?imdb ?rt ?fa', 'SELECT ?item ?imdb ?rt ?fa ?originalTitle ?englishTitle ?date')
        try:
            raw = json.loads(fetch("https://query.wikidata.org/sparql?" + urlencode({"query": query, "format": "json"})))
            found = parse_mappings(raw["results"]["bindings"])
            for imdb in ids:
                mappings[imdb] = {**found.get(imdb, {}), "checked_at": now.isoformat(), "title_metadata_version": 1}
        except Exception as error:
            print("Rating identity lookup unavailable:", type(error).__name__, flush=True)

    overrides_path = Path(__file__).with_name("film_metadata_overrides.json")
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    for imdb in wanted:
        mapping = mappings.setdefault(imdb, {})
        mapping.update({key: value for key, value in resolved.get(imdb, {}).items()
                        if key in ("original_title", "english_title", "title_language", "release_year",
                                   "identity_source", "rotten_tomatoes", "filmaffinity")})
        mapping.update(overrides.get(imdb, {}))
        if asian_title(mapping) and not mapping.get("english_title"):
            try:
                payload = json.loads(fetch("https://v3.sg.media-imdb.com/suggestion/x/" + imdb + ".json"))
                exact = [row for row in payload.get("d", []) if row.get("id") == imdb and row.get("qid") == "movie"]
                if len(exact) == 1:
                    mapping["english_title"] = exact[0]["l"]
            except Exception:
                pass

    dataset = cache / "title.ratings.tsv.gz"
    dataset_checked = previous.get("imdb_dataset_checked_at")
    imdb_scores, dataset_error = {}, None
    try:
        if wanted and (force or not dataset.exists() or not fresh(dataset_checked, now, 24)):
            content = fetch(IMDB_DATASET)
            with gzip.GzipFile(fileobj=io.BytesIO(content)) as source:
                if source.readline().strip() != b"tconst\taverageRating\tnumVotes":
                    raise ValueError("Unexpected IMDb dataset")
            temporary = dataset.with_suffix(".tmp")
            temporary.write_bytes(content)
            temporary.replace(dataset)
            dataset_checked = now.isoformat()
        if wanted:
            imdb_scores = imdb_ratings(dataset, wanted)
    except Exception as error:
        dataset_error = type(error).__name__

    jobs, records = [], {}
    for film in data["films"]:
        key, imdb = film["id"], identities[film["id"]]
        prior = previous.get("films", {}).get(key, {})
        if prior.get("imdb_id") != imdb or key in conflicts:
            prior = {}
        mapping = mappings.get(imdb, {})
        apply_titles(film, imdb, mapping)
        links = search_links(film.get("english_title") or film.get("original_title") or film["title"])
        links.update({provider: mapping[provider] for provider in PROVIDERS if provider in mapping})
        if imdb:
            links["imdb"] = "https://www.imdb.com/title/" + imdb + "/"
        record = {"imdb_id": imdb, "identity_source": mapping.get("identity_source"), "ratings": {}}
        records[key] = record
        for provider in PROVIDERS:
            url = links[provider]
            old = prior.get("ratings", {}).get(provider, {})
            if not imdb or (provider != "imdb" and provider not in mapping):
                record["ratings"][provider] = {"url": url, "score": None, "status": "unmatched"}
            elif provider == "imdb":
                if dataset_error:
                    record["ratings"][provider] = preserve_failure(old, url, now, dataset_error)
                else:
                    score = imdb_scores.get(imdb)
                    record["ratings"][provider] = {"url": url, "status": "ok" if score else "unrated", "score": None,
                                                   **(score or {}), "checked_at": dataset_checked, "source_url": IMDB_DATASET}
            elif not force and (provider != "rotten_tomatoes" or ("audience" in old and "certified_fresh" in old)) and old.get("url") == url and fresh(old.get("attempted_at") or old.get("checked_at"), now,
                                                               1 if old.get("status") in ("stale", "unavailable") or (old.get("audience") or {}).get("status") in ("stale", "unavailable") else 24):
                record["ratings"][provider] = old
            else:
                jobs.append((key, provider, url, old))

    def retrieve(job):
        key, provider, url, old = job
        try:
            html = fetch(url).decode("utf-8")
            rating = parse_rating(provider, html)
            record = {"url": url, "score": None, **(rating or {}), "status": "ok" if rating else "unrated", "checked_at": now.isoformat()}
            if provider == "rotten_tomatoes":
                try:
                    audience = parse_audience_rating(html)
                    record["audience"] = {"url": url, "score": None, **(audience or {}),
                                          "status": "ok" if audience else "unrated", "checked_at": now.isoformat()}
                    path = (audience or {}).get("review_path", "")
                    if re.fullmatch(r"/m/[a-zA-Z0-9_-]+/reviews/(?:verified-audience|all-audience)", path) and path.startswith(url.removeprefix("https://www.rottentomatoes.com") + "/reviews/"):
                        record["audience"]["url"] = "https://www.rottentomatoes.com" + path
                except Exception as error:
                    prior_audience = old.get("audience") or {}
                    record["audience"] = preserve_failure(prior_audience, prior_audience.get("url") or url, now, type(error).__name__)
        except Exception as error:
            record = preserve_failure(old, url, now, type(error).__name__)
        return key, provider, record

    with ThreadPoolExecutor(max_workers=4) as pool:
        for key, provider, record in pool.map(retrieve, jobs):
            records[key]["ratings"][provider] = record
    for film in data["films"]:
        film["ratings"] = records[film["id"]]["ratings"]
    details = enrich_details(data, output, mappings, fetch, now, force=force)
    summary = {provider: sum(film["ratings"][provider].get("score") is not None for film in data["films"]) for provider in PROVIDERS}
    result = {"checked_at": now.isoformat(), "imdb_dataset_checked_at": dataset_checked,
              "mappings": mappings, "films": records, "scores": summary, "metadata_coverage": details["coverage"], "metadata_failed": details["has_failures"] or identity_result["failed"],
              "identity_metadata_version": IDENTITY_VERSION}
    atomic_write(manifest, result)
    return result


def refresh_programme(path, *, now=None, force=False, fetch=None):
    """Update metadata without overwriting schedules/posters changed during a fetch."""
    from curl_cffi import requests
    data = json.loads(path.read_text())
    now = now or datetime.now(timezone.utc)

    def download(url):
        response = requests.get(url, impersonate="chrome", timeout=35)
        response.raise_for_status()
        if response.status_code != 200:
            raise ValueError("Incomplete rating response")
        return response.content

    result = enrich(data, path.parent, fetch or download, now, force=force)
    # A newly verified identity should immediately repair inadequate artwork,
    # including during daily metadata refreshes (not just full schedule runs).
    posters = {f["id"]: f.get("poster_url") for f in data["films"]}
    source_posters = json.loads(SOURCES.read_text())
    eligible = [f for f in data["films"] if re.fullmatch(r"tt\d{7,10}", f.get("imdb_id") or "")
                or any(key in source_posters for key in [f['id'], *f.get('merged_ids', [])])]
    if eligible:
        target_path = path.parent / "posters/posters.json"
        target = json.loads(target_path.read_text()).get("target", {}) if target_path.exists() else {}
        minimum = (target.get("min_width", 600), target.get("min_height", 900))
        result["posters"] = enrich_posters({"films": eligible}, path.parent / "posters",
            lambda url: json.loads((fetch or download)(url)), fetch or download, now, minimum=minimum)
    from programme_store import update_programme
    def merge_metadata(latest):
        updated = {film["id"]: film for film in data["films"]}
        fields = ("title", "source_title", "original_title", "english_title", "title_language", "release_year",
                  "title_provenance", "identity_provenance", "imdb_id", "ratings", "details", "language_source_urls")
        for film in latest["films"]:
            if film["id"] not in updated:
                continue
            enriched = updated[film["id"]]
            if enriched.get("poster_url") != posters[film["id"]] and (film.get("poster_url") == posters[film["id"]]
                    or not meets_target(film.get("poster_width", 0), film.get("poster_height", 0), minimum)):
                copy_poster(enriched,film)
            film["titles"] = list(dict.fromkeys([*film.get("titles", []), *enriched.get("titles", [])]))
            for key in fields:
                if key in enriched:
                    film[key] = enriched[key]
                else:
                    film.pop(key, None)
        latest["generated_at"] = now.isoformat()
        deduplicate_programme(latest)
        return latest
    update_programme(path, merge_metadata)
    from optimize_images import refresh_programme_images
    refresh_programme_images(path)
    return result


class RatingsRefresher:
    """Check the shared cache in a background thread; refresh daily, retry errors hourly."""
    def __init__(self, programme, *, clock=None, refresh=refresh_programme):
        self.programme = programme
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.refresh = refresh
        self.stop_event = threading.Event()
        self.last_attempt = None

    def refresh_if_due(self):
        now = self.clock()
        if fresh(self.last_attempt, now, 1):
            return False
        try:
            previous = json.loads((self.programme.parent / "ratings.json").read_text())
        except (OSError, ValueError):
            previous = {}
        records = [rating for film in previous.get("films", {}).values() for rating in film.get("ratings", {}).values()]
        failed = previous.get("metadata_failed") or any(r.get("status") in ("stale", "unavailable") or (r.get("audience") or {}).get("status") in ("stale", "unavailable") for r in records)
        programme = json.loads(self.programme.read_text())
        same_films = set(previous.get("films", {})) == {f["id"] for f in programme["films"]}
        missing_badges = any('certified_fresh' not in f.get('ratings', {}).get('rotten_tomatoes', {})
                             for f in programme['films'] if f.get('ratings', {}).get('rotten_tomatoes', {}).get('score') is not None)
        if same_films and not missing_badges and previous.get("identity_metadata_version") == IDENTITY_VERSION and fresh(previous.get("checked_at"), now, 1 if failed else 24):
            return False
        self.last_attempt = now.isoformat()
        result = self.refresh(self.programme, now=now)
        print("Ratings refreshed:", json.dumps(result["scores"]), flush=True)
        return True

    def _run(self):
        while not self.stop_event.is_set():
            try:
                self.refresh_if_due()
            except Exception as error:
                print(f"Rating refresh failed ({type(error).__name__}); cached ratings retained", flush=True)
            self.stop_event.wait(60)

    def start(self):
        self.thread = threading.Thread(target=self._run, name="ratings-refresh", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "static/preview-data/screenings.json")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    result = refresh_programme(args.input, force=args.force)
    print(json.dumps({"films": len(result["films"]), "scores": result["scores"]}))


if __name__ == "__main__":
    main()
