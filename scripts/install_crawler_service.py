#!/usr/bin/env python3
"""Install/restart this project's macOS LaunchAgent; never alter another service."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.vobarna.crawler'


def configuration(root=ROOT, node=None):
    node = node or shutil.which('node')
    if not node:
        raise RuntimeError('Node is required for authenticated Wrangler heartbeats')
    logs = root / 'output/crawler-service'
    return {'Label': LABEL, 'ProgramArguments': [str(root / '.venv/bin/python'), '-u', str(root / 'scripts/run_crawler.py')],
            'WorkingDirectory': str(root), 'RunAtLoad': True, 'KeepAlive': True,
            'ThrottleInterval': 60, 'ProcessType': 'Background', 'ExitTimeOut': 15,
            # Select the tested Node installation: mixing arm64/x86 Node runtimes
            # can prevent Wrangler's native dependencies from starting.
            'EnvironmentVariables': {'PATH': str(Path(node).parent) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'},
            'StandardOutPath': str(logs / 'stdout.log'), 'StandardErrorPath': str(logs / 'stderr.log')}


def main():
    if sys.platform != 'darwin':
        raise RuntimeError('Use your service manager to run scripts/run_crawler.py on this platform')
    path = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    config = configuration()
    if path.exists():
        old = plistlib.loads(path.read_bytes())
        if old.get('WorkingDirectory') != str(ROOT):
            raise RuntimeError('An existing crawler service belongs to another checkout')
        subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}', str(path)], check=False, capture_output=True)
    (ROOT / 'output/crawler-service').mkdir(parents=True, exist_ok=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(plistlib.dumps(config))
    path.chmod(0o600)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
    print('Installed ' + LABEL + '; logs: ' + str(ROOT / 'output/crawler-service'))


if __name__ == '__main__':
    main()
