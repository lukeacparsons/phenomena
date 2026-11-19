#!/usr/bin/env python3
"""Build and redeploy only the VO Barna origin container through Coolify."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--coolify-env', type=Path, help='Local env file holding COOLIFY_API_TOKEN; values are never printed')
    args = parser.parse_args()
    token = os.environ.get('COOLIFY_API_TOKEN')
    if args.coolify_env:
        for line in args.coolify_env.expanduser().read_text().splitlines():
            match = re.match(r'\s*(?:export\s+)?COOLIFY_API_TOKEN\s*=\s*(.*)', line)
            if match:
                token = shlex.split(match[1])[0]
    if not token:
        raise SystemExit('Set COOLIFY_API_TOKEN or pass --coolify-env')
    config = json.loads((ROOT / 'deploy/vobarna/deployment.json').read_text())
    opener = urllib.request.build_opener(NoRedirect)

    def api(path, data=None, method=None):
        request = urllib.request.Request(config['coolify_api'] + path,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
            data=json.dumps(data).encode() if data is not None else None, method=method)
        try:
            with opener.open(request, timeout=90) as response:
                body = response.read()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            raise SystemExit(f'Coolify returned HTTP {error.code}') from None

    service = api('/services/' + config['service_uuid'])
    if service['name'] != 'vobarna':
        raise SystemExit('Unexpected Coolify service; refusing deployment')
    files = ['deploy/vobarna/Dockerfile', 'src/vobarna-server.mjs', 'src/public-routing.mjs']
    digest = hashlib.sha256(b''.join((ROOT / path).read_bytes() for path in files)).hexdigest()[:12]
    image = 'vobarna-web:' + digest
    context = '/opt/vobarna/build-' + digest
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as tar:
        for path in files:
            tar.add(ROOT / path, arcname=path)
    key = api('/security/keys/' + config['server_key_uuid'])['private_key']
    # Use the existing server credential only for this process. The routine
    # publication service has a separate unprivileged SSH identity.
    with tempfile.NamedTemporaryFile(mode='w', prefix='vobarna-admin-') as identity:
        identity.write(key + '\n')
        identity.flush()
        os.chmod(identity.name, 0o600)
        ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes',
               '-o', 'ConnectTimeout=15', '-i', identity.name, 'root@' + config['server_ip']]
        command = f'mkdir -p {context} && tar -xf - -C {context} && docker build --memory=512m --cpu-shares=256 -f {context}/deploy/vobarna/Dockerfile -t {image} {context}'
        subprocess.run([*ssh, command], input=archive.getvalue(), check=True, timeout=600)
    compose_path = ROOT / 'deploy/vobarna/compose.yaml'
    compose, count = re.subn(r'(?m)^    image: .*$', '    image: ' + image, compose_path.read_text())
    if count != 1:
        raise SystemExit('Unexpected compose definition')
    api('/services/' + config['service_uuid'], {'docker_compose_raw': base64.b64encode(compose.encode()).decode()}, 'PATCH')
    compose_path.write_text(compose)
    api('/services/' + config['service_uuid'] + '/restart', {}, 'POST')
    print(json.dumps({'event':'origin_deployment_queued','image':image,'service':config['service_uuid']}))


if __name__ == '__main__':
    main()
