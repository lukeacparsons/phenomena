import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Never print environment values or response bodies in failures.
export function loadSecrets(paths = ['.deploy-secrets/bunny.env', '.deploy-secrets/posthog.env', '.deploy-secrets/visitor-telegram.env']) {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export function saveFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

export const saveJSON = (path, value) => saveFile(path, JSON.stringify(value, null, 2) + '\n');
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export const isMain = url => process.argv[1] && new URL(url).pathname === process.argv[1];
