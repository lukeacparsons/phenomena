import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fetchLogs, fetchAddressLists, crawlerOf, providerOf, isAutonomous, addressEvidence, siteRequest, isOwn } from './crawler-visits.mjs';
import { loadSecrets, saveJSON, isMain } from './traffic-io.mjs';

export const IDLE_MS = 60 * 60 * 1000;
const HOUR = IDLE_MS;
const SEARCH = 'Google bingbot Applebot DuckAssistBot YandexBot Perplexity OAI-SearchBot ChatGPT-User GPTBot Claude Meta- MistralAI Amazonbot Bytespider CCBot';
export const freshState = now => ({ version: 1, activatedAt: now, bootstrapped: false, providers: {}, outbox: [], receipts: [], lastSuccess: null });

// A crawl is an observed provider episode, not an engine's internal crawl job.
// Baseline silently, sort by event time, keep provider watermarks monotonic across replays and restarts.
export function observe(state, records, { now = Date.now(), lists = new Map(), idleMs = IDLE_MS } = {}) {
  let eligible = 0, suppressed = 0;
  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    const at = +record.at, crawler = crawlerOf(record.agent);
    if (!siteRequest(record) || isOwn(record) || !isAutonomous(crawler) || at > now || !Number.isFinite(at)) continue;
    const evidence = addressEvidence(record, lists);
    if (evidence === 'outside published ranges') { suppressed++; continue; }
    eligible++;
    const provider = providerOf(crawler), previous = state.providers[provider];
    if (previous && at <= previous.lastSeen) continue;
    const starts = !previous || at - previous.lastSeen >= idleMs;
    if (starts && state.bootstrapped && at >= state.activatedAt) {
      const id = createHash('sha256').update(`${provider}:${record.id}:${at}`).digest('hex').slice(0, 20);
      if (!state.outbox.some(x => x.id === id) && !state.receipts.some(x => x.id === id)) {
        state.outbox.push({ id, provider, crawler, at, previousAt: previous?.lastSeen ?? null,
          path: new URL(record.url).pathname.slice(0, 300), status: record.status, evidence, attempts: 0, nextAttempt: 0 });
      }
    }
    state.providers[provider] = { lastSeen: at, crawler, evidence };
  }
  state.bootstrapped = true;
  state.lastSuccess = now;
  state.receipts = state.receipts.filter(r => r.sentAt >= now - 30 * 24 * HOUR);
  return { eligible, suppressed, queued: state.outbox.length };
}

const clean = value => String(value).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 300);
export function messageFor(event, { test = false } = {}) {
  const gap = event.previousAt === null ? 'First observed after activation' : `After ${Math.floor((event.at - event.previousAt) / 60000)} minutes without observed activity`;
  const evidence = event.evidence === 'published range overlap'
    ? 'Published IP range overlaps the anonymized address (not an exact-IP verification).'
    : `Unverified crawler claim · ${event.evidence}.`;
  return [
    `${test ? 'TEST — ' : ''}VO Barna · Crawl started`, `${clean(event.provider)} · ${clean(event.crawler)}`,
    new Date(event.at).toISOString().replace('T', ' ').replace('.000Z', ' UTC'), gap,
    `First request: https://vobarna.com${clean(event.path)}`, `Response: HTTP ${event.status}`, evidence,
    ...(test ? ['Setup test only; this does not represent a real crawl.'] : []),
  ].join('\n');
}

export async function sendTelegram(event, { token = process.env.VISITORS_TELEGRAM_BOT_TOKEN, fetchImpl = fetch, test = false } = {}) {
  if (!token || !/^[\d]+:[A-Za-z0-9_-]+$/.test(token)) throw Error('Telegram bot token missing or malformed');
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: -1003773662180, message_thread_id: 43418, text: messageFor(event, { test }), link_preview_options: { is_disabled: true } }),
    });
  } catch { throw Error('Telegram request failed (delivery uncertain)'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(`Telegram HTTP ${response.status}; API code ${Number(result.error_code) || 'unknown'}`);
    error.retryAfter = Number(result.parameters?.retry_after) || 0;
    throw error;
  }
  if (result.result?.chat?.id !== -1003773662180 || result.result?.message_thread_id !== 43418 || !result.result?.message_id) throw Error('Unexpected Telegram delivery receipt');
  return result.result.message_id;
}

