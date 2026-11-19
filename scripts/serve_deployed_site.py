#!/usr/bin/env python3
"""Render incoming cinema data with this deployed Git revision, then serve it.

The incoming publication is a data feed only. Its HTML, JavaScript and templates
are never served. Each container owns its rendered output, so an old container
cannot undo a newer deployment during a rolling update.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def copy_changed(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or (source.stat().st_size, source.stat().st_mtime_ns) != (target.stat().st_size, target.stat().st_mtime_ns):
        shutil.copy2(source, target)


def prepare_input(incoming, cache, registry):
    source = (Path(incoming) / 'current').resolve(strict=True)
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    # Permit the already-running data uploader during the one-time migration.
    catalogue = source / 'catalogue.json'
    if not catalogue.exists():
        catalogue = source / 'public/programme.json'
    copy_changed(catalogue, cache / 'screenings.json')
    copy_changed(source / 'public/availability.json', cache / 'availability.json')
    if not Path(registry).exists():
        copy_changed(source / 'registry.json', Path(registry))
    artwork = source / 'public/preview-data'
    for directory in ('images', 'posters'):
        if not (artwork / directory).exists():
            continue
        for file in (artwork / directory).rglob('*'):
            if file.is_file():
                copy_changed(file, cache / directory / file.relative_to(artwork / directory))
    return source.name


def rebuild(incoming, output):
    cache = ROOT / 'static/preview-data'
    registry = output / 'registry.json'
    source = prepare_input(incoming, cache, registry)
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/build_public_site.py'),
                             '--programme', str(cache / 'screenings.json'), '--output', str(output),
                             '--registry', str(registry)], check=True, capture_output=True, text=True, timeout=600)
    if result.stderr:
        print(result.stderr, file=sys.stderr, end='')
    print(json.dumps({'event': 'git_publication_ready', 'input_release': source,
                      'commit': os.environ.get('SOURCE_COMMIT', 'unknown'),
                      **json.loads(result.stdout.strip().splitlines()[-1])}), flush=True)
    return source


def main():
    incoming = Path(os.environ.get('VOBARNA_INPUT_ROOT', '/incoming'))
    output = Path(os.environ.get('PUBLICATION_ROOT', '/app/.site'))
    output.mkdir(parents=True, exist_ok=True)
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    source = rebuild(incoming, output)
    server = subprocess.Popen(['node', str(ROOT / 'src/vobarna-server.mjs')], cwd=ROOT)
    refreshed = time.monotonic()
    try:
        while not stopped.wait(15):
            if server.poll() is not None:
                raise RuntimeError('HTTP server stopped')
            try:
                current = (incoming / 'current').resolve(strict=True).name
                if current != source or time.monotonic() - refreshed >= 300:
                    source = rebuild(incoming, output)
                    refreshed = time.monotonic()
            except Exception as error:
                # Atomic builds leave the last good publication serving requests.
                print(json.dumps({'event': 'git_publication_refresh_failed', 'error': type(error).__name__}), flush=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill(); server.wait()


if __name__ == '__main__':
    main()
