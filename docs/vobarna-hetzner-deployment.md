# VO Barna deployment — 19 November 2026

VO Barna is hosted at **https://vobarna.com**, with Bunny DNS/CDN in front of the `vobarna-github` Coolify application on Outrageous Otter. Pushing `main` in `lukeacparsons/phenomena` automatically builds and deploys the site through the existing Coolify GitHub App webhook. The original Phenomena app is a separate resource.

## Resources

| Resource | Configuration |
| --- | --- |
| Coolify application | `vobarna-github`, UUID `oeftpz2pddqgx83zbebbtgfa` |
| Git source | `lukeacparsons/phenomena`, branch `main`, automatic deployments enabled |
| Build | `deploy/vobarna/Dockerfile.github`, repository root context |
| Coolify server | Outrageous Otter, `of4fec7d9pc7vccw3h8hvimb`, `178.105.17.34` |
| Container | Coolify-managed rolling container, port 8787 inside Docker |
| HTTPS origin | `https://origin.vobarna.com` |
| Bunny pull zone | `vobarna`, ID `7049405` |
| Bunny DNS zone | `vobarna.com`, ID `1082969` |
| Nameservers | `kiki.bunny.net`, `coco.bunny.net` |
| Public hostnames | `vobarna.com`, `www.vobarna.com`; HTTPS required; www and the default CDN hostname permanently redirect to apex with path/query intact |
| Data input | `/srv/vobarna/collector-publication` on Otter, mounted at `/collector-input` |
| Rendered pages | `/app/.site`, private to each deployed container |
| IndexNow state | `/srv/vobarna/indexnow` mounted at `/indexnow`, UID/GID 1000, mode 0700 |
| Previous service | `vobarna`, UUID `jaksjk5shvd3mpkgyhsxomqn`, retained for recovery |

DNS has an apex PullZone record, `www` CNAME to `vobarna.b-cdn.net`, and `origin` A to Otter. Bunny verifies the origin certificate. The bootstrap domain `vobarna-origin.luke.ac` belongs to the previous service and is not Bunny's origin.

The application runs as the unprivileged Node user, with a 768 MB memory limit and 1.5 CPU limit. Python and Pillow generate the static site; Node serves the completed atomic publication. `/healthz` reports the active publication and deployed Git commit. Coolify waits for a healthy container before retiring the previous one. No collectors, credentials, research source databases or checkout endpoints are served publicly.

## Routine publication

The collector now has a separate GitHub-backed Coolify application on Outrageous Otter. See the [collector deployment and cutover guide](collector-server-deployment.md) for its persistent mounts, scoped monitoring credentials and verification. The website reads `/srv/vobarna/collector-publication` through its `/collector-input` mount and runtime `VOBARNA_INPUT_ROOT`. The old `/incoming` mount of `/srv/vobarna/publication` is retained for rollback. The Mac collector and publisher LaunchAgents are disabled; production collection and publication run on Otter.

`scripts/serve_deployed_site.py` reads only the incoming catalogue, availability, artwork and initial identity registry. It renders them using the templates, scripts, styles and reference data packaged in the deployed Git image. Incoming HTML and JavaScript are never served. Each container renders into its own directory, so an older rolling container cannot overwrite a newer deployment. New input is checked every 15 seconds, with a rebuild at least every five minutes to expire sessions. Later build failures retain the last successful publication. Older input releases without private `catalogue.json` use `public/programme.json` during migration.

The collector refreshes programmes hourly, seats every 15 minutes, and publishes atomic input releases every five minutes. It sends source-health receipts to the independent Cloudflare watchdog, using the existing Telegram destination. Inspect its Coolify logs and persistent `crawl-attempts.json`, `crawler-health.json` and `monitor-publisher.json`. A healthy process is not a substitute for successful source receipts and a recent published release.

For an immediate manual refresh, use the collector's Coolify terminal:

```sh
python scripts/build_cinema_preview.py --skip-enrichment
python scripts/build_public_site.py --registry /app/.site/registry.json
python scripts/crawler_monitor.py
```

