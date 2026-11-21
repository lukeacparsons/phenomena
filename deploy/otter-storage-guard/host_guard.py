#!/usr/bin/env python3
"""Otter storage policy. Never prune Docker volumes, databases or report archives."""
import argparse
import fcntl
import gzip
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.request

GIB = 1024 ** 3
PAYLOADS = {'source', 'first-source', 'committed-source', 'recovery-source',
            'web-bundle', 'stage-media', 'native-checks', 'source.tar',
            'source.tar.gz', 'recovery-source.tar', 'candidate.tar.gz'}
STAGE = re.compile(r'ojo-[a-z0-9-]*(?:stage|release|analysis)-20\d{6}(?:-[a-z0-9-]+)?$')
BUNDLE = re.compile(r'\d+-[a-f0-9]{12}-[a-f0-9]{8}$')


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=60, **kwargs)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n')
    tmp.chmod(0o600)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def disk_level(percent, available):
    if percent >= 85 or available < 5 * GIB:
        return 2
    if percent >= 75 or available < 10 * GIB:
        return 1
    return 0


def disks(config):
    result = []
    for path in config['mounts']:
        if not os.path.ismount(path):
            raise RuntimeError('Expected filesystem is not mounted: ' + path)
        s = os.statvfs(path)
        used = (s.f_blocks - s.f_bfree) * s.f_frsize
        available = s.f_bavail * s.f_frsize
        percent = math.ceil(100 * used / (used + available))
        result.append({'mount': path, 'used_percent': percent,
                       'available_bytes': available, 'level': disk_level(percent, available)})
    if len({os.stat(x['mount']).st_dev for x in result}) != len(result):
        raise RuntimeError('The root disk and attached volume must be distinct filesystems')
    return result


def preflight(config):
    values = disks(config)
    for d in values:
        if d['available_bytes'] < 5 * GIB:
            raise RuntimeError(f"Build refused: {d['mount']} has less than 5 GiB free")
    return values


def containers():
    ids = run(['docker', 'ps', '-aq'], text=True).stdout.split()
    return json.loads(run(['docker', 'inspect', *ids], text=True).stdout) if ids else []


def references(cs):
    refs = [m['Source'] for c in cs for m in c['Mounts']]
    refs += [p for p in run(['findmnt', '-rn', '-o', 'TARGET'], text=True).stdout.splitlines()
             if p not in ['/', '/mnt/volume-fsn1-1', '/mnt/HC_Volume_105572264']]
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            files = [proc / 'cwd', proc / 'exe', *(proc / 'fd').iterdir()]
            for p in files:
                try:
                    refs.append(os.readlink(p))
                except FileNotFoundError:
                    pass
        except FileNotFoundError:
            pass
    return refs


def referenced(path, refs):
    value = str(path)
    return any(r == value or r.startswith(value + '/') or value.startswith(r.rstrip('/') + '/')
               for r in refs if r not in ['/', '/opt', '/var', '/var/tmp', '/mnt'])


def tree_metadata(path):
    s = path.lstat()
    if stat.S_ISLNK(s.st_mode):
        raise ValueError('Symlink target')
    newest, blocks = s.st_mtime, s.st_blocks * 512
    def fail(error):
        raise error
    for folder, dirs, files in os.walk(path, followlinks=False, onerror=fail):
        for name in dirs + files:
            p = Path(folder) / name
            child = p.lstat()
            if child.st_dev != s.st_dev:
                raise ValueError('Nested filesystem')
            newest = max(newest, child.st_mtime)
            blocks += child.st_blocks * 512
    return {'inode': s.st_ino, 'device': s.st_dev, 'newest': newest, 'bytes': blocks}


def candidates(config, now):
    result = []
    # Legacy build exports only: named payloads in dated Ojo staging directories.
    for parent in config['legacy_stage_parents']:
        if not Path(parent).exists():
            continue
        for folder in Path(parent).iterdir():
            if STAGE.fullmatch(folder.name) and folder.is_dir() and not folder.is_symlink():
                result.extend((p, 7 * 86400) for p in folder.iterdir() if p.name in PAYLOADS)
    # Preserve the two newest queue bundles, the pending bundle, and all receipts.
    queue_root = Path(config['queue_root'])
    queue = read_json(queue_root / 'queue-state.json', {})
    pending = (queue.get('pending') or {}).get('bundle')
    bundles_root = queue_root / 'bundles'
    if bundles_root.exists():
        bundles = sorted([p for p in bundles_root.iterdir()
                          if BUNDLE.fullmatch(p.name) and not p.is_symlink() and p.is_dir()],
                         key=lambda p: p.stat().st_mtime, reverse=True)
        protected_sequences = set(sorted({int(p.name.split('-', 1)[0]) for p in bundles})[-2:])
        active_sequence = (queue.get('lastResult') or {}).get('sequence')
        if isinstance(active_sequence, int):
            protected_sequences.update([active_sequence, active_sequence - 1])
        for bundle in bundles:
            if int(bundle.name.split('-', 1)[0]) in protected_sequences:
                continue
            if str(bundle) != pending and (bundle / 'artifact').exists():
                result.append((bundle / 'artifact', 7 * 86400))
    # New jobs have explicit status metadata written by otter-build below.
    for folder in Path(config['build_root']).iterdir():
        if folder.is_symlink() or not folder.is_dir():
            continue
        receipt = read_json(folder / 'receipt.json', {})
        if receipt.get('status') not in ['success', 'failed']:
            continue
        payload = folder / 'payload'
        if payload.exists():
            result.append((payload, 0 if receipt['status'] == 'success' else 7 * 86400))
    return result


