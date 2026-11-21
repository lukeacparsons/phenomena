"""Flag likely duplicate cards for review; approximate titles never establish identity."""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
from difflib import SequenceMatcher
import json
from pathlib import Path
import re

from cinesa_showtimes import atomic_write
from film_grouping import compatible, deduplicate_programme, identity, reviewed_identities, runtimes, title_key, titles


DISTINCT_PAIRS = Path(__file__).with_name('film_distinct_pairs.json')


class DuplicateFilmsError(ValueError):
    """Publication must wait for identity review or a rebuilt, grouped release."""


def distinct_pairs():
    pairs = set()
    for review in json.loads(DISTINCT_PAIRS.read_text()):
        films = review.get('films', [])
        if (len(films) != 2 or not review.get('reason') or not review.get('source_urls')
                or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', review.get('reviewed_at', ''))
                or any(not f.get('id') or not f.get('title') for f in films)):
            raise ValueError('Distinct-film reviews require two IDs/titles, evidence, reason and review date')
        pairs.add(tuple(sorted((f['id'], title_key(f['title'])) for f in films)))
    return pairs


def review_key(title):
    # Only for candidate discovery, never the automatic grouping/identity key.
    return re.sub(r"\s+live viewing$", "", title_key(title))


def title_match(left, right):
    if not left or not right:
        return None
    if left == right:
        return "title_alias"
    # Numbers can distinguish sequels, years, concerts and opera seasons.
    if re.findall(r"\d+", left) != re.findall(r"\d+", right):
        return None
    short, long = sorted((left, right), key=len)
    if (len(short) >= 20 and long.startswith(short) and 0 < len(long) - len(short) <= 4
            and " " not in long[len(short):] and not short.endswith(" ")):
        return "truncated_title"
    if min(len(left), len(right)) >= 12 and SequenceMatcher(None, left, right).ratio() >= .94:
        return "similar_title"
    return None


def duplicate_candidates(programme, reviewed=None):
    reviewed = reviewed_identities() if reviewed is None else reviewed
    distinct = distinct_pairs()
    rows = []
    for film in sorted(programme["films"], key=lambda f: f["id"]):
        ids = identity(film, reviewed)
        if film["id"].startswith("edition:") or len(ids) > 1:
            continue
        keys = {review_key(t) for t in titles(film)} - {""}
        dates = {s.get("date") or (s.get("starts_at") or "")[:10] for s in film["sessions"]} - {""}
        rows.append((film, ids, keys, dates, runtimes(film)))
    candidates = []
    for i, (left, left_ids, left_keys, left_dates, left_times) in enumerate(rows):
        for right, right_ids, right_keys, right_dates, right_times in rows[i + 1:]:
            # Reviews apply only to the exact provider IDs and normalized titles;
            # a new provider ID or a changed title requires another review.
            if distinct and tuple(sorted((f['id'], title_key(f['title'])) for f in (left, right))) in distinct:
                continue
            if left_ids and right_ids and left_ids != right_ids:
                continue
            if not compatible(left, right):
                continue
            matches = {reason for a in left_keys for b in right_keys if (reason := title_match(a, b))}
            if not matches:
                continue
            shared_dates = sorted(left_dates & right_dates)
            # A close spelling alone is too noisy; require corroborating schedule
            # or runtime evidence. These are still suggestions, never joins.
            if "title_alias" not in matches and not shared_dates and not (left_times and right_times):
                continue
            def evidence(film, ids, times):
                return {"id": film["id"], "title": film["title"], "imdb_ids": sorted(ids),
                        "merged_ids": film.get("merged_ids", []), "runtime_minutes": sorted(times),
                        "cinemas": sorted({s["cinema_id"] for s in film["sessions"]}),
                        "source_urls": sorted({s[k] for s in film["sessions"]
                                               for k in ("film_url", "source_url") if s.get(k)})}
            candidates.append({"films": [evidence(left, left_ids, left_times), evidence(right, right_ids, right_times)],
                               "reasons": sorted(matches), "shared_dates": shared_dates})
    return candidates


def audit_programme(programme):
    candidates = duplicate_candidates(programme)
    return {"schema_version": 1, "checked_at": datetime.now(timezone.utc).isoformat(),
            "programme_generated_at": programme.get("generated_at"),
            "film_count": len(programme["films"]), "candidate_count": len(candidates), "candidates": candidates}


def validate_publication_films(programme, report_path, *, apply_confirmed_merges=False):
    """Return a checked copy or reject publication before any release is activated.

    The builder may apply confirmed merges before rendering. The uploader must
    reject an ungrouped artifact because its HTML and routes are already built.
    """
    grouped = deepcopy(programme)
    summary = deduplicate_programme(grouped)
    report = audit_programme(grouped)
    report['confirmed_merges'] = summary['merged']
    report['requires_rebuild'] = bool(summary['merged'] and not apply_confirmed_merges)
    report['status'] = 'blocked' if report['candidate_count'] or report['requires_rebuild'] else 'ok'
    report_path = Path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(report_path, report)
    if report['status'] == 'blocked':
        raise DuplicateFilmsError(f"Film identity check blocked publication: {report['candidate_count']} "
                                  f"unresolved pairs; rebuild required: {report['requires_rebuild']}. "
                                  f"Review {report_path}")
    return grouped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path,
                        default=Path(__file__).resolve().parents[1] / "static/preview-data/screenings.json")
    parser.add_argument("--check", action="store_true", help="Exit 1 when confirmed merges or candidate review are needed")
    args = parser.parse_args()
    programme = json.loads(args.input.read_text())
    # Read-only check of the catalogue after applying confirmed grouping rules.
    grouping = deduplicate_programme(programme)
    report = audit_programme(programme)
    report["pending_confirmed_merges"] = grouping["merged"]
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(args.check and bool(report["candidate_count"] or grouping["merged"]))


if __name__ == "__main__":
    raise SystemExit(main())
