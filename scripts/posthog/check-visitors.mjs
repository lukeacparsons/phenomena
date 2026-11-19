// Tests use per-invocation dry_run configuration; no Telegram delivery or event ingestion.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, findDestination } from './destination.mjs';
const request = api(process.env.POSTHOG_API_KEY);
const found = await findDestination(request);
assert.ok(found, 'Stage the destination before checking it.');
const current = await request(`/hog_functions/${found.id}/`);
const stored = await request('/query/', { method: 'POST', body: { query: { kind: 'HogQLQuery',
  query: "SELECT distinct_id FROM events WHERE event = '$pageview' AND properties.$host = 'vobarna.com' AND notEmpty(properties.$session_id) ORDER BY timestamp LIMIT 1" }, refresh: 'force_blocking' } });
const cases = [
  { label: 'new', classification: 'new' },
  ...(stored.results.length ? [{ label: 'returning', classification: 'returning', visitor: stored.results[0][0] }] : []),
  { label: 'blocked storage', classification: 'unclassified', properties: { visitor_identity_persisted: false } },
  { label: 'history query unavailable', classification: 'unclassified', query: 'SELECT invalid_setup_test_column FROM events LIMIT 1' },
  { label: 'internal excluded', properties: { internal_user: true } },
  { label: 'preview excluded', properties: { $host: 'preview.vobarna.test' } },
  { label: 'old analytics excluded', properties: { visitor_alert_version: null } },
  { label: 'missing session excluded', properties: { $session_id: null } },
];
for (const test of cases) {
  const event = { event: '$pageview', distinct_id: test.visitor ?? `vobarna-alert-preview-${randomUUID()}`, uuid: randomUUID(), timestamp: new Date().toISOString(),
    url: 'https://us.posthog.com/project/751818/activity/explore', properties: {
      $host: 'vobarna.com', $pathname: '/', $session_id: randomUUID(), visitor_alert_version: 1,
      visitor_identity_persisted: true, internal_user: false, notification_test: true, ...test.properties,
    } };
  const result = await request(`/hog_functions/${found.id}/invocations/`, { method: 'POST', body: {
    configuration: { ...current, inputs: { ...current.inputs, dry_run: { value: true }, ...(test.query ? { query: { value: test.query } } : {}) } },
    globals: { event, project: { id: 751818, url: 'https://us.posthog.com/project/751818' } }, mock_async_functions: false,
  } });
  assert.ok((test.classification ? ['success'] : ['success', 'skipped']).includes(result.status), test.label);
  assert.deepEqual(result.errors, [], test.label);
  const preview = result.logs.find(log => log.message.startsWith('VISITOR_PREVIEW,'));
  if (!test.classification) assert.equal(preview, undefined, test.label);
  else {
    assert.ok(preview?.message.startsWith(`VISITOR_PREVIEW, ${test.classification},`), test.label);
    const payload = JSON.parse(preview.message.slice(preview.message.indexOf('{')));
    assert.equal(payload.chat_id, -1003773662180);
    assert.equal(payload.message_thread_id, 43418);
    assert.ok(payload.rich_message.blocks[0].text.text.startsWith('TEST — '));
  }
  assert.ok(!result.logs.some(log => log.message.startsWith('DELIVERY_')), test.label);
  console.log('PASS:', test.label);
}
