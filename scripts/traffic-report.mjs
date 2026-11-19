import { parseArgs } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fetchLogs, fetchAddressLists, parseLine, siteRequest, isOwn, crawlerOf, providerOf, isAutonomous, addressEvidence, hasAddress, kindOfPath, isPage, PULL_ZONE } from './crawler-visits.mjs';
import { sourceOf, previewOf, botName, describeAgent } from './traffic-classification.mjs';
import { loadSecrets, saveFile, saveJSON, stamp, isMain } from './traffic-io.mjs';
import { browserSummary } from './traffic-posthog.mjs';
import { collectSearchConsole, renderSearchConsole } from './search-console.mjs';

const PROBE = /wp-|\.php\b|xmlrpc|wlwmanifest|\/\.(claude|cursor|mcp|env|git|aws|bashrc)\b|\/(AGENTS?|CLAUDE)\.md\b|phpinfo|cgi-bin|credentials|\.sql\b|\.bak\b|169\.254\.169\.254|metadata\.google\.internal|[?&]url=https?(%3A|:)/i;
const bump = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n; };
const top = (obj, n = 8) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
export function enrich(record, lists) {
  let url; try { url = new URL(record.url); } catch { return null; }
  if (!siteRequest(record)) return null;
  const path = url.pathname, crawler = crawlerOf(record.agent), preview = previewOf(record.agent);
  let category = 'browser candidate';
  if (isOwn(record)) category = 'own/test';
  else if (PROBE.test(path + url.search)) category = 'scanner';
  else if (crawler) category = isAutonomous(crawler) ? 'crawler' : 'user-triggered/service fetch';
  else if (preview) category = 'link preview';
  else if (botName(record.agent)) category = 'other bot';
  return { ...record, path, kind: kindOfPath(path), html: isPage(path), crawler, preview, category,
    source: sourceOf({ ...record, params: url.searchParams }), evidence: crawler ? addressEvidence(record, lists) : null };
}

// Only non-removed addresses support even approximate grouping. Never merge all 0.0.0.0 records
// into a visitor, or treat a page request with no assets as a confirmed person.
export function visitsOf(records) {
  const groups = new Map(), visits = [];
  for (const r of records.filter(r => r.category === 'browser candidate' && hasAddress(r.address)).sort((a, b) => a.at - b.at)) {
    const key = `${r.address}|${r.agent}`;
    let group = groups.get(key);
    if (!group || r.at - group.last > 30 * 60000) {
      group = { first: +r.at, last: +r.at, country: r.country, device: describeAgent(r.agent).label, pages: [], assets: 0, requests: 0, errors: 0, source: null };
      groups.set(key, group); visits.push(group);
    }
    group.last = +r.at; group.requests++; group.errors += Number(r.status >= 500);
    if (r.html) { group.pages.push(r.path); group.source ??= r.source; }
    if (r.kind === 'assets') group.assets++;
  }
  return visits.filter(v => v.pages.length).map(v => ({ ...v, elapsedSeconds: Math.round((v.last - v.first) / 1000),
    classification: v.pages.length >= 20 && v.last - v.first < 60000 ? 'rapid page-reader candidate' : v.assets ? 'browser session candidate' : 'page fetches; human uncertain' }));
}

