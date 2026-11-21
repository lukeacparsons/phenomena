"""Consolidate cinema records without losing screening identities or film metadata."""

from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import unicodedata

from poster_policy import poster_quality, copy_poster


def title_key(title):
    # Only presentation labels are discarded: years, sequels, editions and
    # double-bill titles remain part of the identity check.
    title = re.sub(r"^\s*(?:VOSE|VOSC|VOSI)\s+", "", title or "", flags=re.I)
    title = re.sub(r"[([]\s*(?:(?:VOSE|VOSC|VOSI|VO|ATMOS|IMAX|ISENSE|4K|35\s?MM|70\s?MM|LASER ULTRA)[\s,·+]*)+[)\]]", "", title, flags=re.I)
    title = "".join(c for c in unicodedata.normalize("NFKD", title).casefold() if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^\w]+", " ", title).split())


def titles(film):
    return [v for v in [film.get("title"), film.get("original_title"), film.get("english_title"),
                       film.get("source_title"), *film.get("titles", [])] if v]


def session_order(session):
    return (datetime.fromisoformat(session["starts_at"]).timestamp() if session.get("starts_at") else float("inf"), session["id"])


def normalise_renoir_titles(films):
    path = Path(__file__).with_name("source_title_overrides.json")
    overrides = json.loads(path.read_text()) if path.exists() else {}
    for film in films:
        if not film["title"].isupper() or film.get("original_title") or film.get("title_provenance"):
            continue
        ids = ["renoir:" + str(s["film_id"]) for s in film["sessions"] if s.get("provider") == "renoir"]
        if not ids:
            continue
        old = film["title"]
        title = next((overrides[key] for key in ids if key in overrides), None)
        if not title:
            # Spanish sentence case for un-enriched source titles. Known original
            # titles take precedence above; keep technical labels and acronyms.
            title = re.sub(r"[^\W\d_]", lambda m: m[0].upper(), old.lower(), count=1)
            title = re.sub(r"\b(?:bts|imax|vose|vosc|vosi|iii|ii|iv|vii|viii|vi|ix|3d|2d|4k)\b", lambda m: m[0].upper(), title)
        film["source_title"] = film.get("source_title") or old
        film["titles"] = list(dict.fromkeys([*film.get("titles", []), old, title]))
        film["title"] = title


def reviewed_identities():
    result = {}
    for name in ("poster_identities.json", "rating_identities.json"):
        path = Path(__file__).with_name(name)
        if path.exists():
            result.update(json.loads(path.read_text()))
    return result


def identity(film, reviewed):
    candidates = [film.get("imdb_id"), film.get("poster_provenance", {}).get("imdb_id")]
    ids = [film["id"], *film.get("merged_ids", [])]
    for session in film["sessions"]:
        provider = session.get("provider") or session["id"].split(":")[0]
        ids.append(provider + ":" + str(session.get("film_id", "")))
        candidates.append(session.get("imdb_id"))
        if provider == "mooby":
            candidates.append(session.get("film_id"))
    candidates.extend(value.removeprefix("imdb:") for value in ids if value.startswith("imdb:"))
    known = {v for v in candidates if re.fullmatch(r"tt\d{7,10}", v or "")}
    for key in ids:
        if key in reviewed:
            known.difference_update(reviewed[key].get("superseded_imdb_ids", []))
            known.add(reviewed[key]["imdb_id"])
    return known


def years(film):
    values = [film.get("release_year"), film.get("details", {}).get("release_year")]
    values.extend(session.get("year") for session in film["sessions"])
    return {int(v) for v in values if re.fullmatch(r"\d{4}", str(v or ""))}


def runtimes(film):
    values = [film.get("runtime_minutes"), film.get("details", {}).get("runtime_minutes")]
    values.extend(session.get("runtime_minutes") for session in film["sessions"])
    return {int(v) for v in values if str(v or "").isdigit() and int(v) > 0}


def compatible(left, right):
    ly, ry = years(left), years(right)
    if ly and ry and not ly.intersection(ry):
        return False
    ld = {title_key(v) for v in left.get("details", {}).get("directors", [])}
    rd = {title_key(v) for v in right.get("details", {}).get("directors", [])}
    if ld and rd and not ld.intersection(rd):
        return False
    lt, rt = runtimes(left), runtimes(right)
    return not lt or not rt or any(abs(a - b) <= max(5, min(a, b) * .05) for a in lt for b in rt)


