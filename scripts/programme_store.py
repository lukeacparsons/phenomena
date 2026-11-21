"""Serialize short read/merge/write transactions across crawler/metadata processes."""
from contextlib import contextmanager
import fcntl
import json
from pathlib import Path
from cinesa_showtimes import atomic_write
from browser_programme import browser_programme
from film_grouping import deduplicate_programme
from film_duplicate_audit import audit_programme


@contextmanager
def file_lock(path, *, blocking=True):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a') as handle:
        fcntl.flock(handle,fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        try:yield
        finally:fcntl.flock(handle,fcntl.LOCK_UN)


def update_programme(path, transform):
    path=Path(path)
    with file_lock(path.with_suffix('.lock')):
        current=json.loads(path.read_text()) if path.exists() else None
        result=transform(current)
        is_programme = isinstance(result.get('films'), list) and isinstance(result.get('cinemas'), list)
        if is_programme:
            # Every writer (including metadata/artwork-only refreshes) applies
            # reviewed identities before either public projection is replaced.
            deduplicate_programme(result)
            audit = audit_programme(result)
        atomic_write(path,result)
        if is_programme:
            atomic_write(path.parent / 'programme.json', browser_programme(result), compact=True)
            atomic_write(path.parent / 'film-duplicates.json', audit)
            if audit['candidate_count']:
                print(json.dumps({'event': 'film_duplicate_candidates', 'count': audit['candidate_count'],
                                  'report': str(path.parent / 'film-duplicates.json')}), flush=True)
    return result
