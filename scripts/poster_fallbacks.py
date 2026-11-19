#!/usr/bin/env python3
"""Resolve undersized posters through IMDb, with identity and pixel checks."""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import quote, urlsplit

from cinesa_showtimes import atomic_write
from collect_posters import cached_file, image_metadata, save_image
from poster_policy import IMAGE_POLICY_VERSION, meets_target, prefer_poster, copy_poster

IDENTITIES = Path(__file__).with_name("poster_identities.json")
ROOT = Path(__file__).resolve().parents[1]


def normalise(title):
    title = unicodedata.normalize("NFKD", title).casefold()
    return " ".join(re.sub(r"[^\w\s]", " ", "".join(c for c in title if not unicodedata.combining(c))).split())


def identity(film, reviewed):
    ids = set()
    if re.fullmatch(r"tt\d+", film.get("imdb_id") or ""):
        ids.add(film["imdb_id"])
    if re.fullmatch(r"imdb:tt\d+", film["id"]):
        ids.add(film["id"].split(":")[1])
    for row in film["sessions"]:
        candidate = row.get("imdb_id") or (row.get("film_id") if row["provider"] == "mooby" else None)
        if candidate and re.fullmatch(r"tt\d+", candidate):
            ids.add(candidate)
    entries = [reviewed[key] for key in [film["id"], *film.get("merged_ids", [])] if key in reviewed]
    for entry in entries:
        ids.difference_update(entry.get("superseded_imdb_ids", []))
        ids.add(entry["imdb_id"])
    if len(ids) > 1:
        raise ValueError("Conflicting film identities")
    return (next(iter(ids)), "reviewed_id" if entries else "source_imdb") if ids else (None, None)


def select_candidate(film, results, imdb_id):
    movies = [row for row in results if row.get("qid") == "movie" and re.fullmatch(r"tt\d+", row.get("id", ""))]
    if imdb_id:
        matches = [row for row in movies if row["id"] == imdb_id]
    else:
        # A programme date is not a release year. Never infer one from it.
        years = {int(row["year"]) for row in film["sessions"] if re.fullmatch(r"\d{4}", str(row.get("year", "")))}
        titles = {normalise(title) for title in [film["title"], *film.get("titles", [])]}
        matches = [row for row in movies if len(years) == 1 and row.get("y") in years and normalise(row.get("l", "")) in titles]
    unique = {row["id"]: row for row in matches}
    return next(iter(unique.values())) if len(unique) == 1 else None


def valid_image_url(url):
    try:
        parts = urlsplit(url)
        return (parts.scheme == "https" and parts.hostname == "m.media-amazon.com"
                and parts.port in (None, 443) and parts.path.startswith("/images/M/")
                and not parts.username and not parts.password and not parts.fragment)
    except (ValueError, TypeError):
        return False


def bounded_image_url(url):
    """Ask the same IMDb image for 1200px width when its original is oversized."""
    return re.sub(r"\._V1_[^.]*\.(?:jpg|jpeg|png)$", "._V1_SX1200_.jpg", url, flags=re.I)


def apply_poster(film, record, *, stale=False):
    if film.get('poster_url') != '/preview-data/posters/' + record['filename']:
        film["poster_original"] = {"url": film.get("poster_url"), "width": film.get("poster_width"), "height": film.get("poster_height")}
        film.pop('poster_image', None)
    film.update(poster_url="/preview-data/posters/" + record["filename"],
                poster_width=record["width"], poster_height=record["height"],
                poster_provenance={"provider": "IMDb", "stale": stale,
                    **{key: record[key] for key in ("imdb_id", "source_url", "url", "matched_by", "fetched_at")}})


