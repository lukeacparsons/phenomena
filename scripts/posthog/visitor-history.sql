SELECT count(), min(started), max(started),
 countIf(started >= toDateTime({at}) - INTERVAL 7 DAY),
 countIf(started >= toDateTime({at}) - INTERVAL 30 DAY),
 sum(duration), avg(duration), sum(pageviews)
 FROM (SELECT properties.$session_id AS sid, min(timestamp) AS started,
 dateDiff('second', min(timestamp), max(timestamp)) AS duration,
 countIf(event = '$pageview') AS pageviews
 FROM events WHERE distinct_id = {visitor}
 AND notEmpty(properties.$session_id) AND properties.$session_id != {session}
 AND timestamp < toDateTime({at})
 AND properties.$host IN ('vobarna.com', 'www.vobarna.com')
 AND coalesce(toString(properties.internal_user), 'false') != 'true'
 GROUP BY sid)
