"""Run each publication with the current on-disk generator and its imports."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / '.site'


def build(*, output=PUBLIC):
    # Watchers can live for days. Importing the generator once silently republishes
    # old templates after a code change, even while copying the newest JS assets.
    command = [sys.executable, str(ROOT / 'scripts/build_public_site.py'), '--output', str(output)]
    if os.environ.get('VOBARNA_REGISTRY_PATH'):
        command.extend(['--registry', os.environ['VOBARNA_REGISTRY_PATH']])
    try:
        result = subprocess.run(command, cwd=ROOT, check=True,
                                capture_output=True, text=True, timeout=600)
    except subprocess.CalledProcessError as error:
        # Preserve the rejection reason and review-report path in watcher logs.
        if error.stderr:
            print(error.stderr, file=sys.stderr, end='')
        raise
    if result.stderr:
        print(result.stderr, file=sys.stderr, end='')
    return json.loads(result.stdout.strip().splitlines()[-1])
