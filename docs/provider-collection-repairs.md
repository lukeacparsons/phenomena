# Provider collection repairs — 19 November 2026

The complete live run at **18:52–18:56 UTC** refreshed **38 of 38 monitored venues**, with zero failed cinemas. It published **3,092 unique screenings across 303 film entries**, all with `original_audio: true`. Four venues remain programme-discovery monitors, so a successful refresh does not imply that every venue supplied showtimes.

## Restored sources

Verdi, Verdi Park, Girona, all six Mooby cinemas and Filmax Gran Via had returned SiteGround HTTP 202 browser checks from the local collector. They now return valid, current programmes through the fallback described below. Existing parsers, identity checks, original-audio rules and suspicious-drop validation remain in force.

Sant Cugat Cinemas, Cinemes Montcada and Can Castellet also recovered their editorial metadata feeds (`metadata_status: ok`). Native Spanish/Catalan screenings can therefore qualify through matching original-language evidence as well as explicit VO labels. Unproven or dubbed variants are still excluded.

Institut Français recovered its main official agenda (`programme_mode: official_agenda`, `primary_agenda_status: ok`), supplying 13 verified future sessions. Six discovered events lacked sufficient original-version proof and were withheld. The official Ohlalà festival remains an explicitly partial fallback if the main agenda becomes unavailable again.

## Alternatives checked first

- Direct requests, including the existing browser-like HTTP client and normal request headers, returned the browser check.
- A fresh interactive browser could load the sites. Unattended Playwright and Puppeteer runs could not complete their automatic checks reliably, including headed runs. No personal browser state or CAPTCHA solving is used by the collector.
- Official alternative booking catalogues worked for Girona, but the equivalent Verdi/Mooby/Filmax catalogues were challenged too. Replacing the existing sources would also lose some editorial language and venue evidence.
- Fetching the original public sources from the existing Cloudflare account succeeded for Verdi, Girona, Mooby and Filmax. A narrow authenticated reader was deployed after those alternatives were tested.

## Direct requests first; restricted fallback

`scripts/catalogue_sources.py` still requests each source directly. Only a recognized SiteGround check on an approved source enables `scripts/provider_relay.py`. Ordinary errors, unrelated HTTP 202 responses and unknown hosts do not trigger the reader.

The separate `vobarna-source-reader` Worker is configured in `wrangler.sources.jsonc`; its implementation is `src/provider-source-reader.mjs`. It accepts authenticated `POST /programme` requests containing one approved public URL, then performs a **GET** upstream. It forwards no caller cookies, credentials, headers or body. Host/path policy is shared through `data/provider-source-policy.json`; redirects must remain on the same approved origin and path policy. Checkout actions and arbitrary destinations are rejected.

Reads have bounded time, redirects and body size. Only HTTP 200 HTML/JSON without a browser check is returned, with an acquisition receipt and `Cache-Control: no-store`. A failed reader request disables that host's fallback for the rest of the collection run. Existing collection failure handling preserves old rows and timestamps and leaves stale alerts active.

The Cloudflare secret is `SOURCE_TOKEN`. The local matching credential is in ignored `.crawler-secrets/provider-relay.json` (directory mode 0700, file mode 0600), with `url` and `token` fields. The client only sends that token to the fixed project Worker endpoint. To provision another host, transfer this private configuration securely; without it, direct collection still runs and blocked sources report failures. To rotate the credential, update the local private file and `wrangler secret put SOURCE_TOKEN --config wrangler.sources.jsonc` together. Never commit the token or place it in Wrangler's plain-text variables.

The reader is deployed independently of the public site and the existing Phenomena/watchdog Worker:

```sh
node_modules/.bin/wrangler deploy --config wrangler.sources.jsonc
```

## Other robustness fixes and checks

Mooby pages share the complete chain programme. A single unavailable venue/artwork page no longer discards all six cinemas: collection uses another successfully parsed shared programme and records unavailable pages. Likewise, optional Verdi/Girona homepage artwork cannot discard a valid API programme.

Tests cover direct-first behavior, recognized-check fallback, failure bounds, cache integrity, credential destination, request/response bounds, URL restrictions, redirect rejection and optional Mooby-page failure. `npm test` passed **277 Python tests and 35 JavaScript tests**, plus the film/date search assertion suites. The deployed reader was tested against all four affected programme providers before the complete live run. All 38 per-cinema health records passed after publication.

Seat availability remains a separate collection path. Restoring programme reads does not turn missing seat data into a count. The [21 November availability follow-up](seat-availability-investigation-2026-11-21.md) verifies inventory embedded in Verdi's unallocated ticket pages and adds Renoir, Texas, OCINE, Institut Français and Yelmo adapters, plus Girona sold-out confirmations. Pages without verified inventory and Splau sessions that omit area availability remain unknown or retain their last dated observation. Discovery-only cultural programmes still require exact session and original-audio evidence before publication.

The ignored `output/provider-repair/` directory retains the before snapshot, live run log and health output for this repair. The macOS service uses the new programme reader on subsequent hourly runs; the independent stale-cinema watchdog continues to use real acquisition receipts.

## Maldà homepage parsing — 21 November 2026

The production alert was valid: Maldà had 25 consecutive failures and its last
accepted programme was acquired at `2026-11-19T22:33:36.753961+00:00`. The other
37 monitored venues were healthy. A read-only reproduction inside the collector
failed with `Maldà timed card has unresolved date: mx 25`; both source pages
were reachable. Existing future listings and the heartbeat were intact.

The parser repair accepts both `Mi` and the site's `Mx` for Wednesday, and resolves
retained previous-week cards against the explicit programme year before filtering
expired screenings. It reconciles two reviewed title variants only for their exact
film links: `LORCA, LA VOZ QUEBRADA` / `La voz quebrada` and `RECUERDA TU NOMBRE` /
`Recuerdo tu nombre`. Unrelated films, conflicting duplicate slots and mismatched
languages still fail validation. Existing weekly film identities are retained.

Homepage cards supply dated additional sessions, film-page links and posters.
Poster collection now chooses the largest image explicitly advertised in
`data-srcset`/`srcset`, falling back to the card image. Session-specific prices
are read from that session's text rather than the entire film card.

Local verification against captured live pages produced **20 upcoming screenings
for 13 films**, including two homepage-only sessions. All **13 source posters**
downloaded and decoded successfully (640–1593 pixels wide), and the normal catalogue
and browser projection retained them. **70 targeted tests passed**, including
Wednesday labels, week/year rollover, title conflicts, larger posters, duplicate
slots, original-audio validation and cache retention. Evidence is in the ignored
`output/malda-investigation-2026-11-21/` directory. This validation does not itself
deploy the change or refresh the production receipt; check those independently
after deployment.
