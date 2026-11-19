#!/usr/bin/env python3
"""Bootstrap persistent state once, then run the same tested collector on Linux."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

from programme_store import file_lock
from serve_deployed_site import prepare_input, copy_changed
from run_crawler import main as run

ROOT = Path(__file__).resolve().parents[1]


def bootstrap(publication, cache, registry):
    cache, registry = Path(cache), Path(registry)
    with file_lock(cache / 'bootstrap.lock'):
        if not (cache / 'screenings.json').exists():
            prepare_input(publication, cache, registry)
        elif not registry.exists():
            copy_changed(Path(publication) / 'current/registry.json', registry)
        # Missing state fails closed; existing state survives every redeploy.
        data = json.loads((cache / 'screenings.json').read_text())
        if not isinstance(data.get('films'), list) or not data.get('cinemas'):
            raise ValueError('Valid seed catalogue required')


def healthy(path, now=None):
    try:
        value = json.loads(Path(path).read_text())
        age = ((now or datetime.now(timezone.utc)) - datetime.fromisoformat(value['checked_at'])).total_seconds()
        os.kill(value['pid'], 0)
        return value['state'] in ('active', 'standby') and 0 <= age < 120
    except (OSError, ValueError, KeyError, TypeError):
        return False


if __name__ == '__main__':
    if '--health' in sys.argv:
        raise SystemExit(0 if healthy(os.environ['VOBARNA_RUNTIME_HEALTH']) else 1)
    if not os.environ.get('VOBARNA_HEARTBEAT_TOKEN') or not os.environ.get('VOBARNA_SOURCE_TOKEN'):
        raise SystemExit('Collector monitoring and provider-reader credentials are required')
    bootstrap(ROOT / '.site', ROOT / 'static/preview-data', Path(os.environ['VOBARNA_REGISTRY_PATH']))
    run()