def merge(films, imdb=None):
    if len(films) == 1:
        result = dict(films[0])
        if imdb:
            result["imdb_id"] = imdb
        return result
    def quality(film):
        return (bool(film.get("title_provenance")), bool(film.get("original_title")),
                bool(film.get("details")), bool(film.get("ratings")),
                film["id"] == "imdb:" + (imdb or ""), not film["title"].isupper(), film["id"])
    ordered = sorted(films, key=quality, reverse=True)
    result = dict(ordered[0])
    for film in ordered[1:]:
        for key, value in film.items():
            if not result.get(key) and value:
                result[key] = value
    if imdb and not result["id"].startswith("edition:"):
        canonical = "imdb:" + imdb
        if any(film["id"] == canonical for film in films):
            result["id"] = canonical
        result["imdb_id"] = imdb
    result["merged_ids"] = sorted({key for film in films for key in [film["id"], *film.get("merged_ids", [])]} - {result["id"]})
    result["titles"] = list(dict.fromkeys(title for film in ordered for title in titles(film)))
    sessions = {}
    for film in films:
        for session in film["sessions"]:
            if session["id"] in sessions and sessions[session["id"]] != session:
                raise ValueError("Conflicting duplicate screening: " + session["id"])
            sessions[session["id"]] = session
    result["sessions"] = sorted(sessions.values(), key=session_order)
    language_reports=[report for film in films for report in film.get('details',{}).get('language_reports',[])]
    if language_reports:
        from language_evidence import resolve
        from film_details import filter_language_aliases
        details=resolve(dict(result.get('details',{})),language_reports,datetime.now(timezone.utc))
        details['search_aliases']=filter_language_aliases(details,[*details.get('search_aliases',[]),*details['languages']])
        result['details']=details
    posters = [film for film in films if film.get("poster_url")]
    if posters:
        best = max(posters, key=lambda f: (*poster_quality(f.get("poster_width"), f.get("poster_height")),
                                          bool(f.get("poster_provenance"))))
        copy_poster(best, result)
    return result


def deduplicate_programme(data, reviewed=None):
    """Mutate the programme, joining exact IDs then unambiguous title aliases.

    A title cannot bridge two known films. Year, director and runtime conflicts
    block title-only joins; editions retain their explicit separate identity.
    """
    reviewed = reviewed_identities() if reviewed is None else reviewed
    identified, unknown, protected = defaultdict(list), [], []
    before = len(data["films"])
    for film in data["films"]:
        ids = identity(film, reviewed)
        if film["id"].startswith("edition:") or len(ids) > 1:
            protected.append(film)
        elif ids:
            identified[next(iter(ids))].append(film)
        else:
            unknown.append(film)
    anchors = {imdb: merge(films, imdb) for imdb, films in identified.items()}
    index = defaultdict(set)
    for imdb, film in anchors.items():
        for title in titles(film):
            if key := title_key(title):
                index[key].add(imdb)
    unmatched, assignments = [], defaultdict(list)
    for film in unknown:
        candidates = set().union(*(index[title_key(t)] for t in titles(film)))
        for title in titles(film):
            parts = [p.strip() for p in title.split("/")]
            if len(parts) > 1 and all(parts):
                # A bilingual heading is safe only when every part independently
                # identifies the same known film. A double bill cannot bridge IDs.
                candidates.update(set.intersection(*(index[title_key(p)] for p in parts)))
        candidates = {imdb for imdb in candidates if compatible(film, anchors[imdb])}
        if len(candidates) == 1:
            assignments[next(iter(candidates))].append(film)
        else:
            unmatched.append((film, candidates))
    for imdb, films in assignments.items():
        anchors[imdb] = merge([anchors[imdb], *films], imdb)

    # Repeat showings can have a different local film ID (notably Filmoteca).
    # Compare full titles only here, and require every pair to be compatible.
    buckets = defaultdict(list)
    for film, candidates in unmatched:
        buckets[(title_key(film["title"]), tuple(sorted(candidates)))].append(film)
    remaining = []
    for (key, candidates), films in buckets.items():
        if key and all(compatible(a, b) for i, a in enumerate(films) for b in films[i + 1:]):
            remaining.append(merge(films))
        else:
            remaining.extend(films)
    data["films"] = sorted([*anchors.values(), *remaining, *protected],
                           key=lambda f: (session_order(f["sessions"][0])[0] if f["sessions"] else float("inf"), f["id"]))
    normalise_renoir_titles(data["films"])
    data["session_count"] = sum(len(f["sessions"]) for f in data["films"])
    return {"before": before, "after": len(data["films"]), "merged": before - len(data["films"]),
            "sessions": data["session_count"]}
