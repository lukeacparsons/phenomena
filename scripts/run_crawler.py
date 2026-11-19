#!/usr/bin/env python3
"""Managed local collector, availability refresh, metadata and remote heartbeat."""
import json
import signal
import threading

from availability_cache import AvailabilityCache
from crawler_health import ROOT
from crawler_monitor import HealthPublisher
from film_ratings import RatingsRefresher
from programme_store import file_lock
from public_refresh import PublicRefresher


def main():
    output = ROOT / 'static/preview-data'
    stopped = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stopped.set())
    with file_lock(output / 'crawler-service.lock', blocking=False):
        services = [HealthPublisher(output), PublicRefresher(),
                    AvailabilityCache(output / 'screenings.json', output / 'availability.json', interval=900),
                    RatingsRefresher(output / 'screenings.json')]
        try:
            for service in services:
                service.start()
            print(json.dumps({'event': 'crawler_service_started'}), flush=True)
            while not stopped.wait(30):
                # Let launchd restart if an unexpected exception killed a thread.
                for service in services:
                    thread = getattr(service, 'thread', None)
                    if thread and not thread.is_alive():
                        raise RuntimeError(type(service).__name__ + ' stopped')
        finally:
            for service in reversed(services):
                service.stop()


if __name__ == '__main__':
    main()