def cleanup_payloads(config, cs, apply=False, now=None):
    now = time.time() if now is None else now
    # The old builder holds this lock across building, transfer and publication.
    with (Path(config['queue_root']) / 'queue.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'skipped': 'Ojo release queue is active', 'removed': []}
        if any('coolify-helper' in c['Config']['Image'] and c['State']['Status'] == 'running' for c in cs):
            return {'skipped': 'Coolify is building/deploying', 'removed': []}
        refs = references(cs)
        queue = read_json(Path(config['queue_root']) / 'queue-state.json', {})
        if (queue.get('pending') or {}).get('bundle'):
            refs.append(queue['pending']['bundle'])
        selected, skipped = [], []
        for path, age in candidates(config, now):
            try:
                if path.is_symlink() or referenced(path, refs):
                    continue
                meta = tree_metadata(path)
                if now - meta['newest'] < age:
                    continue
                if apply:
                    # Recheck open files and the tree immediately before removal.
                    if referenced(path, references(cs)) or tree_metadata(path) != meta:
                        skipped.append(str(path))
                        continue
                    if path.is_dir():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
                selected.append({'path': str(path), 'bytes': meta['bytes']})
            except (FileNotFoundError, ValueError):
                skipped.append(str(path))
        return {'applied': apply, 'removed' if apply else 'candidates': selected, 'changed_or_unsafe': skipped}


def rotate_file(path, archive, limit=10 * 1024 ** 2):
    """Bounded copytruncate: retains up to three compressed rotations, at most limit each."""
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_size <= limit:
            return None
        archive.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Even a legacy runaway log cannot make its rotated copy unbounded.
        os.lseek(fd, max(0, s.st_size - limit), os.SEEK_SET)
        content = os.read(fd, limit)
        if s.st_size > limit and b'\n' in content:
            content = content.split(b'\n', 1)[1]
        tmp = Path(str(archive) + '.tmp')
        with gzip.open(tmp, 'wb') as out:
            out.write(content)
        tmp.chmod(0o600)
        for i in [3, 2]:
            old = Path(str(archive) + f'.{i-1}.gz')
            if old.exists():
                os.replace(old, Path(str(archive) + f'.{i}.gz'))
        os.replace(tmp, Path(str(archive) + '.1.gz'))
        os.ftruncate(fd, 0)
        return {'path': str(path), 'before': s.st_size, 'after': 0}
    finally:
        os.close(fd)


def rotate_container_logs(config, cs):
    result = []
    for c in cs:
        labels = c['Config'].get('Labels') or {}
        if labels.get('coolify.resourceName') != 'plunk-mail' or not c['Name'].startswith('/plunk-'):
            continue
        if c['State']['Status'] != 'running':
            continue
        pid = c['State']['Pid']
        root = Path(f'/proc/{pid}/root')
        for rel in ['home/plunk/.pm2/logs', 'var/log/nginx']:
            folder = root / rel
            if not folder.is_dir() or any((root / Path(*Path(rel).parts[:i])).is_symlink()
                                          for i in range(1, len(Path(rel).parts) + 1)):
                continue
            for path in folder.glob('*.log'):
                if path.is_symlink():
                    continue
                current = json.loads(run(['docker', 'inspect', c['Id']], text=True).stdout)[0]
                if current['State']['Status'] != 'running' or current['State']['Pid'] != pid:
                    break
                # Stable archive location keeps the bound across container replacements too.
                archive = Path(config['log_archive']) / 'plunk-mail' / path.name
                item = rotate_file(path, archive)
                if item:
                    result.append(item)
    return result


def rotate_build_logs(config, now):
    result = []
    for folder in Path(config['build_root']).iterdir():
        if folder.is_symlink() or not folder.is_dir():
            continue
        receipt = read_json(folder / 'receipt.json', {})
        if receipt.get('status') not in ['running', 'success', 'failed']:
            continue
        path = folder / 'build.log'
        archive = folder / 'build.log'
        if receipt['status'] != 'running' and now - receipt.get('completed_at', now) >= 30 * 86400:
            for old in [path, *(Path(str(archive) + f'.{i}.gz') for i in [1, 2, 3])]:
                if old.is_file() and not old.is_symlink():
                    old.unlink()
            continue
        if path.is_file() and not path.is_symlink():
            item = rotate_file(path, archive)
            if item:
                result.append(item)
    return result


def telegram(config, message):
    settings = config.get('telegram')
    if not settings:
        raise RuntimeError('Telegram destination is not configured')
    token = None
    for line in Path(settings['env_file']).read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() == settings['token_key']:
            token = value.strip().strip('\"\'')
    if not token or not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+', token):
        raise RuntimeError('Telegram credential is missing or malformed')
    data = json.dumps({'chat_id': settings['chat_id'], 'message_thread_id': settings['topic_id'],
                       'text': message, 'disable_web_page_preview': True}).encode()
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage',
                                     data=data, headers={'Content-Type': 'application/json'})
    # Never include exceptions containing the credential-bearing request URL in logs.
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
        if not result.get('ok'):
            raise RuntimeError('Telegram rejected notification')
        return result['result']['message_id']
    except Exception:
        raise RuntimeError('Telegram notification failed; will retry') from None


