# VO Barna: SEO, GEO, semantics and accessibility audit

19 November 2026. The original audit below records the generated site, HTTP behavior and browser UI before fixes; the follow-up section records implementation and verification later that day. It supplements the [search-intent page plan](search-intent-page-plan-2026-11-19.md) and supersedes earlier technical findings where the implementation has changed.

**The technical SEO foundation is substantially present.** `robots.txt`, XML sitemap, readable generated HTML, canonical URLs, EN/ES/CA alternates, persistent entity URLs, metadata and structured data are implemented. The main verified gaps are accessibility details, five duplicate film-page pairs, the external-link-to-modal journey, and incomplete measurement. `llms.txt` is absent, but it is a lower-priority optional addition, not the main SEO/GEO weakness.

**Evidence and scope.** The static audit pinned release `build-2a2y43ib`, built at **2026-11-19 19:13:44 UTC**, using programme data generated at 18:52:47 UTC. It checked **1,214 HTML pages, of which 1,213 are indexable**, their local links/assets, metadata, JSON-LD syntax, sitemap and language alternates. Browser checks used `http://127.0.0.1:8765` with the English homepage, an open film modal, Rocky's standalone film page, Mooby Balmes' cinema page and the Spanish homepage. Automatic rebuilds continued during browser checks, so displayed sessions changed as time passed. [Machine-readable evidence](seo-geo-accessibility-evidence-2026-11-19.json).

The current [deployment record](vobarna-hetzner-deployment.md) reports a live Bunny CDN/Hetzner setup and successful prior public bot/HTTP checks. During this audit, DNS resolved `vobarna.com`, but fresh public HTTPS requests timed out using curl, including outside the sandbox, and Chrome; the web fetch also failed. This does **not** establish that the site is offline. Results below distinguish verified local behavior from public behavior that this pass could not independently confirm. Production edge cache headers, bot access and indexing should be rechecked from a working external connection.

## Fixes completed later on 19 November 2026

The original findings below are retained as the baseline. The verified code fixes have now been implemented and published through the existing Hetzner/Bunny publisher. [Follow-up evidence](seo-geo-accessibility-fixes-2026-11-19.json).

