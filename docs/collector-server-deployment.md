# VO Barna collector on Outrageous Otter

The collector is a separate GitHub-backed Coolify application, `vobarna-collector` (`2shq6c1ddaoxmrnqwhxfa4ir`), on Outrageous Otter. It builds `deploy/vobarna/Dockerfile.collector` from `lukeacparsons/phenomena`, branch `main`. Pushing `main` automatically deploys it through the existing Coolify GitHub App. The website remains a separate application and there is no public collector port or domain.

## Persistent state and publication

| Host directory | Collector mount | Purpose |
| --- | --- | --- |
| `/srv/vobarna/collector-data` | `/app/static/preview-data` | Programmes, availability, source receipts, metadata, images and collection locks |
| `/srv/vobarna/collector-publication` | `/app/.site` | Atomic input releases and the persistent URL registry |

These directories belong to UID/GID 1000 and survive container replacement. The initial seed is a private copy of the previously published catalogue, availability, registry and artwork. Bootstrap imports it only if persistent collector data is missing. A redeployment never replaces current collector observations with that seed.

Seat and price checks also accumulate in `collector-data/history/observations.sqlite3`. This compact SQLite history survives screening expiry and publication rotation; repeated values share stored states. See [history storage, export and backup](observation-history.md). Preserve the `history` directory with the collector data and use the SQLite backup command for a consistent live backup.

The collector uses the same scheduling and adapters as the tested local service: programmes hourly, seats every 15 minutes, metadata daily, publication every five minutes, health every five minutes. `scripts/run_crawler.py` supervises its threads. A file lock admits only one writer across rolling deployments. A new container reports standby while the previous one owns the lock, then starts collection after the old process exits. Docker's health check requires a live process and a recent runtime receipt. Provider failures remain visible through the independent freshness monitor.

The website mounts `/srv/vobarna/collector-publication` at `/collector-input` and uses runtime `VOBARNA_INPUT_ROOT=/collector-input`. The existing `/incoming` mount of `/srv/vobarna/publication` is retained for rollback. The website reads data and images and renders them with its own deployed Git templates. Internal `catalogue.json`, price observations, credentials and crawler caches are not served publicly.

## Provider routes

Yelmo rejects Hetzner requests. Its adapter first tries the operator directly, then uses the existing authenticated Cloudflare reader after HTTP 403/429. The reader allows only the fixed public Barcelona programme POST, with its body constructed by the Worker; callers cannot supply arbitrary methods or bodies.

Yelmo **seat reads** use the separate `scripts/yelmo_transport.py` route pool. Configure the collector's runtime environment with `VOBARNA_YELMO_PROXIES` as a JSON array, for example `["http://vobarna-cinema-vpn:8888","http://vobarna-yelmo-vpn-secondary:8888"]`. `VOBARNA_YELMO_PROXY` supports a single private CONNECT endpoint. With neither setting, local development stays direct. Explicit proxy configuration never falls back directly or affects other providers. No global HTTP proxy environment is used.

Coolify service `vobarna-yelmo-vpn` (`2r4syiqrctosndsadopk9odh`), defined by `deploy/vobarna/compose.yelmo-vpn.yaml`, provides an independent secondary tunnel pinned to `es-mad-wg-102`, using the existing device credentials and a different relay from Cinesa's `es-mad-wg-101`. It publishes no ports and stores its server cache separately in `/srv/vobarna/yelmo-vpn/state`. Check both tunnel health and distinct Mullvad exits before enabling the pool. Never run a test tunnel and a production tunnel with the same device/relay pair simultaneously.

The Yelmo collector rotates **between complete screening checks**. Schedule, fare initialization, seat-map read and cancellation stay on one route with separate anonymous cookies. Each request is paced by at least two seconds plus up to half a second of jitter. A screening tries at most two routes. HTTP 403/405/429, 5xx and network failures cool that route for 15 minutes, then 30 minutes, one hour, and so on up to six hours, with up to 20% jitter; a longer numeric or date-form `Retry-After` wins. Cooldowns return immediately to the scheduler instead of sleeping through a collection pass.

Cooldowns, the round-robin cursor and any unfinished anonymous basket are stored atomically with mode 0600 in `collector-data/history/yelmo-routes.json`. An exclusive file lock prevents concurrent Yelmo collectors. A new run cancels an unfinished basket through its original route before creating another. Failed cancellation prevents rotation and applies the same persistent backoff to cleanup retries, including after restart. Corrupt recovery state or removing a route still needed for cleanup also stops new basket creation. The history directory is private and excluded from public serving. Preserve this file across restarts; do not delete it to clear a cooldown or unresolved basket.

