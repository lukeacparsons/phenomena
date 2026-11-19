#!/usr/bin/env python3
"""Collect, build and optionally publish VO Barna, once or as a managed service."""
import argparse
import hashlib
import json
import subprocess
import sys
import time

from availability_cache import AvailabilityCache
from public_build import ROOT, PUBLIC, build
from film_ratings import RatingsRefresher
from public_refresh import last_collection_time, stop_process
from crawler_monitor import HealthPublisher


def artifact_digest():
    digest = hashlib.sha256()
    for file in sorted((PUBLIC / 'current/public').rglob('*')):
        if file.is_file() and file.name != 'routes.json':
            digest.update(str(file.relative_to(PUBLIC / 'current/public')).encode())
            digest.update(file.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collect', action='store_true', help='Refresh the programme from the cinema providers')
    parser.add_argument('--deploy', action='store_true', help='Publish the completed release to the configured Hetzner origin')
    parser.add_argument('--watch', action='store_true', help='Keep publishing updates and expiring past sessions')
    parser.add_argument('--programme-minutes', type=int, default=60)
    parser.add_argument('--publish-seconds', type=int, default=300)
    args = parser.parse_args()
    if args.programme_minutes < 1 or args.publish_seconds < 30:
        parser.error('Invalid refresh interval')
    path = ROOT / 'static/preview-data/screenings.json'
    seats = AvailabilityCache(path, path.parent / 'availability.json', interval=900)
    ratings = RatingsRefresher(path)
    monitor = HealthPublisher(path.parent)
    if args.watch:
        seats.start()
        ratings.start()
        monitor.start()
    last_collect, deployed = last_collection_time(path) if args.watch else 0, None
    try:
        while True:
            if args.collect and time.time() - last_collect >= args.programme_minutes * 60:
                try:
                    process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/build_cinema_preview.py'), '--skip-enrichment'], cwd=ROOT, start_new_session=True)
                    try:
                        code = process.wait(timeout=2700)
                        if code not in (0, 2):
                            raise subprocess.CalledProcessError(code, 'catalogue collector')
                    finally:
                        stop_process(process)
                except (subprocess.SubprocessError, OSError) as error:
                    print(json.dumps({'event': 'collection_failed', 'error': str(error)}), flush=True)
                    if not path.exists():
                        raise
                last_collect = time.time()
            try:
                result = build()
                print(json.dumps({'event': 'publication_ready', **result}), flush=True)
                current = artifact_digest()
                if args.deploy and current != deployed:
                    subprocess.run([sys.executable, str(ROOT / 'scripts/publish_hetzner.py')], cwd=ROOT, check=True, timeout=1000)
                    deployed = current
                    print(json.dumps({'event': 'publication_deployed', 'digest': current}), flush=True)
            except Exception as error:
                if not args.watch:
                    raise
                print(json.dumps({'event': 'publication_failed', 'error': type(error).__name__}), flush=True)
            if not args.watch:
                break
            time.sleep(args.publish_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        if args.watch:
            seats.stop()
            ratings.stop()
            monitor.stop()


if __name__ == '__main__':
    main()
