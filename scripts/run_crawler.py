#!/usr/bin/env python3
"""Managed collector, availability refresh, metadata and remote heartbeat."""
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import threading

from availability_cache import AvailabilityCache
from crawler_health import ROOT
from crawler_monitor import HealthPublisher
from film_ratings import RatingsRefresher
from programme_store import file_lock
from public_refresh import PublicRefresher
from cinesa_showtimes import atomic_write


def runtime_health(state):
    path = os.environ.get('VOBARNA_RUNTIME_HEALTH')
    if path:
        atomic_write(Path(path), {'state': state, 'checked_at': datetime.now(timezone.utc).isoformat(),
                                 'pid': os.getpid(), 'commit': os.environ.get('SOURCE_COMMIT', 'unknown')})


def main():
    output = ROOT / 'static/preview-data'
    stopped = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stopped.set())
    with ExitStack() as stack:
        while not stopped.is_set():
            try:
                stack.enter_context(file_lock(output / 'crawler-service.lock', blocking=False))
                break
            except BlockingIOError:
                if os.environ.get('VOBARNA_WAIT_FOR_LEASE') != '1':
                    raise
                # During a rolling deployment the old container finishes first.
                # Standby is ready for cutover, but never starts a second writer.
                runtime_health('standby')
                stopped.wait(5)
        if stopped.is_set():
            return
        services = [HealthPublisher(output), PublicRefresher(),
                    AvailabilityCache(output / 'screenings.json', output / 'availability.json', interval=900),
                    RatingsRefresher(output / 'screenings.json')]
        try:
            for service in services:
                service.start()
            runtime_health('active')
            print(json.dumps({'event': 'crawler_service_started',
                              'commit': os.environ.get('SOURCE_COMMIT', 'local')}), flush=True)
            while not stopped.wait(30):
                # Let launchd restart if an unexpected exception killed a thread.
                for service in services:
                    thread = getattr(service, 'thread', None)
                    if thread and not thread.is_alive():
                        raise RuntimeError(type(service).__name__ + ' stopped')
                runtime_health('active')
        finally:
            for service in reversed(services):
                service.stop()


if __name__ == '__main__':
    main()
