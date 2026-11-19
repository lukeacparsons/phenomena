import { readFile } from 'node:fs/promises';

export const projectId = 751818;
export const name = 'VO Barna → Telegram · Visitor sessions';
export const base = `https://us.posthog.com/api/projects/${projectId}`;

export async function definition({ enabled = false } = {}) {
  const [hog, query, body] = await Promise.all([
    readFile(new URL('./visitor-alert.hog', import.meta.url), 'utf8'),
    readFile(new URL('./visitor-history.sql', import.meta.url), 'utf8'),
    readFile(new URL('./visitor-message.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  return {
    type: 'destination', name, enabled,
    description: 'One alert per production browser/session. New vs returning comes from prior recorded sessions for the same anonymous browser ID. Includes source, approximate location, device and past visit history. Internal/test traffic excluded. Missing history or browser storage is explicitly unclassified. No historical replay.',
    hog,
    inputs_schema: [
      { key: 'telegram_url', label: 'Telegram endpoint', type: 'string', required: true, secret: true, templating: false },
      { key: 'posthog_headers', label: 'PostHog query authentication', type: 'dictionary', required: true, secret: true, templating: false },
      { key: 'query', label: 'Parameterized session history query', type: 'string', required: true, templating: false },
      { key: 'body', label: 'Telegram message', type: 'json', required: true },
      { key: 'dry_run', label: 'Preview without Telegram delivery', type: 'boolean', default: false, required: false },
      { key: 'handled_http_statuses', label: 'HTTP statuses handled by notification logic', type: 'non_failure_status_codes', required: false },
    ],
    inputs: { query: { value: query }, body: { value: body }, dry_run: { value: false }, handled_http_statuses: { value: ['4xx', '5xx'] } },
    filters: {
      source: 'events', filter_test_accounts: true,
      events: ['$pageview', 'ticket_click', 'screening_open', 'search_results'].map(id => ({
        id, name: id, type: 'events', properties: [{ key: '$session_id', type: 'event', operator: 'is_set' }],
      })),
      properties: [
        { key: '$host', type: 'event', operator: 'exact', value: ['vobarna.com', 'www.vobarna.com'] },
        { key: 'internal_user', type: 'event', operator: 'is_not', value: ['true'] },
        { key: 'visitor_alert_version', type: 'event', operator: 'exact', value: ['1'] },
      ],
    },
    masking: { ttl: 86400, hash: "{concat(event.distinct_id, ':', event.properties.$session_id)}" },
  };
}

export function api(key) {
  if (!key || /[\r\n]/.test(key)) throw Error('Set POSTHOG_API_KEY in an ignored environment file.');
  return async (path, { method = 'GET', body } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw Error('Expected a project-relative API path.');
    const response = await fetch(base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Never log request bodies, credentials or an untrusted server response.
    if (!response.ok) throw Error(`PostHog ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

export async function findDestination(request) {
  const matches = [];
  for (let offset = 0; ; offset += 100) {
    const page = await request(`/hog_functions/?limit=100&offset=${offset}`);
    matches.push(...page.results.filter(f => f.name === name));
    if (!page.next) break;
    if (offset >= 5000) throw Error('Unexpected destination pagination.');
  }
  if (matches.length > 1) throw Error('Multiple VO Barna visitor destinations exist; resolve duplicates first.');
  return matches[0];
}
