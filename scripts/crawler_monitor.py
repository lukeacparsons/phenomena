"""Publish source freshness to the independent Cloudflare watchdog every five minutes."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import threading

from crawler_health import ROOT, refresh_health
from cinesa_showtimes import atomic_write
from programme_store import file_lock

HEALTH_KEY = 'vobarna:crawler-health'


def publish_health(output=ROOT / 'static/preview-data', *, runner=subprocess.run):
    output = Path(output)
    # Include snapshot creation in the lock: an older process must not overwrite
    # a newer heartbeat after waiting to upload.
    with file_lock(output / 'health-upload.lock'):
        health = refresh_health(output)
        path = output / 'monitor-publisher.json'
        try:
            state = json.loads(path.read_text())
        except (OSError, ValueError):
            state = {}
        state['last_attempt'] = health['checked_at']
        try:
            runner([str(ROOT / 'node_modules/.bin/wrangler'), 'kv', 'key', 'put', HEALTH_KEY,
                    '--binding', 'KV', '--remote', '--config', str(ROOT / 'wrangler.toml'),
                    '--path', str(output / 'crawler-health.json')], cwd=ROOT,
                   check=True, timeout=60, capture_output=True)
            state.update(status='ok', last_success=health['checked_at'])
            state.pop('error', None)
        except (OSError, subprocess.SubprocessError) as error:
            # Wrangler output can contain account details. Record only the type.
            state.update(status='error', error=type(error).__name__)
        atomic_write(path, state)
        print(json.dumps({'event': 'crawler_heartbeat', **state}), flush=True)
        return state


class HealthPublisher:
    def __init__(self, output=ROOT / 'static/preview-data', interval=300):
        self.output, self.interval = Path(output), interval
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.run, name='crawler-health', daemon=True)
        self.thread.start()

    def run(self):
        while not self.stop_event.is_set():
            try:
                publish_health(self.output)
            except Exception as error:
                print(json.dumps({'event': 'crawler_heartbeat_failed', 'error': type(error).__name__}), flush=True)
            self.stop_event.wait(self.interval)

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'static/preview-data')
    args = parser.parse_args()
    if not args.watch:
        return 0 if publish_health(args.output_dir)['status'] == 'ok' else 1
    with file_lock(args.output_dir / 'health-monitor.lock', blocking=False):
        monitor = HealthPublisher(args.output_dir)
        try:
            monitor.run()
        except KeyboardInterrupt:
            monitor.stop()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
