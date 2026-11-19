# VO Barna traffic reports and crawl alerts

The repo-local `/crawl-report` skill is in `.agents/skills/crawl-report/SKILL.md`, with a Claude-compatible symlink in `.claude/skills/crawl-report`. It adapts Ojo's source/UA classification, crawler address lists, and reporting rules to VO Barna. Run `npm run crawlers -- --days 3 --search-console`; reports save under ignored `output/traffic/`.

The Telegram monitor reads CDN requests, including cache hits, independently of the website and of our cinema programme collectors. It runs continuously on Otter in `vobarna-crawl-monitor`, polls once a minute, and sends to [VO Barna New Users](https://t.me/c/3773662180/43418) through the existing bot. The initial baseline is silent. New activity after a 60-minute provider gap starts one episode; requests within the episode do not send more alerts. Google, Bing, Apple, DuckDuckGo, OpenAI, Anthropic, Perplexity, Meta, Mistral, Amazon, ByteDance, Yandex and Common Crawl are recognized. User-triggered and inspection/ads fetches are reported separately and do not alert.

## Credentials and privacy

- `.deploy-secrets/bunny.env`: `BUNNY_API_KEY` (CDN logging read access).
- `.deploy-secrets/visitor-telegram.env`: `VISITORS_TELEGRAM_BOT_TOKEN` (same bot as browser notifications).
- `.deploy-secrets/posthog.env`: `POSTHOG_API_KEY` (local reports only, project 751818).
- `.deploy-secrets/search-console-profile.json`: local gcloud credential profile, restricted to property `sc-domain:vobarna.com` by the report script. This is not uploaded to the monitor.

Secret files are ignored and mode 0600. The server only receives the Bunny and Telegram values. Logs and reports can contain URLs, referrers and anonymized traffic metadata, so saved files are private and untracked. Messages include paths without query strings and no addresses.

Bunny currently replaces all client addresses with zero. Every crawl alert therefore labels the provider identity as an **unverified crawler claim**. Official range checks are available if usable anonymized addresses are returned in future; overlapping /24 or /64 ranges support a claim but cannot verify an exact IP. No logging privacy setting was changed.

## Run and deploy

Node 24; no extra runtime npm packages. Validate with `npm run test:traffic`.

```sh
# Explicit, labelled delivery test; does not fabricate a request to the website.
npm run crawl:monitor -- --test

# Deploy this repo's monitor using an authorized SSH key for Otter.
python3 scripts/deploy_crawl_monitor.py --ssh-key /path/to/private-key
```

Deployment copies only the three monitor modules, Dockerfile, Compose file and two credentials into `/opt/vobarna-crawl-monitor`. Its persistent `state/` directory survives rebuilds and container restarts. It does not deploy the website, open a public port or add an endpoint to the request path. The pinned Node image runs as the `node` user with a read-only root filesystem, limited memory/CPU and rotated logs.

```sh
ssh root@178.105.17.34 'docker inspect --format "{{.State.Health.Status}}" vobarna-crawl-monitor'
ssh root@178.105.17.34 'docker logs --tail 20 vobarna-crawl-monitor'
ssh root@178.105.17.34 'docker restart vobarna-crawl-monitor'
```

Inspect `state/state.json` for `lastSuccess`, provider watermarks, `outbox`, delivery receipts, and `lastPollError` / `lastDeliveryError`. It contains no secrets or addresses. Do not print `monitor.env` or a container's full environment. Stop alerts with `docker stop vobarna-crawl-monitor`; restart it to resume using existing state. Never run another writer against the production state directory.

## Delivery and coverage limits

Logs are read with a 15-minute overlap and six-hour reconciliation each hour; requests are ordered by event time. Fixed query bounds, complete pagination, and monotonic provider watermarks prevent replay and midnight/restart duplicates. A failed page never advances the poll watermark. Outages catch up within the three-day retention limit; longer gaps are recorded in `coverageGap`. This infers the start of an observed activity episode, not an internal provider crawl job. Unusually late logs can obscure starts or idle gaps.

The state/outbox is atomically saved before delivery, and successful sends store Telegram message IDs. Failed sends back off, respecting `retry_after`; later polls continue. Telegram does not offer a send-message idempotency key, so an ambiguous timeout or a crash after acceptance but before saving the receipt can duplicate a message. Health becomes unhealthy after ten minutes without a successful poll or an alert waiting over fifteen minutes. Docker restarts on process exit; external health monitoring is needed for automatic intervention on a merely unhealthy container.

Sources: [Bunny logging API v2 and retention](https://bunny.net/docs/cdn/logging/index), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage). Crawler IP sources are enumerated in `scripts/crawler-visits.mjs` and fetched from provider-owned endpoints.
