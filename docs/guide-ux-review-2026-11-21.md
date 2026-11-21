# Guide and summary page UX review — 21 November 2026

**Implementation status:** completed in the local checkout on 21 November 2026; not deployed. Programme guides now use the shared poster cards, bounded showtime previews and film dialogs, with date/cinema/section filters that retain exact guide membership. The guide directory, version/format references, discount offers and complete-programme navigation have also been updated. Extended guidance and source rows remain available in disclosures and without JavaScript. The English-language guide keeps the date strip, with no cinema/section dropdowns or result-summary counts in any locale.

Verification passed: 64 guide views across desktop/mobile and light/dark themes, 68 shared style views, guide filter/dialog/history/focus/expiry checks, EN/ES/CA subtitle checks, existing public-page and film-sheet checks, 24 screening-context checks, progressive-image checks, and the publication/discovery unit suites. On mobile, the first poster now starts at 424px on the English-language guide, 547px on English subtitles and 643px on classics, compared with the pre-change first results at 672px, 673px and 1,286px. Evidence: [guide screenshots and report](../output/guide-ux-fix/browser/) and [shared style report](../output/style-audit/report.json). The review below records the original findings.

The programme guides meet much of VO Barna’s visual styling, but do not meet the browsing experience established by the home, film and cinema pages. All ten programme-guide families lack film posters. Most hide every screening behind a separate disclosure, then expose a long, repetitive list when opened. The main improvement should be to compose these pages from the existing listing and film components.

This review uses [the visual system](design-system.md) as the written standard and the live home, film and Phenomena pages as the reference experiences. No separate document named “gold standard” was found. Measurements describe production on the review date; programme counts change as screenings start. Production refreshed during the review: the final interaction checks encountered a different first film and updated subtitle-guide wording. The screenshot matrix records the earlier capture. The local checkout also contains substantial existing work. Source references identify current implementation points, rather than asserting that every local change matched production throughout the audit.

**Coverage and evidence.** Captured 21 routes at 1440 × 900 and 390 × 900, in light and dark themes: 84 page views plus expanded-screening screenshots. Coverage includes ten programme-guide families, the guide index, three reference guides, complete programme, the three reference page types, the Today route, and Spanish/Catalan English-language variants. Inspected representative screenshots and measured layouts across the matrix. All routes returned 200 after redirects, with no document-level horizontal overflow or page JavaScript exceptions observed. This is a UX and internal-design review, not a complete accessibility certification or performance audit.

Evidence is stored locally in [the audit folder](../output/guide-ux-audit-2026-11-21/), including [measurements](../output/guide-ux-audit-2026-11-21/report.json) and the [reproducible browser script](../output/guide-ux-audit-2026-11-21/audit.cjs). These output files are ignored by Git.

| Reference experience, mobile | English-language guide, mobile |
| --- | --- |
| [Homepage screenshot](../output/guide-ux-audit-2026-11-21/home-390-light.png) | [Guide screenshot](../output/guide-ux-audit-2026-11-21/english-390-light.png) |
| Poster begins at 299px; film identity and grouped showtimes follow. | First text-only film begins at 672px; showtimes are closed. |

**Priority 1 — Replace the separate discovery listing with the shared film browsing components.**

