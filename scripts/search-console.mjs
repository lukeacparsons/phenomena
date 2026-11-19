import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { kindOfPath } from './crawler-visits.mjs';
import { saveFile, saveJSON, stamp, isMain } from './traffic-io.mjs';

export const PROFILE_PATH = '.deploy-secrets/search-console-profile.json';
export const TIME_ZONE = 'America/Los_Angeles';
export async function collectSearchConsole({ days = 10, from, to, final = false, profilePath = PROFILE_PATH, fetchImpl = fetch } = {}) {
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  if (profile.siteUrl !== 'sc-domain:vobarna.com') throw Error('Search Console profile must target sc-domain:vobarna.com');
  let token = process.env.SEARCH_CONSOLE_TOKEN;
  if (!token) {
    const result = spawnSync(profile.gcloudBinary, ['auth', 'application-default', 'print-access-token'], {
      env: { ...process.env, CLOUDSDK_CONFIG: profile.gcloudConfig }, encoding: 'utf8', timeout: 30000,
    });
    if (result.status !== 0 || !result.stdout?.trim()) throw Error('Search Console local gcloud authentication unavailable');
    token = result.stdout.trim();
  }
  to ??= new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!from) { const start = new Date(`${to}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - Number(days) + 1); from = start.toISOString().slice(0, 10); }
  if (![from, to].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from > to) throw Error('Invalid Search Console date range');
  const dataState = final ? 'final' : 'all';
  const query = async (dimensions, state = dataState) => {
    const rows = [];
    for (let startRow = 0; startRow < 100000; startRow += 25000) {
      const response = await fetchImpl(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(profile.siteUrl)}/searchAnalytics/query`, {
        method: 'POST', signal: AbortSignal.timeout(45000), redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': profile.quotaProject, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: from, endDate: to, dimensions, dataState: state, type: 'web', rowLimit: 25000, startRow }),
      });
      if (!response.ok) throw Error(`Search Console HTTP ${response.status}`);
      const data = await response.json(); rows.push(...(data.rows ?? []));
      if ((data.rows?.length ?? 0) < 25000) return rows;
    }
    throw Error('Search Console row limit reached; narrow the report window');
  };
  const dimensions = {};
  for (const [name, dims] of Object.entries({ date: ['date'], page: ['page'], query: ['query'], country: ['country'], device: ['device'], queryPage: ['query', 'page'], datePage: ['date', 'page'], queryCountry: ['query', 'country'] })) dimensions[name] = await query(dims);
  const finalDates = (await query(['date'], 'final')).map(row => row.keys[0]);
  return { available: true, property: profile.siteUrl, collectedAt: new Date().toISOString(), from, to, timeZone: TIME_ZONE, dataState, finalDates, dimensions };
}

export function renderSearchConsole(data, { top = 15 } = {}) {
  if (!data.available) return `GOOGLE SEARCH CONSOLE\n  Unavailable: ${data.reason}`;
  const out = [`GOOGLE SEARCH CONSOLE · ${data.property} · ${data.from} → ${data.to} (${TIME_ZONE})`,
    'Clicks and impressions are separate from edge referrals. Query breakdowns omit anonymized queries; never add dimensions.'];
  for (const key of ['date', 'country', 'page', 'query', 'device']) {
    out.push(`  ${key}: clicks | impressions | CTR | average position`);
    const rows = key === 'date' ? data.dimensions[key] : [...data.dimensions[key]].sort((a, b) => b.impressions - a.impressions).slice(0, top);
    for (const r of rows) {
      const label = r.keys.join(' · '), suffix = key === 'date' ? (data.finalDates.includes(label) ? ' [final]' : ' [fresh; may change]') : key === 'page' ? ` [${kindOfPath(new URL(label).pathname)}]` : '';
      out.push(`    ${label}${suffix}: ${r.clicks} | ${r.impressions} | ${(r.ctr * 100).toFixed(1)}% | ${r.position.toFixed(1)}`);
    }
    if (!rows.length) out.push('    No rows returned. A new property or delayed processing can have no data yet.');
  }
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { days: { type: 'string', default: '10' }, from: { type: 'string' }, to: { type: 'string' }, final: { type: 'boolean' }, profile: { type: 'string' }, out: { type: 'string' }, json: { type: 'string' }, top: { type: 'string', default: '15' } } });
    const data = await collectSearchConsole({ days: Number(values.days), from: values.from, to: values.to, final: values.final, profilePath: values.profile });
    const base = `output/search-console/${stamp()}`, out = values.out ?? `${base}.txt`, json = values.json ?? `${base}.json`;
    const report = renderSearchConsole(data, { top: Number(values.top) }); saveJSON(json, data); saveFile(out, report + '\n');
    console.log(`${report}\nSaved ${out}\nSaved ${json}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