- **Cinemas directory search:** the EN/ES/CA directories now filter by cinema name, area and address. Search ignores accents and case and matches multiple words. The search uses the homepage styling, has an explicit label, announces settled result counts, provides a translated empty state and Reset control, and preserves the full crawlable directory without JavaScript.
- **Accessibility and labels:** film-result counts use an atomic live status instead of `hidden`; date names derive from their visible labels; rating names include the visible score/provider wording in order. Navigation labels, translated Reset controls, film-specific showtime/ticket names, and cinema link touch areas are corrected. The selected screening has a meaningful accessible name and receives focus; Tab reaches its Tickets link. The highlighted timestamp contrast was also corrected.
- **Information and action destinations:** canonical film pages retain their complete HTML facts and screening tables. `canonical_url` cites that document; `action_url` opens its shared dialog. `#showtimes` opens a film and `#screening-…` selects its exact session. Fresh loads, reloads, back/forward and EN/ES/CA links preserve the intended journey. Missing/expired selections explain their state rather than silently choosing another session. Ordinary operator booking links remain available without JavaScript.
- **Persistent identities:** all five reviewed duplicate pairs are merged using the Sant Cugat feed's explicit provider film ID and matching IMDb ID. No title-based matching is used. Previous paths permanently redirect in all three languages, and conflicting IMDb evidence fails closed. This produced 15 reviewed redirects.
- **Language and archive handling:** generic provider labels such as `Otras Lenguas` are no longer presented as audio languages. Raw source evidence remains retained. Useful archive profiles stay indexable; unresolved archives without current sessions or substantive credits/facts are `noindex,follow` and omitted from the sitemap.
- **Discovery:** `/llms.txt` now provides a concise maintained guide to canonical content, action links, coverage and evidence limits. It does not duplicate the schedule or promise search/AI ranking improvements. Browser-tool documentation explains the information/action distinction and distinct-film recommendations.
- **Measurement:** the separate **VO Barna** PostHog organisation uses project **751818** ([project](https://us.posthog.com/project/751818/)). Cookieless measurement covers page views, search result counts, screening opens, ticket handoffs and browser Web Vitals. Local previews, Do Not Track and Global Privacy Control are excluded. Search text and URL query strings/fragments are removed; booking URLs, session recordings and person profiles are excluded. Ticket events represent handoffs, not purchases. EN/ES/CA About pages describe this measurement. Configuration follows the [PostHog JavaScript SDK](https://posthog.com/docs/libraries/js) and [cookieless setup](https://posthog.com/tutorials/cookieless-tracking). The user enabled the required project setting, and marked synthetic events were accepted with HTTP 200. Exclude `is_test=true` or `placement=test` when assessing initial traffic.

### Verification of the fixes

The follow-up static scan pinned a complete build containing **1,217 pages and 1,195 indexable URLs**. It found **zero** broken internal links/fragments, missing assets, alternate-language errors, unreachable indexable pages or sitemap mismatches. There are **zero same-locale duplicate-title groups**; the 59 cross-language cinema-name groups are expected. Counts will change with the programme.

The complete regression suite passed: **290 Python tests**, the search/date checks, and **38 Node tests**. The browser suite passed no-JavaScript content, metadata, redirects, all three directory searches, zero-result announcements, selected-session reloads, language changes, keyboard focus, ticket event emission, history navigation, unavailable links and mobile widths. Local Lighthouse accessibility/SEO results were **100/100** for the homepage, directory and film dialog, including the selected-screening state. These are sampled automated results, not a claim of universal WCAG conformance or production field performance.

Fresh public HTTPS checks now work. **25 public checks passed** through Bunny, including robots, sitemap, llms guide, cinema search markup, all 15 reviewed duplicate redirects, real 404s and query/noindex isolation. Requests using `Googlebot` and `OAI-SearchBot` user agents returned 200; this confirms sampled delivery, not crawler identity verification or actual indexing. PostHog's SDK loaded successfully, used the intended project, created no analytics cookies/storage, and its ingestion endpoint accepted the marked test events.

### Separate follow-up work

Search Console/Bing ownership verification, sitemap submission and indexing inspection still require their account setup. New long-tail information pages remain in the [page plan](search-intent-page-plan-2026-11-19.md). Production field metrics need real traffic. Remote stale-publication alerts and off-server backup/restore remain operational follow-ups from the deployment record; they are not claimed complete by these frontend fixes.

## What is already implemented

| Area | Current result | Assessment |
| --- | --- | --- |
| `/robots.txt` | Local HTTP 200, `text/plain`; allows `User-agent: *` and explicitly allows `OAI-SearchBot`; links to the production sitemap | Present and permissive. Edge protections still need independent public verification. |
| `/sitemap.xml` | Local HTTP 200, valid XML; **1,213 unique canonical URLs**, no missing/extra indexable paths; `lastmod` agrees with the build manifest | Present and internally consistent. Submission and indexing are separate steps. |
| `/llms.txt` | Local HTTP 404; absent from the generated release | Optional candidate. The usual filename is `llms.txt`, not `llms.text`; both are currently absent. |
| Main content in HTML | Film/cinema facts, showtimes, sources and links exist in generated documents | Good foundation for crawlers and readable fallback; content does not depend entirely on opening a JavaScript modal. |
| Titles, descriptions and H1s | Every audited page has a title, description, one H1 and canonical | Structural checks pass. Same-locale title duplicates remain, detailed below. |
| Locale metadata | EN/ES/CA language attributes, self-canonicals, reciprocal alternates and `x-default` in the generated page model | All declared alternate targets resolve and return the expected language/reciprocal link. No requirement to duplicate these annotations in the sitemap. |
| Internal discovery | All indexable pages are reachable through generated anchors from `/en/`; no broken internal page links or fragments found | Film pagination, directories and guides make the catalogue discoverable. This checks reachability, not whether link prominence is optimal. |
| Assets and images | No missing referenced local assets or missing `alt` attributes in the static scan | Decorative empty alternatives are appropriate where the surrounding link/text supplies the meaning; this is not an editorial review of every image description. |
| Search/filter indexing | `/en/?q=English` returns `X-Robots-Tag: noindex, follow`; tracking-only URL does not receive that header | Correct sampled behavior. Preserve query isolation in CDN caching. |
| Unknown routes | A deliberately unknown page returns HTTP 404 and noindex | Correct sampled behavior; not a soft-404 homepage redirect. |
| Programme JSON | Returns noindex | Useful data can remain readable without becoming a search landing page. |
| Structured data | All audited JSON-LD parses; includes `WebPage`, publisher `Person`, `WebSite`, `Movie`/`CreativeWork`, `MovieTheater`/`Place`, `BreadcrumbList`, `ScreeningEvent` | Useful entity vocabulary. Syntax validity is not rich-result eligibility or proof of every underlying fact. |
| Provenance and publisher | Source links, separate check dates, an independent-site explanation, named publisher and correction email | Strong basis for trustworthy answers. Older reports saying the publisher/contact is missing are outdated. |
| Social metadata | Open Graph title, description, canonical URL, image and Twitter card | Present; the shared brand image could later become page-specific. |
| Browser-agent documentation | `/webmcp/` returns HTML; `/webmcp-tools.json` documents the tools | Present. Tool registration does not itself establish external-engine adoption or indexing. |

The generated robots file is:

```text
User-agent: *
Allow: /

User-agent: OAI-SearchBot
Allow: /

Sitemap: https://vobarna.com/sitemap.xml
```

OpenAI identifies `OAI-SearchBot` as its search crawler; this is distinct from `GPTBot` training controls. The current wildcard rule also permits other compliant crawlers. No new training-policy change is needed for this audit. Actual hosting protection must also permit the relevant requests. [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots).

## Prioritized findings

P1 means a concrete issue worth addressing before expanding acquisition pages. P2 means a useful refinement. Public verification and account setup are tracked separately because their absence from this audit does not establish a code defect.

| Priority | Finding and observed evidence | Recommended change |
| --- | --- | --- |
| P1 | **Search results are not announced.** Homepage `#resultCount` has `role="status"` but also `hidden`. It remains hidden after search. On `/es/`, a zero-match search updates it to `0 películas · 0 sesiones`, while the visible empty state has no live/status role. | Keep the count visually hidden with `.sr-only`, remove the HTML `hidden` attribute, and announce settled result/no-result/error updates politely. Do not announce every keystroke or every individual card. Preserve the visual design. |
| P1 | **Some accessible names differ from visible labels.** Today displays `Today 19 Nov` but is named `Thu 19 Nov`; rating links visibly use `RT · Critics` / `RT · Audience` while their ARIA names use different terms. Lighthouse also flags whitespace/order variants in date and rating controls. | Derive names from the visible label in the same order, with extra context appended; use `aria-labelledby` where useful. Include Today/Tomorrow and explicit spacing. Review automated whitespace flags manually rather than assuming every flagged node is independently misleading. |
| P1 | **Small mobile click targets.** Lighthouse found nine cinema-name links on the sampled home view with heights of about **19.5 CSS px** and inadequate spacing from adjacent targets. | Increase the clickable area and/or separation. Meet the applicable 24×24 CSS-pixel minimum or spacing exception, and use more comfortable targets where layout permits. |
| P1 | **Five film identities have pairs of indexable URLs with the same title.** They produce **15 same-locale duplicate-title groups affecting 30 pages** across EN/ES/CA. | Verify identities against exact source evidence; merge confirmed duplicates through the persistent registry and redirect aliases. If two works/editions really differ, provide distinguishing facts and titles. Do not fuzzy-merge or rename established slugs blindly. |
| P1 | **A shared film/screening URL does not reopen the requested modal.** Selecting a screening in the homepage opens the native dialog and selects its session. Directly loading the canonical film page renders the independent information page; that page has no dialog. Cinema-page showtime links currently go straight to operator booking. | Implement the agreed information-page → selected film/session modal → Tickets journey, with explicit action destinations alongside canonical information URLs. Preserve useful HTML and ordinary booking fallback. Test fresh tab, reload, language and expired-session behavior. |
| P1 | **Selected screening is primarily a visual state.** The recommended row receives `.is-highlighted`, while focus initially goes to Close; the row has no explicit “selected screening” text. | Make the selected session identifiable to assistive technology and easy to reach by keyboard. Announce the film/session context and provide logical focus placement without losing the film heading. Do not apply unsupported `aria-selected` to a generic article. |
| P2 | **A visible Spanish control remains English.** After searching `/es/`, the toolbar button reads `Reset`; the separate empty-state button correctly reads `Restablecer`. The generated toolbar hard-codes Reset. | Use the existing locale copy for the toolbar too, and check CA. Match visible and accessible labels in the page language. |
| P2 | **Navigation and action labels can be more specific.** The date navigation is named `All dates`, the site navigation is unnamed, and some showtime buttons identify time/cinema without the film title. Standalone ticket links repeat `Tickets at the cinema`. | Name regions by purpose, such as “Screening dates” and “Main navigation”; add film/date/cinema context to action names while retaining the visible wording. Existing table/heading context means repeated ticket wording is not automatically a WCAG failure. |
| P2 | **Some audio fields expose provider placeholders as if they were language names.** One inspected Dos fiscales page displays `Screening audio: Otras Lenguas`. | Normalize generic/unknown language labels to “Not confirmed” or an accurately explained source label; retain raw evidence separately. Distinguish audio, subtitles, version and interface language consistently. |
| P2 | **The modal ticket path lacks the existing analytics event.** `vobarna:ticket-click` is emitted by the standalone-page script, which is not loaded by the interactive homepage/modal. No VO Barna analytics integration was found. | Instrument the modal and other booking entry points consistently, then connect the agreed analytics destination. Track ticket clicks as handoffs, not completed purchases. |
| P2 | **Sparse archive pages need an indexing policy.** 24 of 325 English film-detail pages in the pinned release have no session rows; some inspected duplicates also lack substantive film facts. | Retain useful archive identities, but review thin/unresolved pages for enrichment or noindex. An expired schedule alone is not a reason to remove a useful film page. |

The same-locale duplicate pairs concern **Dos fiscales (VOSE), Omaha (VOSE), Conoce a los bárbaros (VOSE), Vivir la tierra (VOSE), and Bad Apples (VOSE)**. Example: `/en/films/dos-fiscales-vose/` has no upcoming session rows and maps to source ID `sant-cugat-cinemas:103892`; `/en/films/dos-fiscales-vose-0b378f16/` has a collected session and maps to `imdb:tt35521200`. This is a strong identity-review candidate, not proof sufficient to merge automatically. The raw scan also found 59 cinema-title groups repeated across translated pages; those are expected proper-name titles and are **not** part of this defect count.

Relevant implementation: [page builder](../scripts/build_public_site.py), [interactive UI and labels](../static/cinemas.js), [UI styles](../static/cinemas.css), [detail-page behavior](../static/site-page.js), [service URL selection](../static/cinema-service.js), [routing](../src/public-routing.mjs), [origin server](../src/vobarna-server.mjs).

The accessibility recommendations follow W3C guidance on [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [visible label in accessible name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html), [target size and its exceptions](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [modal interaction](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## Semantics and accessibility: what passed and what remains

The generated pages have useful native structure: banner, main and footer landmarks; ordinary links for navigation; buttons for in-page actions; H1/H2/H3 hierarchies; definition lists for facts; time elements with machine-readable dates; and screening tables with scoped column/row headers. The homepage's visually hidden H1 remains available to assistive technology. A visually hidden H1 is not the same as the incorrectly hidden result-status element.

The film accessibility tree exposes the film name/year, director, original languages, external ratings, upcoming screenings and separate audio/subtitle facts. The search fields have programmatic names; the cinema search uses an enclosing label. The native modal has a title via `aria-labelledby`, Close and contextual Tickets links. Decorative logo/rating images avoid redundant alternative text. Focus styles and reduced-motion rules exist. These are established strengths, not features that need to be rebuilt.

Manual keyboard testing confirmed that a future screening opens with `showModal()` behavior, focus enters the dialog, Escape closes it, and focus returns to the invoking showtime button. Reverse-tabbing at the boundary briefly moved focus to browser chrome, then back into the dialog's final ticket link; no background-page control received focus. This was not classified as a page focus-leak defect. Full screen-reader/browser combinations were not tested.

At **320 CSS px**, the sampled film page kept document width at 320 px. Its screening table scrolls within an overflow container rather than widening the whole page. This is one representative reflow check, not an exhaustive zoom/orientation audit. Automated contrast checks passed in the sampled states; that does not establish every hover, disabled, loading or error-state contrast combination.

| Lighthouse 13.5.0 sample | Accessibility | SEO | Important qualification |
| --- | --- | --- | --- |
| English homepage, mobile navigation | 96 | 100 | Label/name and target-size findings |
| Open Rocky modal, snapshot | 100 | 100 | Four label/name nodes still flagged despite the rounded category score |
| Mooby Balmes cinema page, mobile navigation | 100 | 100 | Date-control label/name findings still reported |
| Rocky standalone film page, mobile navigation | 100 | 100 | No automated failed audits in this sample |

Best-practices scores were 100 in all four samples. These are local automated checks, not WCAG certification, a Google ranking score or an AI-citation score. In particular, the hidden status and external modal-link gap require checks beyond the category score.

## GEO and machine-readable discovery

**`llms.txt`: optional, useful only with an honest purpose.** It is absent, and `/llms.text` is absent as well. Google's current guidance says it does not use these files for Search visibility or rankings. The llms.txt specification is a proposal for agent-oriented site guidance, not a replacement for robots, a sitemap or useful pages. [Google guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [llms.txt proposal](https://llmstxt.org/).

If added, generate a small `/llms.txt` from maintained site information: site purpose, original-audio scope, locales, canonical programme/film/cinema/guide links, source/freshness limitations, and the existing browser-tool documentation. Link to current data rather than copying a large schedule into another file that can become stale. Treat it as P2 agent documentation; there is no basis here for promising ranking or citation gains. `llms-full.txt`, blanket Markdown mirrors and a page per filter combination are not needed to fix the observed issues.

**Evidence and interpretation matter more.** Keep the existing source-linked cinema facts and collection dates, normalize language/version labels, resolve duplicate film identities, and implement the information pages in the [content plan](search-intent-page-plan-2026-11-19.md). Pages should state which session meets which constraint, with unknown data left unknown. An AI answer cannot reliably infer English audio, reserved seating or proximity from generic film or cinema labels.

**Structured data is present, but rich-result eligibility is a separate question.** Film pages currently mark multiple `ScreeningEvent` nodes, each with a fragment URL. Google's event experience requires a dedicated leaf URL focused on a single event. The current code correctly avoids promising event-rich-result eligibility. Separate event pages are a future product decision, not an automatic requirement for SEO/GEO. [Google event requirements](https://developers.google.com/search/docs/appearance/structured-data/event).

The existing model also avoids publishing imported third-party ratings as VO Barna's own aggregate rating and uses `Place` for cultural venues. As refinement, add further supported visible facts to structured data where they genuinely clarify the entity; do not invent prices, availability, accessibility or audio values to fill schema fields. No special AI schema is required for Google's AI features. [Google AI feature requirements](https://developers.google.com/search/docs/appearance/ai-features).

## Performance and public operations

The homepage cold-cache trace on **unthrottled localhost** measured:

| Metric | Observation | Interpretation |
| --- | --- | --- |
| LCP | 546 ms | Good in this local test; not a mobile-production measurement |
| CLS | 0.02 | Low layout shift in this run |
| TTFB | 5 ms | Local origin result only |
| INP | Not established | No representative interaction/field sample |
| Field Core Web Vitals | Unavailable in this audit | No production pass/fail conclusion |

These observed LCP/CLS values fall within the published good thresholds, but production assessment needs field or representative public-network evidence. [Web Vitals guidance](https://web.dev/articles/vitals).

The trace estimated **0 ms** LCP/FCP savings for its render-blocking-resource finding, so that is not a prioritized optimization. The browser loaded the preconnected Google Fonts origins, so those preconnects are not unused. The programme asset in the pinned release was about 3.0 MB before transfer compression; document HTML does not require it for initial readable content. Measure its actual public transfer cost and mobile interaction impact before further splitting. Social metadata currently uses the same roughly 1.29 MB brand PNG; page-specific, compressed share images are a later refinement.

The deployment record reports automatic publication from the managed Mac collector through a separate publisher to Hetzner, with Bunny CDN and atomic release switching. Freshness therefore still depends on that machine staying awake. The record explicitly leaves **remote stale-publication alerts** and **off-server backup/restore validation** outstanding. A collector heartbeat alone cannot prove that the public programme is current. These matter to the reliability of date-specific search and AI answers.

Google Search Console and Bing Webmaster Tools verification/submission are still listed as outstanding. No authenticated console data was inspected here, and absence of verification tags would not rule out DNS verification. Obtain actual crawl/indexing/query reports before making visibility claims. Keep AI-referral observations separate from citation exposure without a click.

## Recommended implementation order

1. **Fix the interaction/accessibility issues:** result announcements, visible/accessibility label agreement, mobile hit areas, localized Reset, selected-session announcement and useful navigation/action names. Validate with keyboard and at least one real screen reader, not only Lighthouse.
2. **Complete the agreed modal destination:** information pages supply the answer; each recommendation opens its exact film/session modal; Tickets opens the operator destination. Verify direct links, new tabs, reload, locale and expiry while preserving readable HTML.
3. **Review the five duplicate identity pairs and thin archives:** preserve established identity/redirect rules and only merge corroborated matches. Re-run sitemap, alternate and internal-link checks after changes.
4. **Complete operational measurement:** independently recheck public crawler access and cache/noindex isolation, verify consoles, submit sitemap, instrument all ticket handoffs, and add remote published-data freshness alerts.
5. **Add the planned intent pages.** Include optional generated `llms.txt` and improved social previews as small documentation/sharing enhancements, without putting them ahead of correctness or accessibility.

The audit artifacts are this report and its [evidence JSON](seo-geo-accessibility-evidence-2026-11-19.json). Full local Lighthouse HTML reports and the trace are referenced in the evidence file. Application source, crawler policy and deployment configuration were not changed by this audit.
