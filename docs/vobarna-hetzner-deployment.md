# VO Barna deployment — 19 November 2026

VO Barna is hosted at **https://vobarna.com**, with Bunny DNS/CDN in front of a dedicated Coolify service on Outrageous Otter. The original Phenomena app is a separate resource.

## Resources

| Resource | Configuration |
| --- | --- |
| Coolify service | `vobarna`, UUID `jaksjk5shvd3mpkgyhsxomqn` |
| Coolify server | Outrageous Otter, `of4fec7d9pc7vccw3h8hvimb`, `178.105.17.34` |
| Container | `web-jaksjk5shvd3mpkgyhsxomqn`, port 8787 inside Docker |
| HTTPS origin | `https://origin.vobarna.com` |
| Bunny pull zone | `vobarna`, ID `7049405` |
| Bunny DNS zone | `vobarna.com`, ID `1082969` |
| Nameservers | `kiki.bunny.net`, `coco.bunny.net` |
| Public hostnames | `vobarna.com`, `www.vobarna.com`; HTTPS required; www and the default CDN hostname permanently redirect to apex with path/query intact |
| Publication directory | `/srv/vobarna/publication` on Otter; mounted read-only at `/publication` |

DNS has an apex PullZone record, `www` CNAME to `vobarna.b-cdn.net`, and `origin` A to Otter. Bunny verifies the origin certificate. A temporary bootstrap domain, `vobarna-origin.luke.ac`, also routes to the service but is no longer Bunny's origin.

The container runs as the unprivileged Node user, with a read-only filesystem, dropped capabilities, a 256 MB memory limit, 0.5 CPU limit and bounded Docker logs. `/healthz` checks the active publication. No collectors, credentials, research source databases or checkout endpoints are served by the container.

## Routine publication

The existing Mac collector still collects screenings and builds the static site. It has **not** been migrated to Hetzner. A separate `com.vobarna.publisher` LaunchAgent checks for completed releases every minute and publishes changed releases. Fresh data therefore still depends on this Mac being awake and its collector running.

```sh
# Rebuild and publish a local change immediately:
npm run site:build
npm run site:publish:hetzner

# Collect, build and publish explicitly:
npm run site:publish -- --collect --deploy

# Inspect the managed publisher:
launchctl print gui/$(id -u)/com.vobarna.publisher
tail -30 output/hetzner-publisher/stdout.log
tail -30 output/hetzner-publisher/stderr.log
```

`scripts/publish_hetzner.py` pins the completed local release, hashes every file and copies it using rsync. Unchanged files are hardlinked to the previous release. `/usr/local/libexec/vobarna-activate` verifies all checksums, the page inventory and identity registry before atomically changing `current`. Failed validation preserves the live site. The current and previous releases are retained; the previous one is the rollback copy. File permissions are normalized so the container can read releases made by the private local builder.

The uploader uses the dedicated, unprivileged `vobarna-publish` account, with SSH forwarding and PTY disabled. Its private key and local connection configuration are in ignored `.deploy-secrets/`; do not commit or publish them. The routine publisher does not use the Coolify or Bunny API tokens.

Publisher logs and the last successful release are under `output/hetzner-publisher/`. The existing crawler watchdog still monitors collection. A separate remote alert on stale **published** content is a remaining monitoring improvement; publisher failures currently appear in its logs and retry on the next loop.

## Updating the origin code

Ordinary content updates do not rebuild the container. For changes to the HTTP server or routing code:

```sh
npm run site:check
.venv/bin/python -m unittest discover -s scripts -p 'test_hetzner_publication.py'
.venv/bin/python scripts/deploy_vobarna_origin.py \
  --coolify-env /Users/luke/dev/surf-shoulders/.env.local
```

The script builds a small, explicit context on Otter, gives the image a source-content tag, updates only this Coolify service and queues its restart. It uses the existing Coolify server key in a temporary mode-0600 file, deleted on exit. Alternatively provide `COOLIFY_API_TOKEN` in the process environment. Tokens never go into the build context, image, git or logs.

The source files are `src/vobarna-server.mjs`, `src/public-routing.mjs` and `deploy/vobarna/Dockerfile`. `deploy/vobarna/compose.yaml` records the deployed image and resource limits; `deployment.json` records resource identifiers without credentials. The existing shared working tree was not committed or pushed as part of deployment.

If the activation script changes, install `deploy/vobarna/activate.py` as `/usr/local/libexec/vobarna-activate`, owned by root and executable, before publishing with the new version.

## Rollback and recovery

To roll back content, pause the local publisher, inspect the two directories under `/srv/vobarna/publication/releases`, and run `/usr/local/libexec/vobarna-activate RELEASE_NAME` as `vobarna-publish` with the previous release name. Then resolve the bad source build before resuming publication. Bunny's HTML/data TTL is 60 seconds, so a successful rollback may take up to a minute to become visible.

For a code rollback, restore the previous image tag in the service's Compose definition and restart only the VO Barna service. Do not restart the shared proxy or other applications.

Preserve `data/site-registry.json`, `.site/current/registry.json`, and the server release registry. Those files retain permanent semantic URLs and historical aliases. Local and server copies exist; dedicated off-server backup and restore testing have not been configured for VO Barna yet.

At deployment, Otter had about 3.4 GB free on its 38 GB root disk. Two retained releases used about 253 MB after verification; all 1,111 unchanged images were hardlinked between them. Expand disk capacity or review existing storage separately before adding substantial workloads. No unrelated images, volumes or files were deleted.

## HTTP and CDN behaviour

- The Node origin shares the existing URL policy: semantic paths, legacy ID redirects, normalized paths, real 404s and noindex on search/filter combinations.
- HTML and mutable assets/data have a 60-second TTL. Content-addressed posters have a one-year immutable TTL. Errors and health checks are not cached.
- Bunny respects origin cache headers, varies by the full query string and hostname, and does not cache errors or serve stale pages indefinitely while the origin is offline. Search noindex headers cannot contaminate unfiltered pages.
- Pages and film details work with JavaScript disabled. The homepage's extra introduction and navigation remain in the collapsed information footer.
- Canonicals, hreflang, JSON-LD, robots and sitemap use `https://vobarna.com`.

Verification covered the origin router, failed publication rollback, a real automatic publication, browser behaviour through Bunny, no-JavaScript content, semantic redirects, search noindex isolation, 404 responses, sitemap/robots, HTTPS and the www redirect. Indexing, Search Console/Bing verification, traffic reporting and field performance measurement are separate follow-up work.
