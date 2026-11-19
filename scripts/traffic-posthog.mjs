import { api } from './posthog/destination.mjs';

// Browser-side evidence complements edge requests. Consent settings, blockers and disabled JS
// leave gaps; anonymous browser IDs are not people, and history began at the visitor-alert rollout.
export async function browserSummary(from, to) {
  if (!process.env.POSTHOG_API_KEY) return { available: false, reason: 'POSTHOG_API_KEY unavailable' };
  const request = api(process.env.POSTHOG_API_KEY);
  const where = `timestamp >= toDateTime('${new Date(from).toISOString()}') AND timestamp < toDateTime('${new Date(to).toISOString()}')
    AND properties.$host IN ('vobarna.com', 'www.vobarna.com')
    AND coalesce(toString(properties.internal_user), 'false') != 'true'
    AND coalesce(toString(properties.notification_test), 'false') != 'true'
    AND notEmpty(properties.$session_id)`;
  const queries = {
    days: `SELECT toDate(timestamp) AS day, count() AS pageviews, uniq(properties.$session_id) AS sessions,
      uniqIf(distinct_id, properties.visitor_identity_persisted = true) AS persistent_browser_ids
      FROM events WHERE ${where} AND event = '$pageview' GROUP BY day ORDER BY day`,
    countries: `SELECT coalesce(properties.$geoip_country_code, 'unknown') AS country, uniq(properties.$session_id) AS sessions
      FROM events WHERE ${where} AND event = '$pageview' GROUP BY country ORDER BY sessions DESC LIMIT 30`,
    sources: `SELECT source, count() AS sessions FROM (
      SELECT properties.$session_id AS session, argMin(coalesce(properties.utm_source, properties.$referring_domain, 'unknown'), timestamp) AS source
      FROM events WHERE ${where} AND event = '$pageview' GROUP BY session
      ) GROUP BY source ORDER BY sessions DESC LIMIT 30`,
    interactions: `SELECT event, count() AS events, uniq(properties.$session_id) AS sessions FROM events
      WHERE ${where} AND event IN ('ticket_click', 'screening_open', 'search_results', 'share_click', 'share_success')
      GROUP BY event ORDER BY events DESC`,
  };
  try {
    const dimensions = {};
    for (const [name, query] of Object.entries(queries)) {
      const data = await request('/query/', { method: 'POST', body: { query: { kind: 'HogQLQuery', query }, refresh: 'force_blocking' } });
      if (!Array.isArray(data.results)) throw Error('PostHog returned no result rows');
      dimensions[name] = { columns: data.columns, rows: data.results };
    }
    return { available: true, project: 751818, from, to, dimensions };
  } catch (error) { return { available: false, reason: error.message }; }
}
