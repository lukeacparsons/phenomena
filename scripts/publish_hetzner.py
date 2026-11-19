#!/usr/bin/env python3
"""Publish the latest validated local release to Hetzner without rebuilding the app."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import fcntl

ROOT = Path(__file__).resolve().parents[1]


def publish(config):
    source = (ROOT / '.site/current').resolve(strict=True)
    state = ROOT / 'output/hetzner-publisher/last-release.json'
    if state.exists() and json.loads(state.read_text()).get('local_release') == source.name:
        return
    # Pin the immutable release while the collector may retire its directory.
    with tempfile.TemporaryDirectory(prefix='vobarna-release-') as temporary:
        snapshot = Path(temporary) / 'release'
        shutil.copytree(source, snapshot, copy_function=os.link)
        files = {str(p.relative_to(snapshot)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(snapshot.rglob('*')) if p.is_file()}
        digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
        if state.exists() and json.loads(state.read_text()).get('digest') == digest:
            return
        built = datetime.fromisoformat(json.loads((snapshot / 'manifest.json').read_text())['built_at'])
        name = 'release-' + built.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + digest[:12]
        (snapshot / 'deployment.json').write_text(json.dumps({'files': files, 'digest': digest}))
        ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes',
               '-o', 'ConnectTimeout=15', '-i', str(Path(config['identity_file']).expanduser())]
        host = config['ssh_host']
        target = '/srv/vobarna/publication/releases/' + name
        subprocess.run([*ssh, host, 'mkdir -p ' + shlex.quote(target)], check=True, timeout=30)
        # Builders stamp identical images with new mtimes. Preserve contents,
        # not those timestamps, so --link-dest can actually share their inodes.
        subprocess.run(['rsync', '-r', '--checksum',
                        '--link-dest=/srv/vobarna/publication/current', '-e', shlex.join(ssh),
                        str(snapshot) + '/', host + ':' + target + '/'], check=True, timeout=900)
        subprocess.run([*ssh, host, '/usr/local/libexec/vobarna-activate ' + name], check=True, timeout=120)
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(json.dumps({'digest': digest, 'local_release': source.name, 'release': name, 'published_at': datetime.now(timezone.utc).isoformat()}))
        print(json.dumps({'event':'hetzner_publication_succeeded','release':name}),flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / '.deploy-secrets/hetzner.json')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    lock_path = ROOT / 'output/hetzner-publisher/publish.lock'
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            with lock_path.open('w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                publish(config)
        except Exception as error:
            print(json.dumps({'event':'hetzner_publication_failed','error':type(error).__name__}),flush=True)
            if not args.watch:
                raise SystemExit(1)
        if not args.watch:
            return
        time.sleep(60)


if __name__ == '__main__':
    main()
