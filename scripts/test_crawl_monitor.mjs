import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, observe, drain, messageFor, sendTelegram, IDLE_MS } from './crawl-monitor.mjs';
import { fetchLogs, parseLine, parsePrefix, addressEvidence, crawlerOf } from './crawler-visits.mjs';
import { analyse, enrich } from './traffic-report.mjs';

const T = Date.parse('2026-11-19T22:00:00Z');
const row = (at = T, overrides = {}) => ({ at: new Date(at), zone: '7049405', id: `request-${at}`, agent: 'Mozilla/5.0 (compatible; GPTBot/1.3)',
  address: '0.0.0.0', url: 'https://vobarna.com/en/films/example/', status: 200, country: 'US', bytes: 100, ...overrides });

test('bootstrap is silent and continuing provider activity does not alert', () => {
  const s = freshState(T);
  observe(s, [row(T - 1000)], { now: T });
  assert.equal(s.outbox.length, 0);
  observe(s, [row(T + 1000), row(T + 2000, { agent: 'OAI-SearchBot/1.0' })], { now: T + 2000 });
  assert.equal(s.outbox.length, 0);
  assert.equal(s.providers.OpenAI.lastSeen, T + 2000);
});

test('new provider and post-idle episode alert once across duplicates, reordering and restart', () => {
  let s = freshState(T); observe(s, [], { now: T });
  observe(s, [row(T + 1000), row(T), row(T)], { now: T + 1000 });
  assert.equal(s.outbox.length, 1);
  s = JSON.parse(JSON.stringify(s));
  observe(s, [row(T + 1000), row(T), row(T - 1000)], { now: T + 2000 });
  assert.equal(s.outbox.length, 1);
  observe(s, [row(T + 1000 + IDLE_MS)], { now: T + 1000 + IDLE_MS });
  assert.equal(s.outbox.length, 2);
  assert.equal(s.outbox[1].previousAt, T + 1000);
});

test('midnight does not reset an active episode', () => {
  const midnight = Date.parse('2026-11-20T00:00:00Z');
  const s = freshState(T); observe(s, [row(midnight - 10000)], { now: midnight });
  observe(s, [row(midnight + 10000)], { now: midnight + 20000 });
  assert.equal(s.outbox.length, 0);
});

test('exclude user-triggered fetches, own probes, foreign zones/hosts, unsupported bots and known range mismatches', () => {
  const s = freshState(T); observe(s, [], { now: T });
  const rows = ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'Google-Agent', 'Google-NotebookLM', 'Google-InspectionTool', 'MistralAI-User', 'UnrecognizedBot'].map((agent, i) => row(T + i, { agent: `${agent}/1.0` }));
  rows.push(row(T + 20, { zone: '6772939' }), row(T + 21, { url: 'https://other.example/' }), row(T + 22, { url: 'https://vobarna.com/?internal=1' }), row(T + 23, { address: '203.0.113.0' }));
  observe(s, rows, { now: T + 50, lists: new Map([['GPTBot', [parsePrefix('192.0.2.0/24')]]]) });
  assert.equal(s.outbox.length, 0);
});

test('anonymization yields uncertainty, not a range mismatch or exact verification', () => {
  const lists = new Map([['GPTBot', [parsePrefix('192.0.2.123/32')]]]);
  assert.equal(addressEvidence(row(T), lists), 'address removed');
  assert.equal(addressEvidence(row(T, { address: '192.0.2.0' }), lists), 'published range overlap');
  assert.equal(addressEvidence(row(T, { address: '2001:db8::' }), lists), 'outside published ranges');
  const s = freshState(T); observe(s, [], { now: T }); observe(s, [row()], { now: T });
  assert.match(messageFor(s.outbox[0]), /Unverified crawler claim · address removed/);
  assert.doesNotMatch(messageFor({ ...s.outbox[0], path: '/a?secret=bad' }), /IP: /);
});

test('queued delivery persists, honors retry-after, retries and saves receipt without replay', async () => {
  const s = freshState(T); observe(s, [], { now: T }); observe(s, [row()], { now: T });
  let saved, calls = 0;
  const save = v => { saved = JSON.parse(JSON.stringify(v)); };
  await drain(s, { now: T, save, send: async () => { calls++; const e = Error('Telegram HTTP 429'); e.retryAfter = 120; throw e; } });
  assert.equal(saved.outbox.length, 1); assert.equal(saved.outbox[0].nextAttempt, T + 120000);
  await drain(s, { now: T + 1000, save, send: async () => { calls++; return 1; } }); assert.equal(calls, 1);
  await drain(s, { now: T + 120000, save, send: async () => { calls++; return 43499; } });
  assert.equal(saved.outbox.length, 0); assert.equal(saved.receipts[0].messageId, 43499);
  observe(saved, [row()], { now: T + 120000 }); assert.equal(saved.outbox.length, 0);
});

test('Telegram sends to exact topic with no URL query, escapes unnecessary for plain text', async () => {
  const s = freshState(T); observe(s, [], { now: T }); observe(s, [row(T, { url: 'https://vobarna.com/en/?token=private' })], { now: T });
  let body;
  const id = await sendTelegram(s.outbox[0], { token: '123:test_token', test: true, fetchImpl: async (url, opts) => {
    body = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true, result: { chat: { id: -1003773662180 }, message_thread_id: 43418, message_id: 99 } }) };
  } });
  assert.equal(id, 99); assert.equal(body.message_thread_id, 43418); assert.match(body.text, /^TEST —/); assert.doesNotMatch(body.text, /private|token=/);
});

test('Bunny pagination returns complete fixed interval and rejects partial fetches', async () => {
  const entry = id => ({ timestamp: new Date(T).toISOString(), pullZoneId: 7049405, requestId: id, statusCode: 200, url: 'https://vobarna.com/', userAgent: 'GPTBot/1.0' });
  let calls = 0;
  const rows = await fetchLogs({ key: 'test', from: T - 1000, to: T + 1000, limit: 1, fetchImpl: async url => {
    assert.equal(url.searchParams.get('offset'), String(calls)); assert.equal(url.searchParams.get('to'), new Date(T + 1000).toISOString());
    const id = String(calls++); return { ok: true, json: async () => ({ data: [entry(id)], pagination: { hasMore: calls < 2 } }) };
  } });
  assert.equal(rows.length, 2);
  calls = 0;
  await assert.rejects(fetchLogs({ key: 'test', from: T, to: T + 1, limit: 1, fetchImpl: async () => calls++ ? { ok: false, status: 503 } : { ok: true, json: async () => ({ data: [entry('a')], pagination: { hasMore: true } }) } }), /503/);
});

test('edge report does not invent visitors from removed IPs and separates crawls, preview and tests', () => {
  const browser = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  const records = [row(), row(T + 1, { agent: browser }), row(T + 2, { agent: 'TelegramBot/1.0' }), row(T + 3, { url: 'https://vobarna.com/?internal=1' }), row(T + 4, { agent: 'ChatGPT-User/1.0' })];
  const s = analyse(records);
  assert.equal(s.requests, 5); assert.equal(s.visits.length, 0); assert.equal(s.categories['browser candidate'], 1);
  assert.equal(s.categories['user-triggered/service fetch'], 1); assert.equal(s.categories['own/test'], 1);
  assert.equal(enrich(row(T, { agent: browser, url: 'https://vobarna.com/.env' })).category, 'scanner');
  assert.equal(parseLine('invalid'), null); assert.equal(crawlerOf('NotGPTBot/1.0'), null);
  assert.equal(crawlerOf('Googlebot-Image/1.0'), 'Googlebot');
});
