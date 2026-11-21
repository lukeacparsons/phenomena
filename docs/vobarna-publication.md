# VO Barna public site

The production identity is **https://vobarna.com**. It is deployed on Outrageous Otter through Coolify, with Bunny DNS and CDN. See [deployment and operations](vobarna-hetzner-deployment.md). This publication is separate from the original Phenomena booking app. The older `wrangler.vobarna.jsonc` prototype is not the production deployment target.

## Build and preview

```sh
npm run site:build
npm run dev:public -- --no-background --port 8789
npm run site:check
npm test
```

Open `http://127.0.0.1:8789/en/`, `/es/` or `/ca/`. The no-background option uses the collected snapshot without provider requests. The ordinary `npm run dev` now serves the same public routes on port 8765. Only the explicit `npm run dev:legacy` / `--legacy-preview` option serves the old ungenerated shell.

For browser checks, install Playwright separately or point `PLAYWRIGHT_MODULE` at an existing installation, then run `npm run site:test:browser`. `VOBARNA_PUBLIC_URL` changes the tested origin. The test uses isolated Chrome, checks pages with JavaScript disabled, then checks search, dialogs, browser history, language links and mobile overflow. It does not follow ticket links.

The builder reads `static/preview-data/screenings.json` and the sourced cinema, auditorium and practical-information catalogues in `docs/`. It makes no network requests. Output is a complete release below `.site/releases/`; `.site/current` switches to it atomically only after validation. HTML, route mappings and the identity registry belong to the same release. Failed builds leave the active release intact. The last three successful releases are retained locally.

Film identity checks are mandatory at build and upload. Confirmed mappings are consolidated before rendering; unresolved duplicate candidates stop the build before any release or URL registry changes. Inspect `.site/film-duplicates.json` and the watcher error for the rejected pairs. The uploader independently checks the frozen `programme.json` and rejects older artifacts that still require grouping; its report is `output/hetzner-publisher/film-duplicates.json`. Resolve duplicates through evidence-backed provider mappings in `scripts/rating_identities.json`, or record an exact reviewed distinct pair in `scripts/film_distinct_pairs.json` (`films` with two `id`/`title` entries, `reason`, `source_urls`, `reviewed_at`), then rebuild. There is no automatic fuzzy merge or skip-check switch. Collection can continue, but public schedule updates wait for review while the previous release stays live. Unknown title variations can still escape the detector.

Generated assets are ignored by Git. The deployment directory is `.site/current/public`, not `static/`. It contains programme data and referenced artwork; the original checkout, collectors, layout demos and raw research databases are excluded.

The [design-system guide](design-system.md) documents shared components, style ownership and the desktop/mobile theme audit (`npm run site:test:styles`).

## Page and content model