The previous Mac uploader, `scripts/publish_hetzner.py`, remains available for deliberate rollback. It uses the dedicated unprivileged `vobarna-publish` account and ignored `.deploy-secrets/` credentials, hashes releases, and invokes `/usr/local/libexec/vobarna-activate` to verify and atomically select them. It publishes only to the old input directory. Stop the server collector before re-enabling the Mac collector and publisher; do not run both as production writers. Then switch the website's `VOBARNA_INPUT_ROOT` back to `/incoming` and redeploy.


## Updating the origin code

Commit the intended source changes and push `main`:

```sh
npm run site:check
git push origin main
```

Coolify's installed GitHub App receives the push and builds that commit. No GitHub Actions deployment token or manual webhook secret is needed. Watch the deployment in the `vobarna-github` application, then check `https://origin.vobarna.com/healthz` and `https://vobarna.com/healthz`; their `commit` should match the pushed revision. The native directory storage for `/collector-input` is required. A missing or invalid feed prevents startup rather than publishing an empty site. The HTTP health check must use `127.0.0.1:8787/healthz` (the server listens on IPv4), with a 180-second start period for the initial render.

The deployment uses `deploy/vobarna/Dockerfile.github`, `scripts/serve_deployed_site.py`, the public-site generator and `src/vobarna-server.mjs`. `.dockerignore` excludes credentials, local datasets and generated output. `deployment.json` records resource identifiers without credentials. `deploy_vobarna_origin.py`, `Dockerfile` and `compose.yaml` are legacy recovery tools for the previous service; do not use them for routine production deployments.

If the activation script changes, install `deploy/vobarna/activate.py` as `/usr/local/libexec/vobarna-activate`, owned by root and executable, before publishing with the new version.

## Rollback and recovery

IndexNow uses runtime `INDEXNOW_KEY` and `INDEXNOW_STATE_DIR=/indexnow`. Preserve its mounted state through deployments and rollback; see [Bing indexing operations](bing-indexing.md) for initialization, retries and verification. The public manifest checkpoint also preserves unchanged sitemap timestamps when a new container starts.

To return to the old Mac feed, stop the server collector, set the website input to `/incoming`, and redeploy. Deliberately enable and bootstrap `com.vobarna.crawler` and `com.vobarna.publisher` in the Mac login session. The retained old publication and its activation tool support rollback of that feed. Resolve the source or publisher failure before switching back to Otter.

For a code rollback, use the application's previous successful image in Coolify, or revert the faulty commit and push `main`. Keep the input directory mounted. If recovering through the previous service, transfer `origin.vobarna.com` back to it and restart that service; never leave both resources claiming the origin domain. Do not restart the shared proxy or other applications.

Preserve `data/site-registry.json`, `.site/current/registry.json`, and the server release registry. Those files retain permanent semantic URLs and historical aliases. Local and server copies exist; dedicated off-server backup and restore testing have not been configured for VO Barna yet.

At migration, Otter had about 3.4 GB free on its 38 GB root disk. Incoming releases share unchanged images through hardlinks. Account for image retention and per-container generated pages when adding workloads. No unrelated images, volumes or files were deleted.

## 19 November 404 repair

The long-running collector had imported an older page generator and kept rebuilding with it, removing newly published discovery pages and curtain frames. `scripts/public_build.py` now runs the generator in a fresh Python subprocess on every build. The managed collector was restarted and the missing pages republished. Git-owned server rendering additionally prevents uploaded local HTML from reverting deployed code.

## HTTP and CDN behaviour

- The Node origin shares the existing URL policy: semantic paths, legacy ID redirects, normalized paths, real 404s and noindex on search/filter combinations.
- HTML and mutable assets/data have a 60-second TTL. Content-addressed posters have a one-year immutable TTL. Errors and health checks are not cached.
- Bunny respects origin cache headers, varies by the full query string and hostname, and does not cache errors or serve stale pages indefinitely while the origin is offline. Search noindex headers cannot contaminate unfiltered pages.
- Pages and film details work with JavaScript disabled. The homepage's extra introduction and navigation remain in the collapsed information footer.
- Canonicals, hreflang, JSON-LD, robots and sitemap use `https://vobarna.com`.

Verification covered the origin router, failed publication rollback, a real automatic publication, browser behaviour through Bunny, no-JavaScript content, semantic redirects, search noindex isolation, 404 responses, sitemap/robots, HTTPS and the www redirect. Indexing, Search Console/Bing verification, traffic reporting and field performance measurement are separate follow-up work.