def enrich(data, output, fetch_json, fetch_image, now, minimum=(600, 900), reviewed=None):
    output.mkdir(parents=True, exist_ok=True)
    reviewed = json.loads(IDENTITIES.read_text()) if reviewed is None else reviewed
    manifest = output / "fallbacks.json"
    try:
        previous = json.loads(manifest.read_text())["films"]
    except (OSError, ValueError, KeyError):
        previous = {}
    records, upgraded = dict(previous), 0
    for film in data["films"]:
        if meets_target(film.get("poster_width", 0), film.get("poster_height", 0), minimum):
            prior = previous.get(film["id"], {})
            # Keep the best verified image already on disk, even if a newly
            # grouped cinema poster now clears the minimum resolution.
            if (prior.get("status") == "ok" and cached_file(output, prior)
                    and meets_target(prior['width'], prior['height'], minimum)
                    and prior["width"] * prior["height"] > film["poster_width"] * film["poster_height"]):
                try:
                    imdb_id, _ = identity(film, reviewed)
                    if imdb_id == prior["imdb_id"]:
                        apply_poster(film, prior)
                except ValueError:
                    pass
            if film.get("poster_provenance") and film["id"] in previous:
                records[film["id"]] = previous[film["id"]]
            continue
        record = {"title": film["title"], "checked_at": now.isoformat(), "status": "error", "image_policy_version": IMAGE_POLICY_VERSION}
        try:
            imdb_id, matched_by = identity(film, reviewed)
            query = imdb_id or film.get("english_title") or film.get("original_title") or film["title"].strip()
            prior = previous.get(film["id"], {})
            elapsed = now - datetime.fromisoformat(prior.get("checked_at", "1970-01-01T00:00:00+00:00"))
            fresh = (prior.get("query") == query and timedelta(0) <= elapsed < timedelta(days=7 if prior.get("status") == "ok" else 1)
                     and (prior.get("status") == "ok" or prior.get("image_policy_version") == IMAGE_POLICY_VERSION))
            if fresh and prior.get("status") == "ok" and cached_file(output, prior) and meets_target(prior["width"], prior["height"], minimum):
                record = {**prior, "reused_from_cache": True}
            elif fresh and prior.get("status") != "ok":
                record = prior
            else:
                record["query"] = query
                result = fetch_json("https://v3.sg.media-imdb.com/suggestion/x/" + quote(query, safe="") + ".json")
                rows = result.get("d", [])
                candidate = select_candidate(film, rows, imdb_id)
                if candidate is None:
                    record.update(status="needs_review", candidates=[
                        {"imdb_id": row.get("id"), "title": row.get("l"), "year": row.get("y")}
                        for row in rows if row.get("qid") == "movie"])
                else:
                    url = candidate.get("i", {}).get("imageUrl")
                    if not valid_image_url(url):
                        raise ValueError("Poster image URL is missing or unsupported")
                    original_url = url
                    advertised = candidate.get("i", {})
                    if advertised.get("width", 0) * advertised.get("height", 0) > 36_000_000:
                        url = bounded_image_url(url)
                    try:
                        body = fetch_image(url)
                        metadata = image_metadata(body)
                    except Exception:
                        bounded = bounded_image_url(url)
                        if bounded == url or advertised.get("width", 0) < 1200:
                            raise
                        url = bounded
                        body = fetch_image(url)
                        metadata = image_metadata(body)
                    record.update(imdb_id=candidate["id"], matched_by=matched_by or "exact_title_and_year",
                                  url=url, original_image_url=original_url, source_url="https://www.imdb.com/title/" + candidate["id"] + "/",
                                  matched_title=candidate["l"], year=candidate.get("y"))
                    if meets_target(metadata["width"], metadata["height"], minimum):
                        record.update(metadata, filename=save_image(output, body, metadata), status="ok",
                                      fetched_at=now.isoformat(), reused_from_cache=False)
                    else:
                        record.update(status="below_target", width=metadata["width"], height=metadata["height"])
            if record["status"] == "ok":
                apply_poster(film, record)
                upgraded += 1
        except Exception as error:
            # A failed fallback must never erase the cinema poster or sessions.
            record.update(status="error", error=type(error).__name__)
            prior = previous.get(film["id"], {})
            if (prior.get("status") == "ok" and prior.get("query") == record.get("query")
                    and cached_file(output, prior) and meets_target(prior["width"], prior["height"], minimum)):
                apply_poster(film, prior, stale=True)
                record = {**prior, "last_error": type(error).__name__}
        records[film["id"]] = record
    result = {"checked_at": now.isoformat(), "minimum": {"width": minimum[0], "height": minimum[1]},
              "upgraded": upgraded, "needs_review": sum(r["status"] == "needs_review" for r in records.values()),
              "failed": sum(r["status"] == "error" for r in records.values()), "films": records}
    atomic_write(manifest, result)
    return result


def json_fetch(client, url):
    response = client.get(url, timeout=20, allow_redirects=False)
    if response.status_code != 200 or "application/json" not in response.headers.get("content-type", ""):
        raise ValueError("Poster metadata unavailable")
    return response.json()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "static/preview-data/screenings.json")
    parser.add_argument('--film', action='append', help='Refresh only these film IDs (repeatable)')
    args = parser.parse_args()
    from curl_cffi import requests
    data = json.loads(args.input.read_text())
    if args.film:
        selected=set(args.film)
        data['films']=[f for f in data['films'] if selected.intersection([f['id'],*f.get('merged_ids',[])])]
        if not data['films']:parser.error('No matching film IDs')
    source_manifest = args.input.parent / "posters/posters.json"
    target = json.loads(source_manifest.read_text())["target"] if source_manifest.exists() else {"min_width": 600, "min_height": 900}
    now = datetime.now(timezone.utc)
    with requests.Session(impersonate="chrome") as client:
        def image_fetch(url):
            response = client.get(url, timeout=20, allow_redirects=False)
            response.raise_for_status()
            return response.content
        result = enrich(data, args.input.parent / "posters", lambda url: json_fetch(client, url), image_fetch, now,
                        minimum=(target["min_width"], target["min_height"]))
    from programme_store import update_programme
    enriched = {film['id']: film for film in data['films']}
    def merge_posters(latest):
        changed=False
        for film in latest['films']:
            prepared = enriched.get(film['id'])
            if prepared and prefer_poster(prepared, film, (target['min_width'], target['min_height'])):
                copy_poster(prepared, film)
                changed=True
        if changed:latest['generated_at']=now.isoformat()
        return latest
    update_programme(args.input, merge_posters)
    from optimize_images import refresh_programme_images
    refresh_programme_images(args.input)
    print(json.dumps({key: result[key] for key in ("upgraded", "needs_review", "failed")}))


if __name__ == "__main__":
    main()
