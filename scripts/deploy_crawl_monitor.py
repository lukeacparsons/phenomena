#!/usr/bin/env python3
"""Deploy only the standalone CDN crawl monitor; preserve production state and the website."""
import argparse
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'scripts/crawl-monitor.mjs', 'scripts/crawler-visits.mjs', 'scripts/traffic-io.mjs',
    'deploy/crawl-monitor/Dockerfile', 'deploy/crawl-monitor/Dockerfile.dockerignore', 'deploy/crawl-monitor/compose.yaml',
]


def secret(path, name):
    for line in path.read_text().splitlines():
        match = re.match(r'^\s*(?:export\s+)?' + re.escape(name) + r'\s*=\s*(.*?)\s*$', line)
        if match:
            value = match[1].strip('"\'')
            if re.fullmatch(r'[A-Za-z0-9:_-]+', value):
                return value
    raise ValueError(f'{name} missing or malformed in {path.name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssh-key', required=True, type=Path)
    parser.add_argument('--host', default='178.105.17.34')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', args.host):
        parser.error('Invalid SSH host')
    env = '\n'.join([
        'BUNNY_API_KEY=' + secret(ROOT / '.deploy-secrets/bunny.env', 'BUNNY_API_KEY'),
        'VISITORS_TELEGRAM_BOT_TOKEN=' + secret(ROOT / '.deploy-secrets/visitor-telegram.env', 'VISITORS_TELEGRAM_BOT_TOKEN'),
        '',
    ])
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode='w:gz') as archive:
        for name in FILES:
            archive.add(ROOT / name, arcname=name, recursive=False)
        data = env.encode()
        member = tarfile.TarInfo('monitor.env'); member.size = len(data); member.mode = 0o600
        archive.addfile(member, io.BytesIO(data))
    command = '''set -eu
umask 077
mkdir -p /opt/vobarna-crawl-monitor
tar -xzf - --no-same-owner -C /opt/vobarna-crawl-monitor
cd /opt/vobarna-crawl-monitor
chmod 600 monitor.env
mkdir -p state
chown 1000:1000 state
chmod 700 state
docker compose --project-directory . -f deploy/crawl-monitor/compose.yaml up -d --build
docker inspect --format '{{.State.Status}}' vobarna-crawl-monitor
'''
    subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=15', '-i', str(args.ssh_key),
                    f'root@{args.host}', command], input=payload.getvalue(), check=True)
    print(json.dumps({'deployed': True, 'host': args.host, 'container': 'vobarna-crawl-monitor', 'state_preserved': True}))


if __name__ == '__main__':
    main()