- Locale homepages contain real HTML cards. Film directories provide finite, linked pagination; published films remain discoverable after leaving the current programme.
- The programme view keeps its descriptive H1 available to assistive technology, hides the film/screening count, and groups navigation, introduction, archive links and coverage notes in a collapsed “More information” footer. The links and text remain available in the original HTML and can be opened without JavaScript.
- The homepage information footer lists every covered cinema in server-rendered HTML, including supported venues with no current sessions. Its collected-showtime list comes from the programme cinema inventory, excluding `programme_links_only` venues; a separate list contains those link-only venues and the remaining research directory. EN/ES/CA copy names the maintainer, states the long-term commitment and sustainable operating approach, explains hourly programme checks, and describes the benefits of official direct booking without implying cinema fees are waived. The About pages share the maintenance, refresh and booking copy.
- Film pages share the programme dialog's compact view: poster, title, year/runtime, director, language, attributed ratings and screenings grouped by date and cinema with official ticket links. The same view is rendered in the initial HTML, including without JavaScript; seat availability is enhanced in place. Detailed credits and collection evidence remain in the source data. On a standalone film page, `#showtimes` scrolls to the existing schedule and `#screening-…` opens one focused screening. Time links have direct booking fallbacks without JavaScript. Imported ratings are not marked up as VO Barna `AggregateRating`.
- Cinema pages contain addresses, collected sessions, official programme links, source-linked room evidence and practical information. Unmapped room placeholders are excluded. Cultural venues use `Place` rather than claiming to be commercial cinemas.
- Film and cinema pages add localized, session-backed summaries only inside their closed “More information” footer. Film summaries select the next collected screening at each cinema; cinema summaries select up to six films with exact-session links. Related guide links reuse each guide's selection rules. Search descriptions claim a shared version/audio/subtitle language only when every upcoming session confirms it; films without future sessions have explicit empty descriptions. The visible poster, grid and showtime layouts stay focused on choosing a film or screening.
- Version and format guides explain the labels and provide a sourced comparison of selected auditoriums. About pages describe collection, independence and coverage, identify Luke Parsons as the publisher, and link to `vobarna@luke.ac` for corrections. The same publisher identity appears in the structured data.
- Discovery content includes English audio, English subtitles, Friday–Sunday weekend listings, original-version IMAX, and 35mm/70mm guides in EN/ES/CA. All selections use session evidence with exact film/session booking actions. Today opens the normal homepage with `?date=YYYY-MM-DD`; former Today article routes temporarily redirect to the current Madrid date without caching. The [content plan](search-intent-page-plan-2026-11-19.md) records scope and follow-up work.
- Research evidence, capacity caveats, equipment descriptions, accessibility notes, policies and price conditions are translated into Spanish and Catalan through `data/site-research-translations.json`. Original source records remain unchanged. Proper names, addresses, equipment model names and bibliographic source titles retain their source spelling. The translation lookup uses exact source text: new or changed prose without a translation fails publication and retains the previous valid release rather than silently reusing an outdated translation.
- Canonicals, locale alternates, social metadata, breadcrumbs and JSON-LD are generated in HTML. Film schedules contain `ScreeningEvent` nodes but are not dedicated event pages and do not claim Google event-rich-result eligibility.
- `robots.txt` allows search crawlers, including `OAI-SearchBot`. No separate training restriction has been invented. `sitemap.xml` includes only indexable canonical pages; `lastmod` changes when their HTML changes.
- Search/filter combinations carry `X-Robots-Tag: noindex, follow`. Tracking-only parameters retain the page canonical. Unknown entities return 404. A malformed publication returns 503, not an empty indexed success page.
- `/webmcp/` is the static agent guide; `/webmcp.html` redirects there. WebMCP film and screening results use the same canonical destinations as the HTML.
- Film dialogs use the canonical film path in browser history, with a stable screening fragment when a time is selected. Search filters are retained in history state and restored on close/back; they are not appended to the film identity URL. Reloading or sharing a dialog URL serves the independent static film document. Canonical and language-alternate metadata follow the selected film and restore on close.

## Slug policy

`scripts/site_identity.py` implements the policy, with permanent state in `data/site-registry.json`. Preserve that file and the active release's `registry.json` when moving the build service. Deleting the registry can change identities and URLs. Existing output directories use their current registry first; a fresh output directory starts from the tracked registry.

1. Each entity has an immutable internal identifier. Scraper IDs and merged IDs are aliases, not the public URL.
2. A new film slug uses its established display title and verified original release year where known: `dune-1984`. A duplicated parenthesized year is removed. Adaptations and double bills remain distinct. The existing grouping pipeline determines identity before publication.
3. Slugs are lowercase ASCII words separated by single hyphens. Accented Latin characters are normalized, a reviewed map handles additional transliterations, apostrophes are removed, other punctuation becomes separators, and meaningful words/numbers remain. The validator is `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
4. Slugs must be nonempty and at most 100 characters, including a collision suffix. Non-Latin-only and overlong names require reviewed entries in `data/site-slug-overrides.json`, keyed by `films:SOURCE_ID` or `cinemas:SOURCE_ID`. Overrides apply only at first publication.
5. Reserved words and collisions receive a stable eight-character internal token, never scrape-order counters. Retired redirect paths remain reserved forever and cannot be reassigned.
6. Published slugs are frozen. Title corrections, metadata enrichment and rebrands update content without moving the address. Confirmed identity merges retain aliases and flatten permanent redirects. A slug change requires an explicit registry migration with redirects; editing a title or override does not move an existing page.
7. Localized sections come from a lookup table: `films` / `peliculas` / `pellicules`, `cinemas` / `cines` / `cinemes`, and `guides` / `guias` / `guies`. Proper names follow the established display-title policy. Paths end in `/`; each locale self-canonicalizes with reciprocal alternatives.
8. Supported case, slash and `index.html` variants redirect to canonical paths. `/` redirects to `/en/`; `www.vobarna.com` redirects to the HTTPS apex. Known `/cinemas.html?film=…`, `?cinema=…` and `?screening=…` links resolve through persistent aliases. Former locale-listing links such as `/es/?film=…` follow the same policy in their language. Unknown IDs return 404.
9. Expired films retain truthful archive pages. Historical screening aliases point to the film page and retain their section fragment. An expired screening's fragment may no longer exist, while the film's current status remains readable. Screening aliases are split across 256 files so ordinary pages do not load their growing history.

## Refresh and publication

The public preview starts an hourly programme refresh, fifteen-minute seat refresh, daily ratings refresh and five-minute HTML expiry pass unless `--no-background` is supplied. Requests never trigger provider scraping. Source-specific dates remain visible; an HTML build is not reported as a fresh verification of every fact.

```sh
# Collect and build locally, without publishing:
npm run site:publish -- --collect

