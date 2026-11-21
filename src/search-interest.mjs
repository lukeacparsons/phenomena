// Aggregate-only, read-only PostHog access. Never return session IDs or free text.
import {posthogAPI as api} from './search-interest-client.mjs';

const sqlString=value=>"'"+String(value).replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
export function interestWhere(from,to){
  return `timestamp >= toDateTime(${sqlString(new Date(from).toISOString())})
    AND timestamp < toDateTime(${sqlString(new Date(to).toISOString())})
    AND properties.$host IN ('vobarna.com','www.vobarna.com')
    AND coalesce(toString(properties.internal_user),'false') != 'true'
    AND coalesce(toString(properties.notification_test),'false') != 'true'
    AND coalesce(toString(properties.is_test),'false') != 'true'
    AND coalesce(properties.$pathname,'') != '/__analytics-check/'
    AND coalesce(properties.film_id,'') != 'integration-test'
    AND coalesce(properties.cinema_id,'') != 'integration-test'
    AND coalesce(properties.placement,'') != 'test'
    AND notEmpty(properties.$session_id)`;
}

export async function collectInterest(programme,{now=Date.now(),request=api(process.env.POSTHOG_API_KEY)}={}){
  const to=new Date(now).toISOString(),from=new Date(now-96*3600000).toISOString();
  const where=interestWhere(from,to),recent=`timestamp >= toDateTime(${sqlString(new Date(now-24*3600000).toISOString())})`;
  const query=async sql=>{
    const data=await request('/query/',{method:'POST',body:{query:{kind:'HogQLQuery',query:sql},refresh:'force_blocking'}});
    if(!Array.isArray(data.results)||!Array.isArray(data.columns)||data.error)throw Error('PostHog aggregate unavailable');
    return data.results.map(row=>Object.fromEntries(data.columns.map((column,i)=>[column,row[i]])));
  };
  const queries={
    totals:`SELECT countIf(event='$pageview') AS pageviews, uniqExactIf(properties.$session_id,event='$pageview') AS sessions,
      min(timestamp) AS first_event, max(timestamp) AS last_event FROM events WHERE ${where}`,
    days:`SELECT toDate(timestamp) AS day, countIf(event='$pageview') AS pageviews,
      uniqExactIf(properties.$session_id,event='$pageview') AS sessions FROM events WHERE ${where} GROUP BY day ORDER BY day`,
    pages:`SELECT properties.$pathname AS path, count() AS pageviews, uniqExact(properties.$session_id) AS sessions,
      uniqExactIf(properties.$session_id,${recent}) AS recent_sessions FROM events WHERE ${where} AND event='$pageview'
      GROUP BY path ORDER BY sessions DESC LIMIT 2000`,
    landings:`SELECT landing, source, count() AS sessions, sum(tickets>0) AS ticket_sessions FROM (
      SELECT properties.$session_id AS session, argMinIf(properties.$pathname,timestamp,event='$pageview') AS landing,
      argMinIf(coalesce(properties.utm_source,properties.$referring_domain,'unknown'),timestamp,event='$pageview') AS source,
      countIf(event='ticket_click') AS tickets, countIf(event='$pageview') AS views
      FROM events WHERE ${where} GROUP BY session HAVING views>0)
      GROUP BY landing,source ORDER BY sessions DESC LIMIT 500`,
    searches:`SELECT properties.scope AS scope, count() AS events, uniqExact(properties.$session_id) AS sessions,
      countIf(properties.result_count=0) AS zero_result_events,
      uniqExactIf(properties.$session_id,properties.result_count=0) AS zero_result_sessions
      FROM events WHERE ${where} AND event='search_results' GROUP BY scope`,
    interactions:`SELECT event, count() AS events, uniqExact(properties.$session_id) AS sessions FROM events
      WHERE ${where} AND event IN ('search_results','ticket_click','screening_open','share_click','share_success') GROUP BY event`
  };
  const names=Object.keys(queries),settled=await Promise.allSettled(Object.entries(queries).map(async([name,sql])=>{
    try{return await query(sql);}catch(error){throw Error(`${name}: ${error.message}`);}
  }));
  const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  const dimensions=Object.fromEntries(names.map((name,i)=>[name,settled[i].value]));
  const paths=new Set(dimensions.pages.map(row=>row.path));
  // Canonical IDs in SQL deduplicate visits across en/es/ca AND film actions.
  // Only map allowlisted programme URLs that actually appeared in this window.
  async function entities(kind,items){
    const field=kind==='film'?'film_id':'cinema_id';
    const branches=items.flatMap(item=>{
      const urls=Object.values(item.urls||{}).filter(path=>paths.has(path));
      return urls.length?[`WHEN properties.$pathname IN (${urls.map(sqlString).join(',')}) THEN ${sqlString(item.id)}`]:[];
    });
    const key=`CASE WHEN event IN ('screening_open','ticket_click') AND notEmpty(properties.${field}) THEN toString(properties.${field}) ${branches.join(' ')} ELSE '' END`;
    return query(`SELECT ${key} AS entity_id, uniqExact(properties.$session_id) AS sessions,
      uniqExactIf(properties.$session_id,${recent}) AS recent_sessions,
      countIf(event='$pageview') AS pageviews,
      uniqExactIf(properties.$session_id,event='$pageview') AS page_sessions,
      uniqExactIf(properties.$session_id,event='ticket_click') AS ticket_sessions,
      uniqExactIf(properties.$session_id,event='screening_open') AS screening_sessions
      FROM events WHERE ${where} AND event IN ('$pageview','screening_open','ticket_click')
      GROUP BY entity_id HAVING entity_id != '' ORDER BY sessions DESC LIMIT 500`);
  }
  const entityResults=await Promise.allSettled([entities('film',programme.films),entities('cinema',programme.cinemas)]);
  const entityFailure=entityResults.find(r=>r.status==='rejected');if(entityFailure)throw entityFailure.reason;
  dimensions.films=entityResults[0].value;dimensions.cinemas=entityResults[1].value;
  return {schema:1,from,to,collected_at:new Date(now).toISOString(),dimensions};
}
