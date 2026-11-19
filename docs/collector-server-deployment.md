# VO Barna collector on Outrageous Otter

The collector is a separate GitHub-backed Coolify application, `vobarna-collector` (`2shq6c1ddaoxmrnqwhxfa4ir`), on Outrageous Otter. It builds `deploy/vobarna/Dockerfile.collector` from `lukeacparsons/phenomena`, branch `main`. Pushing `main` automatically deploys it through the existing Coolify GitHub App. The website remains a separate application and there is no public collector port or domain.

## Persistent state and publication

| Host directory | Collector mount | Purpose |
| --- | --- | --- |
| `/srv/vobarna/collector-data` | `/app/static/preview-data` | Programmes, availability, source receipts, metadata, images and collection locks |
| `/srv/vobarna/collector-publication` | `/app/.site` | Atomic input releases and the persistent URL registry |

These directories belong to UID/GID 1000 and survive container replacement. The initial seed is a private copy of the previously published catalogue, availability, registry and artwork. Bootstrap imports it only if persistent collector data is missing. A redeployment never replaces current collector observations with that seed.

The collector uses the same scheduling and adapters as the tested local service: programmes hourly, seats every 15 minutes, metadata daily, publication every five minutes, health every five minutes. `scripts/run_crawler.py` supervises its threads. A file lock admits only one writer across rolling deployments. A new container reports standby while the previous one owns the lock, then starts collection after the old process exits. Docker's health check requires a live process and a recent runtime receipt. Provider failures remain visible through the independent freshness monitor.

The website's `/incoming` directory should mount `/srv/vobarna/collector-publication` after a successful server collection has been verified. It reads data and images and renders them with its own deployed Git templates. Internal `catalogue.json`, price observations, credentials and crawler caches are not served publicly. The former `/srv/vobarna/publication` input remains available for rollback.

## Secrets and independent alerts

Coolify supplies two runtime-only secrets: `VOBARNA_SOURCE_TOKEN` for the existing constrained provider reader, and `VOBARNA_HEARTBEAT_TOKEN` for the new heartbeat receiver. Neither is a build argument or committed file. No personal Wrangler login, GitHub key or broad Cloudflare API token is installed in the collector.

The `vobarna-crawler-heartbeat` Worker accepts only authenticated POST requests to `/heartbeat`. It bounds requests to 64 KiB, validates the complete monitored venue inventory and fresh acquisition time, rejects older receipts, and writes only `vobarna:crawler-health` in the existing KV namespace. Acknowledgement occurs after the write. It accepts unhealthy source reports so stale/failure alerts still work. The existing `phenomena` watchdog and Telegram destination are unchanged. KV remains eventually consistent; the watchdog independently detects rolled-back timestamps.

Deploy receiver code with `wrangler deploy --config wrangler.heartbeat.jsonc`; provision `HEARTBEAT_TOKEN` through Wrangler's secret input. Rotating it also requires updating the collector's corresponding Coolify runtime secret and redeploying. The local monitoring command retains its existing Wrangler fallback for manual recovery.

## Checks and recovery

`npm test` includes receiver authentication, request bounds, freshness, failure acknowledgement, server bootstrap, persistent registry, runtime health, and an actual two-process collector lock handoff. Existing catalogue, original-audio, seat-cache and alert tests run alongside them.

Inspect Coolify deployment status, the container's health, `collector-health.json` inside `/tmp`, and the persistent `crawl-attempts.json`, `crawler-health.json` and `monitor-publisher.json`. A successful process start is not proof of a successful crawl: verify all 38 per-cinema receipts and the subsequent website input release.

After server verification and website cutover, disable the Mac's `com.vobarna.crawler` and `com.vobarna.publisher` LaunchAgents to avoid duplicate provider requests and competing watchdog reports. For rollback, stop the server collector first, restore the website mount to `/srv/vobarna/publication`, and deliberately re-enable the local collector/publisher. Never run both as active production collectors. Source failures preserve last good data; do not delete the persistent directories to resolve a provider failure.

The Docker image is pinned for the server's Linux amd64 architecture. Coolify limits the app to 1 GiB RAM and 1.5 CPUs. Local server storage is not an off-server backup. Keep the persistent cache and URL registry when rebuilding, and monitor host disk capacity as source artwork grows.