# Publish the current validated release to Hetzner:
npm run site:publish:hetzner

# Collect, build and publish once:
npm run site:publish -- --collect --deploy
```

The existing managed Mac collector creates local releases. The separate `com.vobarna.publisher` LaunchAgent checks for completed builds every minute and publishes them to Hetzner using an unprivileged SSH identity. Checksums and page validation precede the atomic switch; the previous valid release is retained for rollback. Unchanged images share disk storage through hardlinks. The Mac must remain awake for collection and publication to continue. Collection has not been moved to the server.

The public Node origin shares the tested URL policy with the earlier Worker prototype. Coolify manages the container and origin HTTPS; Bunny manages public HTTPS, the www redirect and CDN caching. Publication commands now target Hetzner. See [deployment and operations](vobarna-hetzner-deployment.md) for resource identifiers, rollback, logs and code deployment. The separate crawler watchdog remains installed; published-content freshness alerts and off-server backup validation are follow-up work.

## Launch work requiring domain and account access

- **Completed:** domain attachment, Bunny DNS/CDN, HTTPS, www redirect, Coolify origin and automatic publication. Public bot-request checks pass. Dedicated stale-publication alerting remains pending.
- Verify Google Search Console and Bing Webmaster Tools, submit `/sitemap.xml`, inspect representative locale URLs and review Google's generative-AI inclusion setting. These account actions have not been performed.
- Establish indexed-page, crawl-error, organic-landing-page and AI-referral baselines. Review Google/Bing AI reports where available. Detail-page ticket clicks emit `vobarna:ticket-click` locally for a future analytics integration; no third-party tracker has been enabled.
- Measure mobile performance and field data after launch. Initial HTML is independent of the search payload; only interactive listing pages fetch the compact programme. Further payload splitting, IndexNow and separate event pages remain refinements to evaluate against usage and maintenance cost.

Original findings and sources: [SEO/GEO audit](seo-geo-audit-2026-11-19.md).

## Plan review — 19 November 2026

| Planned outcome | Current status |
| --- | --- |
| Readable HTML without JavaScript | Implemented locally: homepages, paginated film archive, film details, cinema profiles, guides and methodology. The deployment build has 1,213 indexable pages for 325 films and 59 venues across three languages, plus a real 404 page. |
| Persistent semantic URLs | Implemented in the registry, HTTP redirects, card links, dialog history and WebMCP results. The default preview now uses public routing; the old development shell is explicit opt-in. Slugs survive title/provider changes and archive expiry. |
| Metadata and discovery | Generated titles, descriptions, canonicals, reciprocal alternates, JSON-LD, sitemap, robots rules, source links and timestamps. Searches remain separate from entity identity and carry noindex. |
| Useful structured content | Film/session facts, cinema/room evidence and version/format guides are published with labels and attribution. Luke Parsons is identified as publisher, with `vobarna@luke.ac` as the correction contact. |
| EN/ES/CA completeness | URL structure, interface copy, page descriptions, labels and all catalogued research passages have ES/CA translations. Proper names and bibliographic source titles retain their source spelling. New or changed research prose requires matching translations before publication. |
| Freshness and monitoring | Managed local collection, atomic builds and a separate watchdog are installed. Some providers currently challenge collection; preserved older data keeps its original timestamps. Automatic publication to Hetzner is running; collection still depends on the Mac. Dedicated published-content freshness alerts remain pending. |
| Performance | Indexed search, incremental card rendering, compact browser data and progressive images are implemented and tested locally. Real mobile/network measurements and field metrics remain launch follow-up. |
| Public indexing and GEO measurement | Domain/HTTPS, public deployment and crawler-access checks are complete. Search Console/Bing verification, sitemap submission and traffic/citation baselines remain pending. Public checks demonstrate availability, not indexing or ranking gains. |

The review found two integration gaps despite the generated pages already existing: port 8765 still served the old shell, and dialogs still wrote internal IDs into query strings. Both are corrected. Browser acceptance now checks semantic dialog URLs, search restoration, back/forward, direct reloads, stable screening fragments, no-JavaScript content and mobile overflow. A no-script image fallback that leaked raw markup in JavaScript-enabled detail pages was also corrected.