def alert_decision(state, level, now, values):
    old = state.get('alert_level', 0)
    # Require a margin before announcing recovery, preventing threshold flapping.
    recovered = all(d['used_percent'] <= 70 and d['available_bytes'] >= 11 * GIB for d in values)
    if level == 0 and old and not recovered:
        return False
    interval = 3600 if level == 2 else 6 * 3600
    return (level > old or (level == 0 and old and recovered) or
            (level > 0 and now - state.get('alert_sent_at', 0) >= interval))


def tick(config):
    state_path = Path(config['state_dir']) / 'status.json'
    previous = read_json(state_path, {})
    now = time.time()
    errors, values = [], []
    try:
        values = disks(config)
    except Exception as e:
        errors.append(str(e))
    rotations = []
    cleanup = None
    try:
        cs = containers()
        rotations = rotate_container_logs(config, cs)
        rotations += rotate_build_logs(config, now)
        if now - previous.get('last_payload_check', 0) >= 3600:
            cleanup = cleanup_payloads(config, cs, apply=True)
            previous['last_payload_check'] = now
    except Exception as e:
        errors.append('Maintenance failed: ' + type(e).__name__)
    level = max([d['level'] for d in values] + [2 if errors else 0])
    notification = None
    if alert_decision(previous, level, now, values):
        label = ['RECOVERED', 'WARNING', 'CRITICAL'][level]
        message = f'Outrageous Otter storage — {label}\n' + '\n'.join(
            f"{d['mount']}: {d['used_percent']}% used, {d['available_bytes']/GIB:.1f} GiB free" for d in values)
        if errors:
            message += '\n' + '\n'.join(errors)
        message += '\nChecks run every 5 minutes; persistent data and backups are protected.'
        notification = telegram(config, message)
        previous.update(alert_level=level, alert_sent_at=now)
    previous.update(checked_at=now, disks=values, errors=errors, log_rotations=rotations)
    if cleanup is not None:
        previous['payload_cleanup'] = cleanup
    atomic_json(state_path, previous)
    return {'checked_at': now, 'disks': values, 'errors': errors,
            'rotated_logs': len(rotations), 'payload_cleanup': cleanup, 'notification_id': notification}


def build(config, label, command):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,50}', label) or not command:
        raise ValueError('Use a short lowercase label and a command after --')
    preflight(config)
    folder = Path(config['build_root']) / (time.strftime('%Y%m%dT%H%M%S') + '-' + label + '-' + str(os.getpid()))
    folder.mkdir(mode=0o700)
    payload = folder / 'payload'
    payload.mkdir()
    receipt = {'label': label, 'started_at': time.time(), 'status': 'running'}
    atomic_json(folder / 'receipt.json', receipt)
    with (folder / 'build.log').open('ab') as log:
        process = subprocess.run(command, cwd=payload, stdout=log, stderr=subprocess.STDOUT)
    receipt.update(status='success' if process.returncode == 0 else 'failed',
                   completed_at=time.time(), exit_code=process.returncode)
    atomic_json(folder / 'receipt.json', receipt)
    # A detached child or mounted output may still own this directory.
    if process.returncode == 0 and not referenced(payload, references(containers())):
        shutil.rmtree(payload)
    print(json.dumps({'record': str(folder), **receipt}))
    return process.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='/etc/otter-storage-guard/config.json')
    parser.add_argument('command', choices=['status', 'tick', 'plan', 'preflight', 'notify', 'build'])
    parser.add_argument('args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    config = read_json(args.config)
    if args.command == 'status':
        output = {'disks': disks(config), 'last_check': read_json(Path(config['state_dir']) / 'status.json')}
    elif args.command == 'preflight':
        output = {'allowed': True, 'disks': preflight(config)}
    elif args.command == 'notify':
        output = {'message_id': telegram(config, ' '.join(args.args))}
    elif args.command == 'build':
        command = args.args[1:]
        if command and command[0] == '--':
            command = command[1:]
        return build(config, args.args[0], command)
    else:
        Path(config['state_dir']).mkdir(parents=True, exist_ok=True, mode=0o700)
        with (Path(config['state_dir']) / 'guard.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            output = tick(config) if args.command == 'tick' else cleanup_payloads(config, containers())
    print(json.dumps(output))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        sys.exit(1)
