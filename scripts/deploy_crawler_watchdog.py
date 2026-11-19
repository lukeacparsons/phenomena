#!/usr/bin/env python3
"""Update the prepared watchdog bundle without uploading assets or changing secrets.

The initial audited deployment saves the unmodified production worker under
output/crawler-watchdog-deploy/original-worker.mjs. The wrapper delegates every
existing HTTP request and the original cron to that preserved worker.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tomllib
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Deploy the checked bundle; otherwise just validate it')
    args = parser.parse_args()
    folder = ROOT / 'output/crawler-watchdog-deploy'
    if not (folder / 'original-worker.mjs').exists():
        raise RuntimeError('The preserved production Worker is missing; download and review it before deploying')
    subprocess.run([str(ROOT / 'node_modules/.bin/wrangler'), 'deploy', '--dry-run', '--config',
                    str(folder / 'wrangler.json'), '--outdir', 'bundle'], cwd=ROOT, check=True, timeout=120)
    if not args.apply:
        return
    config = tomllib.loads((ROOT / 'wrangler.toml').read_text())
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:
        token = tomllib.loads((Path.home() / 'Library/Preferences/.wrangler/config/default.toml').read_text())['oauth_token']
    base = f"https://api.cloudflare.com/client/v4/accounts/{config['account_id']}/workers/scripts/{config['name']}"
    def request(suffix, method='GET', body=None, content_type=None):
        headers = {'Authorization': 'Bearer ' + token}
        if content_type:
            headers['Content-Type'] = content_type
        with urllib.request.urlopen(urllib.request.Request(base + suffix, data=body, headers=headers, method=method), timeout=60) as response:
            return response.read(), response.headers
    # Refuse to overwrite a newer deployment by somebody else.
    from email.parser import BytesParser
    from email.policy import default
    raw, headers = request('')
    message = BytesParser(policy=default).parsebytes(('Content-Type: ' + headers['Content-Type'] + '\r\n\r\n').encode() + raw)
    parts = list(message.iter_parts())
    recorded = json.loads((folder / 'deployment.json').read_text())
    if len(parts) != 1 or hashlib.sha256(parts[0].get_payload(decode=True)).hexdigest() != recorded['code_sha256']:
        raise RuntimeError('The deployed Worker changed; inspect it before updating the watchdog')
    before, _ = request('/settings')
    script = (folder / 'bundle/wrapper.js').read_bytes()
    boundary = 'crawler-' + uuid.uuid4().hex
    payload = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'
               + json.dumps({'main_module': 'worker.mjs'})
               + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n').encode() + script + f'\r\n--{boundary}--\r\n'.encode()
    result, _ = request('/content', 'PUT', payload, 'multipart/form-data; boundary=' + boundary)
    if not json.loads(result)['success']:
        raise RuntimeError('Worker update failed')
    after, _ = request('/settings')
    old, new = json.loads(before)['result'], json.loads(after)['result']
    old.pop('annotations', None)
    new.pop('annotations', None)
    if old != new:
        raise RuntimeError('Unexpected Worker settings change; inspect the deployment')
    recorded['code_sha256'] = hashlib.sha256(script).hexdigest()
    (folder / 'deployment.json').write_text(json.dumps(recorded, indent=2) + '\n')
    print('Watchdog deployed; production bindings, secrets, assets and settings retained.')


if __name__ == '__main__':
    main()
