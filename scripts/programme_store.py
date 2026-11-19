"""Serialize short read/merge/write transactions across crawler/metadata processes."""
from contextlib import contextmanager
import fcntl
import json
from pathlib import Path
from cinesa_showtimes import atomic_write
from browser_programme import browser_programme


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
        atomic_write(path,result)
        if isinstance(result.get('films'), list) and isinstance(result.get('cinemas'), list):
            atomic_write(path.parent / 'programme.json', browser_programme(result), compact=True)
    return result