The [English-language page](https://vobarna.com/en/showtimes/english-language/) showed 30 films and approximately 535 screenings during capture, with zero posters and zero visible times while its disclosures were closed. A title and “Show screenings” count give visitors little to recognize or compare. The desktop page remains one wide column despite the reference listing using four poster columns. This repeats across English, weekend, VOSC, IMAX, Gràcia, Eixample, classics and the discount page’s programme examples. Production’s English-subtitle and 35mm/70mm pages instead expose individual screening rows; they also have no posters.

The current [discovery renderer](../scripts/build_public_site.py#L721) builds separate `.discovery-film` articles at line 780. The standard identifies `createListingView()` as the owner of listing cards and says to avoid page-specific implementations. Reuse that renderer with each guide’s already-selected sessions, the established poster loader, `.card-body` reading wash, date/cinema/time grouping and bounded previews. Preserve genuine subgroup distinctions, including English-only versus multilingual audio and confirmed subtitle/format evidence.

**Priority 1 — Bound schedule previews and retain the shared interaction flow.**

Opening the initial first English-language film, The Hunger Games, expanded roughly 44,000px on desktop and 61,000px on mobile. After production refreshed, the new first film, Wild Horse Nine, still expanded approximately 26,000px and 35,000px respectively. Each session repeats its date/timezone, venue, room, version, audio, subtitles, format, collection timestamp and two actions. A mobile session takes approximately 343px. This makes comparing cinemas or returning to the next film unnecessarily laborious. See the [expanded mobile screenshot](../output/guide-ux-audit-2026-11-21/english-390-expanded.png) and [session renderer](../scripts/build_public_site.py#L341).

Use the existing homepage preview policy: earliest matching day, bounded cinemas/times, a per-cinema “+N more” cue and a film-wide remaining-showtimes count. Open the full matching schedule in the shared dialog. Keep the detailed source and screening facts available in the focused screening view. The poster/title should open film details; a time should open that screening; closing should restore the guide’s position and focus. Preserve the guide’s matching session set when moving between views.

The current exact-screening link works: selecting an upcoming session navigated to the standalone film URL and opened the correct screening dialog. Direct operator ticket links also exist. The issue is inconsistent browsing context and information density, rather than a broken booking destination. The redesign should retain these fallback destinations.

**Priority 1 — Bring useful results forward on mobile.**

The current stack often includes the general navigation, a breadcrumb repeating the full title, a long heading, selection methodology, collection time, jump navigation, a result count and a subgroup heading before any film. On the weekend page, an expired Friday section precedes Saturday’s films. Long internal dates and repeated `Europe/Madrid` labels further increase the reading burden.

| Live guide | First result at 390px width | Recommended composition |
| --- | ---: | --- |
| [English audio](https://vobarna.com/en/showtimes/english-language/) | 672px | Compact topic header, dates, shared poster grid; separate multilingual group. |
| [English subtitles](https://vobarna.com/en/guides/english-subtitles-barcelona/) | 673px | Shared cards grouped by film; retain explicit audio/subtitle distinction. |
| [This weekend](https://vobarna.com/en/showtimes/this-weekend/) | 961px | Familiar date controls and current/upcoming day first. |
| [Catalan subtitles](https://vobarna.com/en/showtimes/catalan-subtitles/) | 649px | Shared cards showing only confirmed matching sessions. |
| [IMAX](https://vobarna.com/en/guides/imax-original-version-barcelona/) | 836px | Matching poster grid followed by sourced format/venue guidance. |
| [35mm and 70mm](https://vobarna.com/en/guides/35mm-70mm-barcelona/) | 838px | Shared cards under format groups; concise empty states. |
| [Gràcia](https://vobarna.com/en/guides/original-version-cinema-gracia/) | 1,002px | Concise area/venue controls, shared cards, then practical venue guidance. |
| [Eixample](https://vobarna.com/en/guides/original-version-cinema-eixample/) | 1,103px | Concise neighbourhood/cinema controls with scoped film results. |
| [Classics](https://vobarna.com/en/guides/classic-films-barcelona/) | 1,286px | Posters, original release years and compact season navigation. |
| [Discounts](https://vobarna.com/en/guides/cinema-discount-days-barcelona/) | 4,245px | Lead with clear offer comparisons; provide a direct jump to programme examples. |

The discount page has a different primary task: its offers appropriately precede film examples. Its 4,245px measurement alone is not a failure. Improve the offer hierarchy and access to examples; do not imply that example sessions qualify for a displayed price.

For programme-led guides, use a shorter visible title, one concise scope sentence and compact date/result information, then the film grid. For example: “Films in English”, “Barcelona and nearby cinemas · 21–27 Nov”, followed by dates and results. The fuller search-facing title can remain in metadata. Keep important language distinctions visible beside their groups. Put extended methodology, repeated source explanations and FAQs in accessible disclosures below results. That is a proposed extension of the reference-page hierarchy: the written rule requiring closed footer information currently names home, film and cinema pages specifically.

**Priority 2 — Turn the guide index into a useful directory.**

[Cinema guides](https://vobarna.com/en/guides/) is an undifferentiated bulleted list of long titles. English-audio and weekend pages are excluded from its main list by [the editorial renderer](../scripts/build_public_site.py#L701), although they remain available in footer navigation. That makes the directory incomplete for common discovery tasks.

Group entries by visitor intent: languages and subtitles, dates, neighbourhoods, formats, and practical help. Use concise linked titles, one-line descriptions and flat, clearly spaced groups. Current-film poster previews can help the programme collections; reference guides can use simple semantic illustrations or sample UI when useful. Retain the site’s flat treatment and persistent link affordances. Include English audio and weekend discovery in the main directory.

**Priority 2 — Close explicit component and target-size gaps.**

All inspected guide families load the shared stylesheet stack, use the site’s type and palette, and fit the viewport. However, standalone guide-index links measured as little as 18–19px high; many discovery film-title links were 22px high. These are primary navigation targets, not incidental links inside paragraphs, and fall below the written 44px target requirement. Index links also lacked persistent underlines. Screening disclosures and ticket actions already provide larger targets. Give the standalone links appropriate hit areas and link treatment through shared components.

The ten programme-guide families had no `.reading-wash` or `.card-body` sections, whereas the reference homepage/cinema listings and film page use them. Text therefore sits directly over the pattern, especially noticeably in the repeated session facts. Reusing the cards will fix their reading treatment; extend the wash deliberately to longer reading areas where needed, once per section. Preserve the visible pattern and avoid enclosing cards in decorative panels. This is a consistency/readability finding, not a measured contrast-ratio failure.

**Reference pages need tailored improvements.**

| Page | Assessment | Recommended change |
| --- | --- | --- |
| [VO/VOSE/VOSC/VOSI](https://vobarna.com/en/guides/vose-vosc-original-version/) | Partial: useful comparison table, but two substantial explanations precede it on mobile. | Lead with the audio/subtitle comparison and short examples, then explanations and links to matching programmes. |
| [Screen and sound formats](https://vobarna.com/en/guides/cinema-screen-sound-formats/) | Partial: shared flat comparison components, but lengthy introductory copy and room navigation delay comparison. | Bring a compact room comparison forward; summarize known screen, projection, sound and seating facts consistently. Keep sources and unknown measurements explicit. |
| [Discount days](https://vobarna.com/en/guides/cinema-discount-days-barcelona/) | Partial: useful two-column offer layout on desktop; conditions dominate each offer. | Emphasize day, cinema and published amount, keep qualifying conditions adjacent, and disclose longer details. Retain review dates and distinguish tariffs from actual booking quotes. |
| [How to search](https://vobarna.com/en/guides/how-to-search/) | Closest guide to the standard: constrained prose, reading washes, responsive example groups and actionable queries. | Add one compact example of the query/filter/result relationship if useful; prioritize this after the programme guides. |
| [Complete programme](https://vobarna.com/en/programme/) | Useful exhaustive reference, weak discovery entry point: 1,000 session links on the captured first page and roughly 20,000px of mobile content. | Keep its compact reference purpose; add clear film/date navigation, a return-to-visual-browse action and larger standalone film links. A full poster grid is not necessary for every reference row. |

The Today route already resolves to the visual listing. Its first poster started at 299px on mobile, matching the home experience. It does not need the separate discovery-page treatment.

**The existing style test does not establish browsing parity.**

[The style audit](../scripts/test_ui_consistency_browser.cjs#L57) checks loaded stylesheets, flat surfaces, maximum width, overflow and the radii of posters that exist. The poster assertion succeeds when there are no posters. Its touch-target selector omits discovery film titles and the plain guide-index links. It opens the first discovery disclosure before capturing that page, so it also misses the default state in which all showtimes are hidden. These explain how visual styling can pass while the guide experience remains substantially different.

Add focused checks when implementing the changes: nonempty programme guides render poster cards; the initial state includes bounded matching showtime previews; remaining-session counts reconcile; date/language/format scope survives dialog transitions; all standalone navigation targets meet the shared minimum. Continue checking exact-screening links, keyboard focus restoration, expired sessions, zero-result states, EN/ES/CA, and initial HTML without JavaScript. Screenshot review should include both the untouched first viewport and expanded interactions.

**Implementation sequence and proposed acceptance.**

1. Start with the English-language guide and the shared discovery renderer. Feed each film only its guide-selected sessions into `createListingView()` and `HOME_CARD_PREVIEW`; reuse existing poster, film and dialog components. Do not replace validated selection with a looser language/format query.
2. Apply the renderer to the other programme-guide families, preserving their groups, sources, exact screening links, canonical routes and language alternatives. Dates and cinemas can narrow the topic; they must not silently remove its defining constraint.
3. Rework guide-directory navigation and the reference-page hierarchy. Use existing poster assets and semantic comparisons where they help visitors decide.
4. Extend the relevant browser checks and compare screenshots with the reference pages before publishing.

As a proposed acceptance target, a populated programme guide should show the beginning of a poster in the first 600px at 390 × 900, with a visible matching schedule preview in the card and access to every omitted session. Opening a full schedule must not insert tens of thousands of pixels between adjacent films. Cards should use the established desktop columns, mobile width, uncropped posters, reading wash and keyboard/touch behavior. Reference pages should expose their useful comparison or primary action before lengthy methodology. These are proposed UX criteria; the existing design document does not specify a first-result pixel threshold.

Keyboard activation of the English guide’s disclosure passed. An upcoming exact-screening link opened the correct film-page dialog. Ticket links remained usable without JavaScript on English-language and 35mm/70mm pages. A screening expired during measurement and was correctly hidden; the interaction check was repeated with an upcoming session. No site implementation or deployment was changed by this review.