Cinesa rejects both Hetzner and Cloudflare requests. Coolify service `vobarna-cinema-vpn` (`pxve1z9pcmdmquoscmhmo0j2`) runs the pinned Gluetun image from `deploy/vobarna/compose.vpn.yaml`, following surf-cam-wall's private HTTP CONNECT pattern. There are no published ports. Its Docker alias is `vobarna-cinema-vpn`; only the collector receives `VOBARNA_CINESA_PROXY=http://vobarna-cinema-vpn:8888`. That setting covers Cinesa programmes and seat reads, with TLS verification, rejected redirects and no direct fallback on tunnel failure. Other providers and monitoring retain their normal routes. Unconfigured local development continues to use direct Cinesa requests.

WireGuard credentials are held only in `/srv/vobarna/cinema-vpn/.env` (0600, parent directory 0700), outside Git and the collector image. They use the existing dedicated Mullvad device on a separate pinned Madrid relay, `es-mad-wg-101`; the camera tunnels retain their Australian and Frankfurt relays. Do not assign this same device/relay pair to another simultaneous tunnel. The Gluetun firewall remains enabled. Mullvad must have active account time; failed tunnels retain cached listings and eventually trigger the existing stale-cinema alerts. Inspect VPN container health and verify the exit using Mullvad's public connection-check endpoint before accepting a Cinesa crawl.

At initial deployment on 19 November, expired Mullvad account time prevented all tunnels from connecting. After renewal the Madrid exit was verified as Mullvad in Spain, and all five Cinesa venues returned programme dates and live seat counts. The Barcelona exit connected successfully but Cinesa rejected its IP; keep the verified Madrid relay pinned.

## Secrets and independent alerts

Coolify supplies two runtime-only secrets: `VOBARNA_SOURCE_TOKEN` for the existing constrained provider reader, and `VOBARNA_HEARTBEAT_TOKEN` for the new heartbeat receiver. Neither is a build argument or committed file. No personal Wrangler login, GitHub key or broad Cloudflare API token is installed in the collector.

The `vobarna-crawler-heartbeat` Worker accepts only authenticated POST requests to `/heartbeat`. It bounds requests to 64 KiB, validates the complete monitored venue inventory and fresh acquisition time, rejects older receipts, and writes only `vobarna:crawler-health` in the existing KV namespace. Acknowledgement occurs after the write. It accepts unhealthy source reports so stale/failure alerts still work. The existing `phenomena` watchdog and Telegram destination are unchanged. KV remains eventually consistent; the watchdog independently detects rolled-back timestamps.

Deploy receiver code with `wrangler deploy --config wrangler.heartbeat.jsonc`; provision `HEARTBEAT_TOKEN` through Wrangler's secret input. Rotating it also requires updating the collector's corresponding Coolify runtime secret and redeploying. The local monitoring command retains its existing Wrangler fallback for manual recovery.

## Checks and recovery

`npm test` includes receiver authentication, request bounds, freshness, failure acknowledgement, server bootstrap, persistent registry, runtime health, and an actual two-process collector lock handoff. Existing catalogue, original-audio, seat-cache and alert tests run alongside them.

Inspect Coolify deployment status, the container's health, `collector-health.json` inside `/tmp`, and the persistent `crawl-attempts.json`, `crawler-health.json` and `monitor-publisher.json`. A successful process start is not proof of a successful crawl: verify all 38 per-cinema receipts and the subsequent website input release.

The first complete Otter crawl finished on 19 November 2026 at 22:20:31 UTC: 38 accepted sources, zero failures and 2,992 upcoming screenings. Every screening had original-audio evidence and a unique identity. A real Python 3.13.5 publication produced 1,238 pages; public programme data contained no price fields, and the independent heartbeat receiver acknowledged the resulting 38-healthy report. Validation included 332 Python tests, 57 Node tests and 53 targeted tests inside the built Linux image.

After server verification and website cutover, disable the Mac's `com.vobarna.crawler` and `com.vobarna.publisher` LaunchAgents to avoid duplicate provider requests and competing watchdog reports. For rollback, stop the server collector first, restore the website mount to `/srv/vobarna/publication`, and deliberately re-enable the local collector/publisher. Never run both as active production collectors. Source failures preserve last good data; do not delete the persistent directories to resolve a provider failure.

The pinned Node 24 / Debian Trixie image supplies Python 3.13, which supports the page generator's Python 3.12+ syntax. The image build compiles every Python script and runs the deployment, Cinesa and public-site tests using the actual container interpreter. Debian Bookworm's Python 3.11 collected data but could not run the publisher. Coolify limits the app to 1 GiB RAM and 1.5 CPUs. Local server storage is not an off-server backup. Keep the persistent cache and URL registry when rebuilding, and monitor host disk capacity as source artwork grows.
