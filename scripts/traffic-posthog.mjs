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
    AND coalesce(properties.$pathname, '') != '/__analytics-check/'
    AND coalesce(properties.film_id, '') != 'integration-test'
    AND coalesce(properties.cinema_id, '') != 'integration-test'
    AND coalesce(properties.placement, '') != 'test'
    AND notEmpty(properties.$session_id)`;
  const queries = {
    totals: `SELECT countIf(event = '$pageview') AS pageviews,
      uniqIf(properties.$session_id, event = '$pageview') AS sessions,
      uniqIf(distinct_id, event = '$pageview' AND properties.visitor_identity_persisted = true) AS persistent_browser_ids
      FROM events WHERE ${where}`,
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
      WHERE ${where} AND event IN ('ticket_click', 'screening_open', 'search_results', 'smart_search_completed', 'language_switch', 'outbound_click', 'share_click', 'share_success')
      GROUP BY event ORDER BY events DESC`,
    pages: `SELECT properties.$pathname AS path, countIf(event = '$pageview') AS pageviews,
      uniqIf(properties.$session_id, event = '$pageview') AS sessions,
      countIf(event = 'ticket_click') AS ticket_clicks,
      uniqIf(properties.$session_id, event = 'ticket_click') AS ticket_sessions
      FROM events WHERE ${where} AND event IN ('$pageview', 'ticket_click')
      GROUP BY path ORDER BY pageviews DESC LIMIT 30`,
    landings: `SELECT landing, source, count() AS sessions, sum(tickets > 0) AS ticket_sessions,
      sum(screenings > 0) AS screening_sessions FROM (
        SELECT properties.$session_id AS session,
          argMinIf(properties.$pathname, timestamp, event = '$pageview') AS landing,
          argMinIf(coalesce(properties.utm_source, properties.$referring_domain, 'unknown'), timestamp, event = '$pageview') AS source,
          countIf(event = 'ticket_click') AS tickets, countIf(event = 'screening_open') AS screenings,
          countIf(event = '$pageview') AS views
        FROM events WHERE ${where} GROUP BY session HAVING views > 0
      ) GROUP BY landing, source ORDER BY sessions DESC LIMIT 30`,
    searchOutcomes: `SELECT properties.scope AS scope, count() AS events,
      uniq(properties.$session_id) AS sessions, countIf(properties.result_count = 0) AS zero_result_events,
      uniqIf(properties.$session_id, properties.result_count = 0) AS zero_result_sessions
      FROM events WHERE ${where} AND event = 'search_results' GROUP BY scope`,
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