export function analyse(input, lists = new Map(), { from, to } = {}) {
  const unique = new Map();
  for (const r of input) if ((!from || r.at >= new Date(from)) && (!to || r.at < new Date(to))) unique.set(r.id || `${r.at}|${r.url}|${r.agent}`, r);
  const records = [...unique.values()].map(r => enrich(r, lists)).filter(Boolean).sort((a, b) => a.at - b.at);
  const categories = {}, days = {}, hours = {}, crawlers = {}, referrals = {}, previews = {}, notFound = {}, errors = {}, pages = {};
  for (const r of records) {
    const day = r.at.toISOString().slice(0, 10), hour = r.at.toISOString().slice(0, 13);
    bump(categories, r.category); bump(days, day); bump(hours, hour);
    if (r.status >= 500) bump(errors, `${hour}:00Z · ${r.status} · ${r.category}`);
    if (r.status === 404 && r.category !== 'scanner' && r.category !== 'own/test') bump(notFound, r.path);
    if (r.crawler && r.category !== 'own/test') {
      const c = crawlers[r.crawler] ??= { provider: providerOf(r.crawler), purpose: isAutonomous(r.crawler) ? 'autonomous crawl' : 'user-triggered/service fetch', hits: 0, evidence: {}, paths: {}, statuses: {}, days: {}, first: r.at.toISOString(), last: r.at.toISOString() };
      c.hits++; c.last = r.at.toISOString(); bump(c.evidence, r.evidence); bump(c.paths, r.path); bump(c.statuses, r.status); bump(c.days, day);
    }
    if (r.category === 'link preview' && r.html) { const p = previews[r.preview] ??= { pageFetches: 0, paths: {} }; p.pageFetches++; bump(p.paths, r.path); }
    if (r.category === 'browser candidate' && r.html) { bump(referrals, r.source.name); bump(pages, r.path); }
  }
  return { generatedAt: new Date().toISOString(), zone: PULL_ZONE, requestedWindow: { from, to },
    observedWindow: records.length ? { first: records[0].at.toISOString(), last: records.at(-1).at.toISOString() } : null,
    requests: records.length, addressesRemoved: records.filter(r => !hasAddress(r.address)).length,
    categories, days, hours, crawlers, referrals, previews, notFound, errors, pages, visits: visitsOf(records),
    listsFetched: lists.size > 0, listFailures: [...lists].filter(([, v]) => v === null).map(([k]) => k) };
}

