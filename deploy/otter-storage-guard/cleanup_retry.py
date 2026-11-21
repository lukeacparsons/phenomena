#!/usr/bin/env python3
"""Retry native Coolify cleanup after deployments settle. Runs on the management host."""
import argparse
import fcntl
import json
from pathlib import Path
import subprocess
import time


def reason_to_cleanup(info, last_request, now):
    if info['active_deployment'] or info['cleanup_running']:
        return None
    if now - last_request < 900:
        return None
    deployment, cleanup = info.get('latest_deployment'), info.get('latest_cleanup')
    if deployment and now - deployment['at'] < 120:
        return None
    if not cleanup:
        return 'No completed cleanup exists'
    if cleanup['status'] == 'running' and now - cleanup['started_at'] < 900:
        return None
    if cleanup['status'] != 'success' or cleanup['skipped_cache']:
        return 'Retry failed, interrupted or skipped cleanup'
    if deployment and deployment['at'] > cleanup['started_at']:
        return 'Deployment completed after the last cleanup started'
    return None


def bridge(action):
    source = Path(__file__).with_name('coolify_bridge.php').read_bytes()
    p = subprocess.run(['docker', 'exec', '-i', 'coolify', 'php', '/dev/stdin', action],
                       input=source, capture_output=True, timeout=60, check=True)
    return json.loads(p.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--configure', action='store_true')
    args = parser.parse_args()
    root = Path('/var/lib/otter-cleanup-retry')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.configure:
        result = bridge('configure')
        backup = root / ('settings-before-' + time.strftime('%Y%m%dT%H%M%S') + '.json')
        backup.write_text(json.dumps(result, indent=2))
        backup.chmod(0o600)
        print(json.dumps(result))
        return
    with (root / 'retry.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = root / 'state.json'
        state = json.loads(path.read_text()) if path.exists() else {}
        info = bridge('inspect')
        now = time.time()
        reason = reason_to_cleanup(info, state.get('last_request', 0), now)
        result = {'checked_at': now, 'reason': reason, 'info': info, 'applied': args.apply}
        if reason and args.apply:
            response = bridge('dispatch')
            result['dispatch'] = response
            if response['dispatched']:
                state['last_request'] = now
        if args.apply:
            state.update(result)
            temp = root / 'state.tmp'
            temp.write_text(json.dumps(state, indent=2))
            temp.chmod(0o600)
            temp.replace(path)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
