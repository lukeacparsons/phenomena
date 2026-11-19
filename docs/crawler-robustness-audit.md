# Crawler robustness audit — 19 November 2026

The collector now isolates failures per cinema, retains last valid data, validates original audio before publication, and reports freshness to an independent Cloudflare watchdog. Monitoring covers all **38 collected venues** (31 cinemas and seven cultural venues); additional directory-only profiles are not represented as working collectors.

## Findings and changes

| Finding | Implemented behavior |
|---|---|
| One unavailable provider could abort the entire refresh | Each cinema is validated independently; good catalogues publish while failed cinemas retain their exact rows and source timestamps |
| File modification time could mistake a ratings/poster update for a programme refresh | Scheduling and health use collection receipts, never file modification time or `generated_at` |
| Concurrent metadata and schedule writers could overwrite each other's changes | All programme writers use a short locked read/merge/atomic-write transaction; a separate collection lock prevents overlapping full/partial crawls |
| An empty or truncated response could erase valid future screenings | Unexpected empty results and drops below 25% of at least ten remaining next-week sessions are quarantined |
| Optional artwork or metadata work could delay publishing valid schedules | Validated schedules commit first; enrichment failures preserve those schedules |
| Transient network failures lacked a consistent retry bound | Public catalogue GETs retry network errors, 429 and selected 5xx responses at most three times; HTTP 202 challenges are rejected and never cached as a programme |
| Stale cinema data could go unnoticed | Source-specific warning/critical thresholds, repeated-failure alerts, recovery notices and daily reminders |
| A dead local machine could stop both collection and alerting | Cloudflare evaluates a five-minute heartbeat independently, including while the Mac is asleep or offline |
| A long seat-refresh pass could hide completed observations until the slowest request finished | Completed observations checkpoint during collection and on managed shutdown; cache-only previews cannot overwrite newer shared counts |
| Timed-out collection processes could survive their supervisor | Collection subprocesses run in a separate process group and receive terminate, then kill and reap if necessary |

Rows require a matching cinema, stable film/session identity, an offset-aware start time and `original_audio: true`. Conflicting duplicate identities fail validation. Spanish/Catalan originals remain eligible with the same evidence rules; dubbed or ambiguous variants are not admitted to inflate counts.

An empty programme is valid for seasonal venues and discovery monitors. Counts and future coverage are exposed for inspection, but zero future films alone does not constitute staleness. For a genuine cancellation or programme reset, review the source before using `--accept-count-drops`; it does not bypass language, identity or timestamp validation.

## Monitoring policy

Policy lives in `data/crawler-policy.json` and is checked against the collection inventory by tests.

| Source type | Warning after last success | Critical after last success |
|---|---:|---:|
| Regular cinemas | 6 hours | 24 hours |
| Cultural screening catalogues | 24 hours | 72 hours |
| Programme discovery monitors | 72 hours | 168 hours |
| Local publisher heartbeat | 45 minutes | 4 hours |

Three consecutive collection failures also warn. A collection still marked running after one hour, a failed publication, missing source timestamps, invalid health data and a regressing heartbeat are reported. Each cinema retains its own last successful collection receipt; a successful run elsewhere cannot make it look fresh.

The existing `phenomena` Worker runs the watchdog at `*/15 * * * *`. Its existing `0,30 6-20 * * *` programme cron remains intact. Notifications use the existing Telegram bot, destination and topic, with secrets left in Cloudflare. Identical issues are suppressed until a daily reminder; escalation and recovery send updates. HTTP failures and Telegram's JSON `ok: false` do not advance delivery state and are retried at the next check. KV consistency means delivery is best-effort deduplicated, not an exactly-once guarantee.

The Worker uses these keys in the existing KV namespace:

- `vobarna:crawler-health`: latest source receipts and publisher heartbeat.
- `vobarna:crawler-alerts`: open issues, last check, delivery result and Telegram message IDs.
- `vobarna:crawler-monitor-test`: an explicit setup-test request, deduplicated by ID.

## Runtime and operations