export function render(summary, { visits = 30 } = {}) {
  const s = summary;
  const out = [`VO Barna · Traffic and crawl report · ${s.generatedAt}`, `Requested UTC window: ${s.requestedWindow.from} → ${s.requestedWindow.to}`,
    `Observed: ${s.observedWindow ? `${s.observedWindow.first} → ${s.observedWindow.last}` : 'no records returned'} · ${s.requests} edge requests`,
    `Address removed on ${s.addressesRemoved}/${s.requests} requests. Masked-address groups are estimates, never unique people.`,
    'Today is partial; empty logs are not proof of no activity. CDN logs exclude direct-origin traffic.', '', 'REQUEST CLASSIFICATION'];
  for (const [name, count] of top(s.categories, 20)) out.push(`  ${name}: ${count}`);
  out.push('', 'REQUESTS PER UTC DAY'); for (const [day, count] of Object.entries(s.days)) out.push(`  ${day}: ${count}`);
  out.push('', 'BROWSER MEASUREMENT (PostHog, independent of edge requests)');
  if (s.browser?.available) {
    for (const [name, table] of Object.entries(s.browser.dimensions)) { out.push(`  ${name}: ${table.columns.join(' | ')}`); for (const row of table.rows) out.push(`    ${row.join(' | ')}`); }
    out.push('  Sessions/IDs are observed browser activity, not people. Blockers, DNT/GPC and no-JS visits are absent. Dimensions overlap; do not add them.');
  } else out.push(`  Unavailable: ${s.browser?.reason ?? 'not requested'}`);
  out.push('', 'BROWSER-CANDIDATE PAGE REQUEST SOURCES (requests, not visits)');
  for (const [name, count] of top(s.referrals, 20)) out.push(`  ${name}: ${count}`);
  out.push('', 'EDGE SESSION ESTIMATES');
  if (!s.visits.length) out.push('  Unavailable: no browser groups with usable anonymized addresses. Do not estimate visitors from user agents alone.');
  for (const v of s.visits.slice(-visits)) out.push(`  ${new Date(v.first).toISOString()} · ${v.country} · ${v.device} · ${v.source?.name} · ${v.pages.length} pages · ${v.elapsedSeconds}s first-to-last request · ${v.classification} · ${v.pages.slice(0, 4).join(', ')}`);
  out.push('', 'LINK PREVIEWS / SHARING SIGNALS');
  for (const [name, p] of Object.entries(s.previews)) out.push(`  ${name}: ${p.pageFetches} page fetches · ${top(p.paths, 4).map(([path, n]) => `${path} (${n})`).join(', ')}`);
  if (!Object.keys(s.previews).length) out.push('  No recognized preview page fetches in this window.');
  out.push('  A preview is not a confirmed share or click. Server previews do not identify a sharer; direct traffic can include messaging apps. No causal follow-on counts without corroboration.');
  out.push('', 'CRAWLERS AND ANSWER ENGINES');
  for (const [name, c] of Object.entries(s.crawlers).sort((a, b) => b[1].hits - a[1].hits)) {
    out.push(`  ${name}: ${c.hits} · ${c.purpose} · ${Object.entries(c.evidence).map(([k, v]) => `${k}: ${v}`).join(', ')} · HTTP ${Object.entries(c.statuses).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    out.push(`    ${c.first} → ${c.last} · ${top(c.paths, 4).map(([path, n]) => `${path} (${n})`).join(', ')}`);
  }
  out.push('  User agents can be spoofed. A published-prefix overlap with a masked address is supporting evidence, not exact verification. Fetches do not prove indexing, ranking or citation.');
  out.push('', '5XX WINDOWS'); for (const [name, count] of top(s.errors, 15)) out.push(`  ${name}: ${count}`);
  if (!Object.keys(s.errors).length) out.push('  None observed.');
  out.push('', '404 PATHS (excluding identified probes and own tests)'); for (const [path, count] of top(s.notFound, 15)) out.push(`  ${path}: ${count}`);
  out.push('', `Address lists: ${s.listsFetched ? (s.listFailures.length ? `unavailable for ${s.listFailures.join(', ')}` : 'all configured lists fetched') : 'not fetched; checks unavailable'}`);
  if (s.searchConsole) out.push('', renderSearchConsole(s.searchConsole));
  return out.join('\n') + '\n';
}

export async function main() {
  const { values: v } = parseArgs({ options: {
    days: { type: 'string', default: '3' }, from: { type: 'string' }, to: { type: 'string' }, visits: { type: 'string', default: '30' },
    out: { type: 'string' }, json: { type: 'string' }, logs: { type: 'string' }, save: { type: 'string' },
    'no-lists': { type: 'boolean' }, 'no-posthog': { type: 'boolean' }, 'search-console': { type: 'boolean' },
  } });
  loadSecrets();
  const days = Number(v.days), to = v.to ? new Date(v.to) : new Date(), from = v.from ? new Date(v.from) : new Date(to);
  if (!v.from) { from.setUTCHours(0, 0, 0, 0); from.setUTCDate(from.getUTCDate() - days + 1); }
  if (!Number.isInteger(days) || days < 1 || days > 3 || !Number.isFinite(+from) || !Number.isFinite(+to) || from >= to) throw Error('Use --days 1..3 or a valid --from/--to UTC interval');
  if (!v.logs && Date.now() - from > 72 * 3600000) throw Error('Live Bunny logs retain only 3 days; use saved --logs for older windows');
  let records;
  if (v.logs) {
    records = readdirSync(v.logs).filter(n => /\.(log|json)(\.gz)?$/.test(n)).flatMap(n => {
      const bytes = readFileSync(resolve(v.logs, n));
      const data = (n.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
      if (/\.log(\.gz)?$/.test(n)) return data.split('\n').map(parseLine).filter(Boolean);
      const saved = JSON.parse(data);
      if (saved.format !== 'vobarna-edge-v1') return [];
      return saved.records.map(r => ({ ...r, at: new Date(r.at) }));
    });
  } else records = await fetchLogs({ key: process.env.BUNNY_API_KEY, from, to });
  if (v.save) saveJSON(resolve(v.save, `${stamp()}.json`), { format: 'vobarna-edge-v1', from, to, records });
  const lists = v['no-lists'] ? new Map() : await fetchAddressLists();
  const summary = analyse(records, lists, { from: from.toISOString(), to: to.toISOString() });
  if (!v['no-posthog']) summary.browser = await browserSummary(from, to);
  if (v['search-console']) {
    try { summary.searchConsole = await collectSearchConsole({ days: 10 }); }
    catch (error) { summary.searchConsole = { available: false, reason: error.message }; }
  }
  const base = `output/traffic/${stamp()}`, out = v.out ?? `${base}.txt`, json = v.json ?? `${base}.json`;
  saveJSON(json, summary); const report = render(summary, { visits: Number(v.visits) }); saveFile(out, report);
  console.log(report); console.log(`Saved ${out}\nSaved ${json}`);
}
if (isMain(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
