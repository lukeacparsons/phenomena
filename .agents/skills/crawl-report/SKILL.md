---
name: crawl-report
description: Report VO Barna visitors, referral sources, sharing signals, search and AI crawler activity, HTTP errors, and Google search performance from Bunny logs, PostHog and Search Console. Use for traffic or crawl reports and crawl-start alert diagnosis; not for the site's cinema programme collectors.
---

# VO Barna crawl report

Adapted from Ojo de Tortuga's `surf-cam-wall` skill for `https://vobarna.com`. Run from the repository root. These scripts are read-only except the explicitly requested Telegram test/monitor and local report files.

## Run and retain the evidence

```sh
npm run crawlers -- --days 3 --visits 60 --search-console
```

This saves a timestamped text report and JSON under `output/traffic/`. It reads Bunny pull zone **7049405**, PostHog project **751818**, and Search Console property **sc-domain:vobarna.com**. Report paths print at the end. Secrets load from ignored `.deploy-secrets/bunny.env` and `.deploy-secrets/posthog.env`; never print them. Search Console uses `.deploy-secrets/search-console-profile.json` with `siteUrl`, `quotaProject`, `gcloudBinary`, and `gcloudConfig`; its token is minted locally and never saved in reports.

- `--days 1..3`: UTC calendar days ending now, including partial today. Bunny retains only three days; current logs arrive near real time, but measure the latest timestamp rather than assuming a fixed delay.
- `--from ISO --to ISO`: explicit UTC window, with an exclusive end. Compare equal windows, not today's partial total against a full previous day.
- `--save output/traffic/raw/<stamp>`: save the fetched records privately. `--logs DIR` reads those JSON snapshots or legacy `.log` files offline, deduplicates request IDs, and applies the requested dates. Use `--no-posthog --no-lists` for a fully offline run; state address verification is unavailable.
- `--out FILE --json FILE`: override report destinations. A fetch/page failure fails the report; do not present an earlier report as today's successful result.
- `npm run search-console -- --days 10`: independent report saved under `output/search-console/`; supports `--from YYYY-MM-DD --to YYYY-MM-DD`, `--final`, `--top`, `--profile`, `--out`, `--json`.

Read the latest saved report before making a comparison. JSON includes categories, days, hours, crawlers, referrals, previews, notFound, errors, pages, visits, browser measurement and optional Search Console raw breakdowns. Do not infer "first ever" from only three days of logs.

## Reading rules

**2026-11-19: VO Barna removes IPs entirely.** All observed Bunny addresses were `0.0.0.0`; neither visitors nor exact crawler identity can be recovered from these rows. Do not group these into one person or invent people from user agents. Keep the existing privacy setting. Use PostHog for observed browser sessions and anonymous browser IDs, and Bunny for request counts. If anonymized prefixes become available later, address+UA groups with a 30-minute idle gap are only session estimates; a /24 or /64 can contain many people. First-to-last request time is not attention time.

PostHog misses blocked JS, DNT/GPC, and blocked analytics. An anonymous browser ID is not a person. Persistent visitor history starts with the 19 November 2026 rollout, and storage resets create new IDs. The browser summary excludes `internal_user` and `notification_test`; unmarked owner/browser checks cannot be conclusively excluded. Dimensions overlap; never sum country/source tables as extra visitors. PostHog and Bunny totals measure different things.

**2026-11-21:** the legacy `/__analytics-check/` fixture and `integration-test` film/cinema IDs were observed without the newer test flags. The browser report now excludes these explicit markers and `test` placements. Use its full-window totals for distinct sessions/IDs, not summed daily IDs. Page and landing/source tables support content analysis; landing attribution means the first observed pageview within the requested window. Same-session ticket clicks may concern a different film and are not confirmed purchases. Zero-result search counts contain no search text. Neither high activity nor country/device alone identifies an owner or bot.

Separate browser candidates, own/tests, recognized autonomous crawlers, user-triggered/service fetches, previews, other bots and scanners. A Chrome/Safari string does not prove a human. Rapid page-only activity, cloud hosting and lack of assets are clues, not identity; VPNs, virtual desktops and privacy relays can carry real people. With removed IPs, avoid confidently correlating unrelated requests. Explicit `internal=1`, rollout/check markers and the documented VO Barna test agent identify own traffic; country, OS, language or a shared cloud ASN do not.

