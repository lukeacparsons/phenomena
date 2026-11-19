# Collector recheck — 19 November 2026

The live catalogue check and recovery pass successfully refreshed all **38 monitored venues**. The validated snapshot at **19:55 UTC** contains **3,081 upcoming screenings across 34 venues**, grouped into 303 films. Four cultural/programme sources currently have no qualifying future sessions; they still have successful source checks.

## Defects found and repaired

- **Sant Cugat changed its booking links.** Its official shop now links to `https://santcugat.admit-one.eu/`. The parser previously rejected that host. It now accepts the observed host only for Sant Cugat, while continuing to require HTTPS and the matching cinema code. Other hosts and cross-cinema links remain rejected. The recovery collected 64 screenings.
- **Unnumbered Verdi screenings stopped later seat checks.** Five consecutive sessions without a seat map could trigger the provider failure limit. An explicit `GlobalUnallocatedPerformance = true` response, after checking the performance identity, now means that this screening has no seat map. It stays unknown and does not block later screenings. Genuine errors still stop requests after five consecutive failures. Existing observations retain their count and acquisition time on failure.
- **A browser test stub no longer matched the frontend.** Added the DOM query method needed by the recent language-link refactor so the existing integration assertions execute again.

The first full collection ran from 19:48:10 to 19:51:34 UTC: 37 sources succeeded and Sant Cugat failed safely. Its previous 64 rows were preserved exactly. After the parser fix, the nearby/cultural recovery run refreshed all 15 sources without failures. Refreshing the retained Sant Cugat rows also removed four legacy generic language placeholders, restoring equivalence between the internal and public programme.

## Verification

| Check | Result |
|---|---|
| `npm test` | 295 Python tests, 38 Node tests, and film/date search assertion suites passed |
| New regression coverage | Verified booking-host migration and rejection cases; explicit unallocated versus malformed/wrong-screening pages; ordinary seat counting; continued refresh after six unallocated screenings; preservation of previous counts |
| `npm run programme:check` | 680 searches returned identical films/screenings; film details and WebMCP results matched the public projection |
| Live snapshot validation | No duplicate IDs, unproven original audio, missing source/booking links, timezone/date mismatches, invalid acquisition receipts, generic audio placeholders or invalid price observations |
| Original-audio evidence | 2,305 explicit original-version screenings; 775 screening/original-language matches; one reviewed original-language match |
| Internal prices | 1,942 upcoming screenings at 20 venues; amounts/ranges, currency, source and acquisition receipts validated |
| Public price privacy | No `price_data` or `price_eur` fields in the browser projection or freshly built public programme; frontend tool contract tests passed |
| `npm run site:build` | Successful local build: 1,217 pages |
| Live seat samples | Verdi `222577` correctly reported no seat map; allocated performance `222427` returned 100 available ordinary seats at 19:53 UTC |
| Monitoring | 38 healthy venues, zero warnings or critical states; authenticated heartbeat upload succeeded at 19:55:38 UTC |

The managed `com.vobarna.crawler` service was restarted to load the seat-refresh fix. Its new background pass had already refreshed 74 cached Verdi observations when inspected; a full seat pass was still running at the audit checkpoint. Watchdog tests cover stale sources, dead/stuck collection, deduplication, escalation, recovery and Telegram delivery failures. The remote watchdog's latest persisted check, at 19:45 UTC, had no open issues and no delivery error. No test Telegram notification was sent during this recheck.

## Remaining data limits

Original-version evidence does not always name the spoken language: **1,006 upcoming screenings** still have no explicit session audio-language value. They are qualified by original-version evidence; the collector does not invent a language. Film-level metadata may provide additional language information.

Seat availability is not universal. Unnumbered performances and sources without a verified seat feed remain unknown, and a failed refresh retains the previous observation with its original timestamp. The audit does not claim that every screening has a fresh seat count.

The source snapshot contained 3,083 rows; two had elapsed by the validation checkpoint. Time-based public filtering excluded them. Snapshot counts naturally change as screenings start.

Logs, source snapshots, health and validation evidence are in the ignored `output/collector-recheck-2026-11-19/` directory. The existing [robustness audit](crawler-robustness-audit.md) documents scheduling and alert policy.
