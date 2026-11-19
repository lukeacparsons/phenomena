#!/usr/bin/env python3
"""Validate a staged release, then atomically promote it. Run as vobarna-publish."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import fcntl

root = Path(os.environ.get('VOBARNA_PUBLICATION_ROOT', '/srv/vobarna/publication')).resolve()
name = sys.argv[1] if len(sys.argv) == 2 else ''
if not re.fullmatch(r'release-[0-9]{8}T[0-9]{6}-[a-f0-9]{12}', name):
    raise SystemExit('Invalid release name')
with (root / '.publish.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    release = root / 'releases' / name
    inventory = json.loads((release / 'deployment.json').read_text())
    for relative, digest in inventory['files'].items():
        file = release / relative
        if not file.resolve().is_relative_to(release) or file.is_symlink() or not file.is_file():
            raise SystemExit('Invalid release file')
        if hashlib.file_digest(file.open('rb'), 'sha256').hexdigest() != digest:
            raise SystemExit('Release checksum mismatch')
    routes = json.loads((release / 'public/routes.json').read_text())
    if routes['origin'] != 'https://vobarna.com' or '/en/' not in routes['pages']:
        raise SystemExit('Invalid publication')
    for path in routes['pages']:
        page = release / 'public' / path.lstrip('/')
        if path.endswith('/'):
            page /= 'index.html'
        if not page.is_file():
            raise SystemExit('Missing public page')
    if not (release / 'registry.json').is_file():
        raise SystemExit('Missing identity registry')
    # tempfile-based builders use a private release directory. The origin runs
    # as an unprivileged container user and needs read/traverse access only.
    release.chmod(0o755)
    for item in release.rglob('*'):
        if item.is_symlink():
            raise SystemExit('Symlinks are not allowed inside a publication')
        item.chmod(0o755 if item.is_dir() else 0o644)
    previous = (root / 'current').resolve() if (root / 'current').exists() else None
    next_link = root / '.current-next'
    next_link.unlink(missing_ok=True)
    next_link.symlink_to('releases/' + name)
    os.replace(next_link, root / 'current')
    # Keep the previous publication for rollback. Unchanged files are hardlinked.
    for old in (root / 'releases').glob('release-*'):
        if old != release and old != previous:
            shutil.rmtree(old)
    print(json.dumps({'event':'publication_activated','release':name,'pages':len(routes['pages'])}))