Crawler names are user-agent claims. `scripts/crawler-visits.mjs` fetches official Google, Bing, Apple, OpenAI, Anthropic, Perplexity, DuckDuckGo and Mistral address lists. A masked-prefix overlap is supporting evidence, not exact-IP authentication. Missing address/list means **unverified**, not a mismatch. An address outside a successfully fetched list is a test, imitation or unresolved discrepancy; exclude it from alerts. Providers without a configured published list remain unverified. Do not assert that a fetch caused indexing, a citation or better ranking.

Keep ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, Google-Agent and NotebookLM separate from autonomous index/training crawls. Google inspection, ads and Vertex service requests are also separate. Answer-engine referrals are browser arrival evidence; crawler requests are not visitors sent by the engine.

Link previews are sharing **signals**, not confirmed shares or clicks. Telegram/Facebook server previews do not identify the sharer. Apple/WhatsApp fetches may be device-side, but removed addresses prevent correlation here. Direct traffic includes messaging links with no referrer. Do not claim causal follow-on visits from mere proximity; report share events only if actually instrumented and returned. VO Barna currently has no dedicated share-success event instrumentation.

Search Console dates are **America/Los_Angeles**, distinct from UTC edge windows. The report labels final/fresh days from Google's final-day response. Rare queries are omitted from query tables; never add page and query breakdowns. No rows on a new property is not evidence that no crawler visited. **2026-11-19:** property access is confirmed, but the initial ten-day query returned no search-performance rows.

Treat film, cinema and discovery/guide paths as the content categories. Separate scanner probes (`.env`, WordPress/PHP, agent credentials/config files, cloud metadata) from real-page 404s. Current reports can include deploy checks and stale asset requests: examine timestamps and current status before calling a historical 404 an ongoing defect. The existing `crawler:health` / `crawler:heartbeat` commands concern our cinema data collectors, not search engines visiting VO Barna.

## Crawl-start alerts

The separate `vobarna-crawl-monitor` container on Otter (`178.105.17.34`) polls Bunny every minute. State lives at `/opt/vobarna-crawl-monitor/state/state.json`; deployment files are in `deploy/crawl-monitor/`. Operational instructions: [crawl notifications](../../../docs/crawl-notifications.md).

- One episode per **provider** starts at its first eligible request after **60 minutes without observed activity**, including crawler metadata or asset requests. Several crawler agents from the same provider share the episode.
- The first run seeds six hours of history silently; restarts retain state. The monitor reads a 15-minute overlap, reconciles six hours hourly, and catches up after downtime within Bunny's retention. Late events older than the provider watermark do not generate duplicate alerts. This is observed activity, not the provider's internal job boundary; very late logs can obscure episode boundaries.
- User-triggered/service fetches, own marks, other hosts/zones, and known address mismatches are excluded. Removed addresses, unavailable lists and unsupported lists produce explicitly **unverified crawler claim** alerts.
- Alerts use the existing bot and the requested [VO Barna topic](https://t.me/c/3773662180/43418), chat `-1003773662180`, thread `43418`. They include provider, agent, event time, gap, first path, HTTP response and evidence level; no raw IPs or URL query strings.
- Durable outbox and receipts retry failures. A timeout after Telegram accepted a message can produce a duplicate: Telegram provides no idempotency key. Preserve state; do not delete it to repair a delivery failure.
- Report reads do not send Telegram messages. Run `npm run crawl:monitor -- --test` only when a delivery test is part of the user's request; it is explicitly labelled TEST. Do not start a second monitor against the production state.

## Answer shape

Lead with the traffic window and what the data can establish. Use small tables where comparisons help:

1. Observed browser sessions/IDs from PostHog, sources, countries and ticket/screening interactions. State measurement gaps; edge requests are separate.
2. Changes against an equivalent saved window; distinguish first observed from first ever.
3. Sharing signals and in-app/referral evidence, with no invented sharer or follow-on attribution.
4. Autonomous crawlers versus user-requested fetches: volume, evidence level, content read and errors; referrals from search/answer engines separately.
5. Search Console clicks/impressions/CTR/position, final versus fresh, page/query/country opportunities supported by data.
6. Real errors and consequential noise; at most three evidence-backed actions. Link saved text/JSON artifacts.

When a durable interpretation changes, add a dated recognition rule here and mention it in the answer. Keep transient counts and raw logs in ignored `output/`, not this skill. Do not import Ojo's camera-specific outage rules or historic IP-based assumptions.
