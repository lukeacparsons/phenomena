# Seat and price history

The collector retains acquisition history in `static/preview-data/history/observations.sqlite3`. On the server this is `/srv/vobarna/collector-data/history/observations.sqlite3`, inside the persistent collector mount. History is separate from the latest-value JSON caches and the three rotating publication releases. Expiry, source removal, publication and redeployment do not delete it. There is no automatic history retention limit.

## What is recorded

- Each seat refresh records its collection time, original source timestamp, count and all supplied fields (capacity, accessibility categories, areas and purchase status where available). Unchanged counts still produce a new sample. Repeated upstream timestamps remain visible separately from the time we checked.
- Failed requests, screenings without public seat maps, and checks skipped after repeated provider errors have distinct statuses. They never become zero seats or a newly timestamped copy of a stale count. Diagnostics retain bounded error names/reason codes, not exception messages or credentials.
- Each accepted cinema programme records its published price observations and any embedded seat observations immediately after validation, before later sources or publication run. Amounts, ranges, fare options, conditions, fees and provenance are preserved. An accepted programme without a price records `not_reported`; rejected/failed programmes do not manufacture new price observations from stale records.
- On the first active refresh, surviving cached observations are imported at their original source timestamps, labelled `bootstrap`. Repeated starts do not repeatedly import the same observations. Records already overwritten before this feature cannot be recovered. Constructing a read-only preview does not write history.

The history covers the screenings and providers the collector already monitors. It adds no booking, reservation, checkout or extra provider requests. Availability changes can support estimated sales rates, but may also reflect temporary holds, blocked seats, returns or changes in capacity.

## Storage design

`samples` contains integer references, integer UTC microsecond timestamps and small status codes. `states` stores each distinct observation payload once; timestamps are excluded from that payload so repeated unchanged readings share a state. `screenings` stores small identity/context records once, with a new version if the room or other context changes. It excludes artwork, synopses, full catalogues and raw provider responses. States can be shared across screenings. SHA-256 digests index the distinct payloads without repeating their JSON in indexes.

SQLite transactions and WAL handle the parallel provider threads and catalogue subprocess; a process lock serializes initial schema creation. Each history commit completes before the latest seat value is replaced; a history write failure propagates instead of silently dropping data. The database uses full synchronous durability. The `observation_history` view joins the dictionaries for analysis. Collection timestamps and source timestamps are deliberately distinct.

A synthetic check of 1,000 screenings sampled 96 times (96,000 observations, eight distinct counts) used about 6 MB, including indexes and screening context, versus 39 MB for equivalent compact JSONL records: roughly 85% less storage. This is a benchmark, not a forecast; real growth depends on the number of screenings and distinct price/seat payloads.

History is excluded from publication and blocked in the legacy preview, including SQLite WAL/SHM sidecars. Do not copy it into a public release. Existing server storage is persistent, but is not an off-server backup.

## Inspect, export and back up

From the checkout (use the collector's Python inside its container):

```sh
.venv/bin/python scripts/observation_history.py status
.venv/bin/python scripts/observation_history.py export --session 'mooby:123' --metric availability > /tmp/screening-history.csv
.venv/bin/python scripts/observation_history.py export --metric price > /tmp/price-history.csv
.venv/bin/python scripts/observation_history.py backup /tmp/observations-backup.sqlite3
```

Use `--data-dir PATH` before the subcommand for another cache directory. Export streams rows as CSV, including status, origin, UTC timestamps and the context/value JSON. Missing values stay empty. `seed` imports existing caches without contacting providers. The `backup` command uses SQLite's online backup API; copying only a live `.sqlite3` file can omit committed WAL data. Move backups to independent storage for protection against host loss.

Example query for a screening's successful availability observations, including its initial cached baseline:

```sql
SELECT collected_at_us, checked_at_us, origin,
       json_extract(value_json, '$.available') AS available,
       json_extract(value_json, '$.capacity') AS capacity
FROM observation_history
WHERE session_id = 'mooby:123' AND metric = 'availability' AND status = 'ok'
ORDER BY collected_at_us, id;
```

Use `checked_at_us` to identify independently acquired measurements; use `collected_at_us` to examine polling cadence and gaps. Keep errors and missing-price observations when assessing coverage. No historical count is overwritten when seats become available again.
