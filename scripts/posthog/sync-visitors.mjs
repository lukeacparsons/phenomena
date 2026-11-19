// node --env-file=.deploy-secrets/posthog.env scripts/posthog/sync-visitors.mjs --apply|--enable|--disable|--status
// --apply stages a disabled destination; credentials stay in secret inputs.
import { api, definition, findDestination, projectId } from './destination.mjs';

try {
  const action = process.argv[2] ?? '--status';
  if (!['--apply', '--enable', '--disable', '--status'].includes(action)) throw Error('Expected --apply, --enable, --disable or --status.');
  const request = api(process.env.POSTHOG_API_KEY);
  const existing = await findDestination(request);
  let result = existing;
  if (action === '--apply') {
    const project = await request('/');
    if (project.api_token !== 'phc_AUvZfww2dcEvkZ5CBuUdZxRBDCCfqxWXpVquA8eDbf27') throw Error('Unexpected PostHog project; browser token does not match VO Barna.');
    const body = await definition();
    const token = process.env.VISITORS_TELEGRAM_BOT_TOKEN;
    if (!existing && !/^\d+:[\w-]+$/.test(token ?? '')) throw Error('Set VISITORS_TELEGRAM_BOT_TOKEN to create the destination.');
    if (token) body.inputs.telegram_url = { value: `https://api.telegram.org/bot${token}/sendRichMessage` };
    body.inputs.posthog_headers = { value: { Authorization: `Bearer ${process.env.POSTHOG_QUERY_API_KEY || process.env.POSTHOG_API_KEY}` } };
    // PATCH requires existing secret placeholders to retain an unchanged bot token.
    if (existing && !token) {
      const current = await request(`/hog_functions/${existing.id}/`);
      body.inputs.telegram_url = current.inputs.telegram_url;
    }
    result = await request(`/hog_functions/${existing ? existing.id + '/' : ''}`, { method: existing ? 'PATCH' : 'POST', body });
  } else if (action !== '--status') {
    if (!existing) throw Error('Stage the destination with --apply first.');
    result = await request(`/hog_functions/${existing.id}/`, { method: 'PATCH', body: { enabled: action === '--enable' } });
  }
  console.log(JSON.stringify(result ? { id: result.id, name: result.name, enabled: result.enabled,
    url: `https://us.posthog.com/project/${projectId}/pipeline/destinations/hog-${result.id}` } : { configured: false }));
} catch (error) {
  console.error(error.message.startsWith('PostHog ') || /^(Set |Expected |Stage |Multiple |Unexpected )/.test(error.message) ? error.message : 'Visitor destination operation failed; credentials were not logged.');
  process.exitCode = 1;
}