// Persist the outbox before attempting delivery. An ambiguous network failure can duplicate a message,
// but a failed delivery must never erase the episode or stop later polls from seeing new activity.
export async function drain(state, { send = sendTelegram, save, now = Date.now(), pause = sleep } = {}) {
  let delivered = 0;
  for (const event of [...state.outbox].slice(0, 5)) {
    if (event.nextAttempt > now) continue;
    try {
      if (delivered) await pause(1100);
      const messageId = await send(event);
      state.outbox = state.outbox.filter(e => e.id !== event.id);
      state.receipts.push({ id: event.id, provider: event.provider, sentAt: now, messageId });
      if (!state.outbox.length) delete state.lastDeliveryError;
      save(state);
      delivered++;
    } catch (error) {
      event.attempts++;
      event.nextAttempt = now + Math.max(Number(error.retryAfter) * 1000 || 0, Math.min(3600000, 30000 * 2 ** Math.min(event.attempts, 7)));
      state.lastDeliveryError = { at: now, message: error.message };
      save(state);
      // Avoid hammering Telegram on rate limits or invalid credentials.
      break;
    }
  }
}

export async function run({ once = false, stateDir = process.env.CRAWL_STATE_DIR ?? 'output/crawl-monitor' } = {}) {
  loadSecrets();
  if (!process.env.BUNNY_API_KEY || !process.env.VISITORS_TELEGRAM_BOT_TOKEN) throw Error('Bunny and Telegram credentials are required');
  const dir = resolve(stateDir), path = `${dir}/state.json`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Deployment is a single container with one writer. A second manual run must use a different state dir.
  const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : freshState(Date.now());
  if (state.version !== 1 || !Array.isArray(state.outbox)) throw Error('Unsupported or corrupt monitor state; restore the existing volume');
  let lists = new Map(), listsAt = 0, stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });
  do {
    const now = Date.now();
    try {
      if (now - listsAt > 6 * HOUR) { lists = await fetchAddressLists(); listsAt = now; }
      const reconcile = !state.lastReconciled || now - state.lastReconciled >= HOUR;
      const earliest = now - 71 * HOUR;
      const from = Math.max(earliest, reconcile ? Math.min(state.lastSuccess ?? now, now - 6 * HOUR) : (state.lastSuccess ?? now - 6 * HOUR) - 15 * 60000);
      if (state.lastSuccess && state.lastSuccess < earliest) state.coverageGap = { from: state.lastSuccess, to: earliest };
      const records = await fetchLogs({ key: process.env.BUNNY_API_KEY, from, to: now, search: SEARCH });
      const counts = observe(state, records, { now, lists });
      if (reconcile) state.lastReconciled = now;
      delete state.lastPollError;
      saveJSON(path, state);
      console.log(JSON.stringify({ at: new Date(now).toISOString(), poll: 'ok', records: records.length, ...counts }));
    } catch (error) {
      state.lastPollError = { at: now, message: error.message };
      saveJSON(path, state);
      console.error(JSON.stringify({ poll: 'failed', message: error.message }));
    }
    await drain(state, { save: value => saveJSON(path, value) });
    if (!once && !stopping) await sleep(60000);
  } while (!once && !stopping);
  if (once && state.lastPollError) throw Error(state.lastPollError.message);
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { once: { type: 'boolean' }, test: { type: 'boolean' }, 'state-dir': { type: 'string' } } });
  try {
    if (values.test) {
      loadSecrets();
      const messageId = await sendTelegram({ provider: 'Example provider', crawler: 'ExampleBot', at: Date.now(), previousAt: null, path: '/', status: 200, evidence: 'test fixture' }, { test: true });
      console.log(JSON.stringify({ testDelivered: true, messageId, topic: 43418 }));
    } else await run({ once: values.once, stateDir: values['state-dir'] });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
