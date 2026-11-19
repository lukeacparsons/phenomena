# Bing discovery and IndexNow

The 19 November 2026 audit against the [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a) checked rendered pages, canonicals, hreflang, sitemap membership, internal links, robots, redirects and live HTTP responses. Bing Webmaster Tools already has the site: its sitemap report showed Success, approximately 1.2K discovered URLs and zero errors or warnings. Discovery does not establish indexing.

## Publication behaviour

- Film catalogue descriptions identify the page number; guide indexes have distinct localized descriptions.
- Discovery pages show the programme collection time. Rebuilding alone does not claim a page update.
- Sitemap lastmod follows rendered content. The global Today navigation date is excluded from the hash; actual schedule, metadata and editorial changes count.
- Permanent path, alias and host redirects use 301. The moving Today shortcut remains an uncached 302.
- New poster variants include a normalized film title and content hash. Existing cached artwork URLs are reused.

## IndexNow operation

`scripts/serve_deployed_site.py` starts the background notifier when both `INDEXNOW_KEY` and `INDEXNOW_STATE_DIR` are set. The Node origin serves `/{key}.txt` with a noindex header. Keep the configured key out of source control and logs.

Every 60 seconds the notifier reads public `https://vobarna.com/indexnow.json`. This noindex manifest contains the sitemap's canonical pages and content hashes. Observing the CDN prevents notification of an unpublished build or a container not yet receiving traffic.

The first observation establishes a baseline without submitting the historical catalogue. Subsequent additions, changed hashes and removals enter a durable outbox. Pages becoming noindex or redirects count as removals. A file lock coordinates rolling containers. Batches contain at most 1,000 URLs and go only to `https://api.indexnow.org/indexnow`, which shares submissions with participating engines. Unchanged pages and changes only to lastmod do not notify.

The notifier verifies the public key before submission. HTTP 200 and 202 record acceptance; 202 also records pending key validation. Neither means indexed. Errors preserve the outbox, use exponential backoff and respect Retry-After. Publication continues when IndexNow is unavailable. A crash immediately after acceptance can repeat that batch on retry.

Use `/srv/vobarna/indexnow` on Otter, mounted at `/indexnow`, owned by UID/GID 1000 with mode 0700. Configure runtime `INDEXNOW_STATE_DIR=/indexnow` and `INDEXNOW_KEY` in the existing Coolify application. State must survive container replacement.

- `state.json`: observed hashes, pending URLs, accepted count and last receipt/error.
- `published-pages.json`: public manifest checkpoint, preserving unchanged lastmod across deployments.
- `state.lock`: process lock.

Preserve the directory across deployments and backups. Do not delete or reseed existing state to resolve transient errors. To disable notifications, remove the runtime key and redeploy while retaining state.

For initial adoption, seed from the currently served production manifest before switching code, applying the same Today-link hash normalization. This submits genuine deployment changes without backfilling unchanged pages.

## Verification

Run the IndexNow, public-site, image optimization and Node routing/server tests. They cover restart-safe retries, changed/deleted URLs, key availability, overlapping containers, batch limits, stable lastmod, distinct descriptions and image compatibility.

After deployment, verify `/healthz`, manifest/sitemap agreement, the verification response, permanent aliases and Today redirects. Inspect the durable pending count and last result without printing the key. Bing's IndexNow and URL Inspection reports can lag submissions.

Protocol reference: [IndexNow documentation](https://www.indexnow.org/documentation).
