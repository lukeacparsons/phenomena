"""Background publication and optional scheduled programme collection."""
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import threading
import time

from public_build import ROOT, PUBLIC, build
from crawler_health import instant, coverage_by_cinema


def last_collection_time(programme):
    """Metadata and artwork writes must never postpone a catalogue crawl."""
    programme = Path(programme)
    try:
        run = json.loads((programme.parent / 'crawl-attempts.json').read_text()).get('last_run', {})
        finished = instant(run.get('finished_at'))
        if finished and finished.timestamp() <= time.time():
            return finished.timestamp()
    except (OSError, ValueError):
        pass
    try:
        coverage = coverage_by_cinema(json.loads(programme.read_text()))
        dates = [instant(row.get('fetched_at')) for row in coverage.values()]
        valid = [d.timestamp() for d in dates if d and d.timestamp() <= time.time()]
        return min(valid) if valid else 0
    except (OSError, ValueError):
        return 0


def stop_process(process):
    if process is None:
        return
    if process.poll() is None:
        # Helpers share a dedicated process group, so they cannot outlive a
        # cancelled catalogue refresh.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


class PublicRefresher:
    def __init__(self, *, collect_minutes=60, publish_seconds=300, output=PUBLIC):
        self.output = Path(output)
        self.collect_seconds = collect_minutes * 60
        self.publish_seconds = publish_seconds
        self.stop_event = threading.Event()
        self.thread = None
        self.process = None

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True, name='vobarna-publication')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        stop_process(self.process)
        if self.thread:
            self.thread.join(timeout=5)

    def run(self):
        programme = ROOT / 'static/preview-data/screenings.json'
        last_collection = last_collection_time(programme)
        next_publish = 0
        while not self.stop_event.is_set():
            now = time.time()
            if self.collect_seconds and now - last_collection >= self.collect_seconds:
                try:
                    self.process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/build_cinema_preview.py'), '--skip-enrichment'], cwd=ROOT, start_new_session=True)
                    if self.stop_event.is_set():
                        stop_process(self.process)
                    code = self.process.wait(timeout=2700)
                    # Exit 2 means some sources failed but good catalogues were published.
                    if code not in (0, 2):
                        raise RuntimeError(f'Programme collector exited {code}')
                except Exception as error:
                    print(json.dumps({'event': 'programme_refresh_failed', 'error': type(error).__name__}), flush=True)
                finally:
                    stop_process(self.process)
                    last_collection = time.time()
                    self.process = None
                    next_publish = 0
            if now >= next_publish and programme.exists() and not self.stop_event.is_set():
                try:
                    result = build(output=self.output)
                    print(json.dumps({'event': 'publication_refreshed', **result}), flush=True)
                except Exception as error:
                    print(json.dumps({'event': 'publication_refresh_failed', 'error': str(error)}), flush=True)
                next_publish = time.time() + self.publish_seconds
            self.stop_event.wait(15)