The macOS LaunchAgent `com.vobarna.crawler` runs `scripts/run_crawler.py`, restarts after a crash, and starts at login. It collects programmes hourly, refreshes available seat adapters every 15 minutes, runs the existing daily metadata scheduler and publishes health every five minutes. The local public build refreshes every five minutes; publishing that build to the public domain is a separate workflow.

The service uses the same Node installation as the tested Wrangler CLI. This matters on this Mac because the other Node installation uses a different CPU architecture. The service uses existing Wrangler authentication; a failed or expired login causes heartbeat uploads to fail, which the remote watchdog detects. The Mac must be awake and the user logged in for local collection to run.

```sh
# Inspect current per-cinema health (exit 1 means an unhealthy cinema).
npm run crawler:health

# Publish a health heartbeat immediately.
npm run crawler:heartbeat

# Install or restart this checkout's managed service on macOS.
.venv/bin/python scripts/install_crawler_service.py
launchctl list com.vobarna.crawler

# Run directly on another host under its service manager.
npm run crawler:run

# Force a regular collection; exit 2 means partial success, with good data committed.
.venv/bin/python scripts/build_cinema_preview.py --skip-enrichment

# Read the remote watchdog's actual check and Telegram delivery state.
node_modules/.bin/wrangler kv key get vobarna:crawler-alerts --binding KV --remote --config wrangler.toml
```

Local files are under `static/preview-data/`: `crawl-attempts.json`, `crawler-health.json` and `monitor-publisher.json`. The preview also serves `/api/preview/health`. Service logs are in `output/crawler-service/`. A preview detects the running service and reads its updated seat cache without starting duplicate collection threads. Avoid running the standalone publishing watcher and managed service together.

The initial monitor deployment wraps the downloaded production Worker and updates only its code through Cloudflare's [content update API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/update/). Production assets, bindings, secrets and runtime settings were preserved; only Cloudflare's upload-origin annotation changed. The original code/settings/schedules and bundle hashes are retained in ignored `output/crawler-watchdog-deploy/`. Subsequent code-only updates use `scripts/deploy_crawler_watchdog.py --apply`, which refuses to overwrite a remotely changed Worker. Do not deploy the entire local `static/` preview directory as part of a monitor-only update.

## Verification and live findings

The full test command is `npm test`. The audit added 28 Python failure-injection/runtime/cache tests and 11 watchdog tests; the complete suite also covers the existing collectors and frontend contracts. Final verification passed 247 Python tests, 28 JavaScript tests, and the film/date search assertion suites. It includes parser and language evidence checks, venue/date boundaries, identity matching, availability caching, source isolation, suspicious drops, concurrent writes, failed publication, process cancellation, heartbeat failure/retry, stale/recovery alerting, API-level Telegram failures and duplicate suppression. A Wrangler dry run validates the actual bundled Worker.

The initial live audit refreshed **28 of 38 venues**. **Verdi, Verdi Park, Girona, six Mooby cinemas and Filmax Gran Via** returned HTTP 202 access challenges. Their **1,562 previously collected rows were preserved exactly**, including acquisition timestamps. That snapshot contained 2,980 rows, all marked with verified original audio, and 38 independent coverage records. Preserving old data did not count as a successful refresh.

The subsequent **18:52–18:56 UTC provider repair run refreshed all 38 venues**, with zero failures and 3,092 verified original-audio sessions. Direct requests remain first; a restricted authenticated Cloudflare reader handles recognized browser checks. Nearby editorial metadata and Institut Français's main agenda also recovered. See [tested alternatives, implementation, operations and remaining limitations](provider-collection-repairs.md).

The new health endpoint returned all 38 source records. Production homepage and `/data.json` checks returned HTTP 200 after deployment. The managed service successfully uploaded repeated heartbeats and completed its first full seat/metadata refresh (2,330 cached seat observations; 120 unavailable observations remain explicitly unknown or dated). The scheduled Worker executed at **2026-11-19 18:15:22 UTC (19:15 Barcelona)** and delivered the labelled setup notification to the existing Telegram topic. KV recorded `delivery_status: ok`, `last_test_id: setup-2026-11-19` and Telegram message ID **43413**. This verifies the scheduled Worker → existing bot/topic → persisted delivery-state path. No outage was fabricated.
