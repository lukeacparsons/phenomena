# Barcelona premium VOSE sources

Investigated 19 November 2026, with initial captures around 10:11 Europe/Madrid and a subsequent check of the official Cinesa page in Brave. User preference: **all original languages with Spanish subtitles**, not English only. This is an extraction feasibility spike; the production Worker and frontend have not been modified or deployed.

## Result

All seven venues now have locally verified structured sources with session booking links. **Cinesa's anonymous token can be obtained automatically**, without a personal browser session, using the Chrome-compatible HTTP client in `scripts/cinesa_showtimes.py`; this supports both Diagonal Mar and LUXE La Farga. Kinépolis Splau uses a populated modern embedded programme, rather than the supplied legacy timetable. Repeated fresh processes returned identical qualifying session IDs. Only the shopping-centre fallback is limited to today. None of these new adapters has been deployed to a scheduled host yet.

| Venue | Source and evidence | Required session predicate | Matching sessions in capture |
| --- | --- | --- | ---: |
| Mooby Balmes | JSON embedded in Mooby HTML, including actual room | `BAL-BALMES` + VOSE variant + `audio == "Dolby Atmos"` + room `08` or `09` | 57 |
| Mooby Aribau Cinema | Same JSON; booking page independently confirms Sala 05 | `BAL-ARIBAU` + VOSE variant + room `05` | 22 |
| Mooby Bosque | Same JSON, with explicit variant audio and actual room | `BAL-BOSQUE` + VOSE variant + `audio == "Dolby Atmos"` + room `01` | 14; 6 across 19–25 November |
| Yelmo Westfield La Maquinista | Public JSON POST, successful without cookies | Cinema `1350` + VOSE language + PREMIUM/XE/ATMOS in the **same format group** | 49 |
| Cinesa Diagonal Mar | Public site configuration supplies the anonymous token; Vista API supplies published dates and individual sessions | Same session has VOSE and IMAX or iSense | 76 across the full published programme: 43 IMAX, 33 iSense; 19 across 19–25 November |
| Cinesa LUXE La Farga | Same automatic token and Vista API, site `010` | Site `010` + VOSE; LUXE applies to the venue | 23 across the full published programme; 10 across 19–25 November |
| Kinépolis Barcelona Splau | Modern HTML embeds structured current/future sessions and exact film variants | `PFULL` + original audio + Spanish subtitles + Atmos or Laser ULTRA on the same session | 42 across 15 December–3 January; 0 across 19–25 November |

These counts describe scheduled sessions, not seats. Counts are a point-in-time observation, not a promise of future availability. Including only 19–25 November gives 24 Balmes, 6 Aribau, 6 Bosque, 13 Yelmo, 19 Diagonal Mar, 10 La Farga and 0 Splau sessions. Qualifying advance listings extend to 24 December for Mooby and 5 June 2027 for Yelmo, including special events. Cinesa Diagonal Mar advertises 35 published business dates through 7 January; La Farga advertises 33 through 5 January. The collectors now default to all published future sessions; an explicit `--days` window is optional for Cinesa and Kinépolis. Availability on the latest qualifying sessions was separately tested below.

## Future horizon audit: 19 November 2026

Fresh schedule captures at approximately **12:06 Europe/Madrid**, followed by availability checks at **12:10**, establish the following current reach. All rows require original audio with Spanish subtitles and the venue/room/format predicates above. Days ahead are calendar-date differences from 19 November. These are **latest matching published sessions**, not fixed API limits or evidence of complete daily programming through those dates.

| Cinema / room / experience | Matches in full capture | Latest matching date | Days ahead | Availability on the latest matching session |
| --- | ---: | --- | ---: | --- |
| Balmes Sala 8, Atmos | 30 | 23 December 2026 | 34 | Seat grid verified |
| Balmes Sala 9, Atmos | 27 | 24 December 2026 | 35 | Seat grid verified |
| Bosque Sala 1, Atmos | 14 | 23 December 2026 | 34 | Seat grid verified |
| Aribau Cinema, Sala 5 | 22 | 24 December 2026 | 35 | Seat grid verified |
| Diagonal Mar Sala 9, IMAX | 43 | 30 December 2026 | 41 | Seat layout and availability verified |
| Diagonal Mar Sala 10, iSense | 33 | 7 January 2027 | 49 | Seat layout and availability verified |
| La Farga LUXE, all VOSE rooms | 23 | 23 December 2026 | 34 | Seat layout and availability verified; per-room results below |
| La Maquinista PREMIUM | 24 | 20 December 2026 | 31 | Unknown; no verified independent availability method |
| La Maquinista XE, Sala 9 | 2 | 15 December 2026 | 26 | Unknown |
| La Maquinista ATMOS, Sala 12 | 1 | 1 December 2026 | 12 | Unknown |
| La Maquinista CA PREMIUM events | 22 | 5 June 2027 | 198 | Unknown; latest is Parsifal, a MET opera screening |
| La Maquinista XE ATMOS combined label | 0 | No matching session in this capture | — | Unknown |
| Splau Laser ULTRA, Sala 11 | 1 | 15 December 2026 | 26 | Available seats by area verified |
| Splau Laser ULTRA, Sala 12 | 0 | No matching session in this capture | — | No qualifying session to test |
| Splau Atmos, Sala 16 | 39 | 3 January 2027 | 45 | Available seats by area verified |
| Splau Atmos, Sala 17 | 2 | 27 December 2026 | 38 | Available seats by area verified |

### Published calendar versus qualifying programme

The raw source for a cinema can extend beyond its matching sessions. Do not use its final date as the horizon for our filtered listings.

| Cinema | Latest date in the source before applying our predicates | Latest matching date |
| --- | --- | --- |
| Balmes | 24 December 2026 | 24 December 2026 |
| Aribau | 25 May 2027 | 24 December 2026 |
| Bosque | 25 May 2027 | 23 December 2026 |
| Diagonal Mar | 7 January 2027, across 35 published dates | 7 January 2027 |
| La Farga | 5 January 2027, across 33 published dates | 23 December 2026 |
| La Maquinista | 5 June 2027, across 52 published dates | 5 June 2027 including CA PREMIUM events |
| Splau | 16 January 2027, across 35 published dates | 3 January 2027 |

Both Cinesa venues were expanded beyond the initial seven-day sample: every date returned by `film-screening-dates` was fetched, examining 488 Diagonal Mar and 299 La Farga sessions. The requested 60-day window included all dates advertised in these captures. Direct API requests for 8 January at Diagonal Mar, 6 January at La Farga, and 17 February at both venues returned valid responses for the requested dates with zero sessions. The endpoint accepts these later dates; nothing in those results establishes a permanent maximum or future availability. The collectors' 60-day Cinesa and 90-day Kinépolis CLI caps apply only when explicitly requesting a bounded window. The default has no end-date cap; neither limit represents a discovered provider restriction.

Mooby's embedded programme and Yelmo's public response already contain their exposed future dates in one fetch each. Splau requires combining and deduplicating both `current_movies` and `future_movies`; this audit applied no date cutoff to that combined programme. Distant advance sales and event screenings create gaps. In particular, there are no qualifying Splau sessions before 15 December in this capture. Do not present intervening empty dates as a complete programme with no possible future screenings.

### Evidence at the farthest matching session in each room

All 14 checks below succeeded using fresh HTTP clients. These are inventory snapshots taken now for future performances, not forecasts of how many seats will remain on the performance date. Mooby and Cinesa figures below count ordinary available seats separately from accessible/companion positions; Splau figures are provider area totals with no accessibility breakdown.

| Cinema / room | Latest matching local start | Provider session | Available at 12:10 on 19 November |
| --- | --- | --- | --- |
| Balmes 8 | 23 December, 21:15 | `188857` | 168 ordinary |
| Balmes 9 | 24 December, 17:30 | `188059` | 212 ordinary |
| Bosque 1 | 23 December, 21:00 | `141035` | 494 ordinary |
| Aribau 5 | 24 December, 17:30 | `69432` | 753 ordinary |
| Diagonal Mar IMAX 9 | 30 December, 18:50 | `032-60540` | 45 ordinary; 1 wheelchair, 1 companion |
| Diagonal Mar iSense 10 | 7 January 2027, 21:45 | `032-60563` | 328 ordinary; 2 wheelchair, 1 companion |
| La Farga 1 | 22 December, 19:10 | `010-37970` | 52 ordinary; 2 wheelchair, 1 companion |
| La Farga 2 | 6 December, 12:00 | `010-38649` | 39 ordinary; 1 wheelchair, 1 companion |
| La Farga 3 | 23 December, 19:40 | `010-38460` | 44 ordinary; 1 wheelchair, 1 companion |
| La Farga 4 | 15 December, 20:00 | `010-37198` | 84 ordinary; 3 wheelchair, 2 companions |
| La Farga 7 | 26 November, 21:15 | `010-39451` | 62 ordinary; 2 wheelchair, 1 companion |
| Splau Laser ULTRA 11 | 15 December, 19:20 | `PFULL-250511` | 140 standard-area, 0 recliner-area |
| Splau Atmos 16 | 3 January 2027, 21:00 | `PFULL-257388` | 109 standard-area, 20 recliner-area |
| Splau Atmos 17 | 27 December, 11:30 | `PFULL-258883` | 114 standard-area, 20 recliner-area |

For completeness, La Maquinista's latest matching dates by room and raw experience are: PREMIUM room 1 → 19 November; room 3 → 2 December; room 8 → 1 December; room 10 → 17 December; room 11 → 20 December. XE room 9 → 15 December; ATMOS room 12 → 1 December. CA PREMIUM events: room 1 → 5 June 2027; room 6 → 3 June 2027; room 10 → 25 May 2027. Availability remains unverified for all of these.

### Implications for scheduled collection

Discover all published dates on every schedule refresh rather than assuming a seven-day provider limit. Retain all matching future sessions, including advance sales and events, while recording `latest_published_date` and `latest_qualifying_date` separately per venue and experience. A distant maximum date must not imply continuous coverage. If a configured collection cap truncates discovery, expose that truncation explicitly.

Implemented locally in the Cinesa and Kinépolis collectors: omitting `--days` selects `coverage.mode: "all_published"`, with `requested_end: null`. Each report records the venue's `latest_published_date` separately from `latest_qualifying_date` among retained sessions, using null for an empty result. With `--days`, the mode becomes `date_window`; `published_dates_beyond_window` and `truncated_by_window` expose known dates beyond the requested end. A bounded report's latest qualifying date describes only its collected window. Cinesa fetches every discovered date from the requested start onward in the default mode; Kinépolis filters the complete embedded programme. Mooby and Yelmo's existing offline probe already retains all future matches in its input captures. These horizon fields do not imply continuous programme coverage or seat availability.

Availability can be retrieved at the latest observed matching date for Mooby, Cinesa and Splau. This is evidence that those dates work, not a guarantee that every individual session will always return inventory. Collect availability independently, retain its own timestamp and failure status, cache layouts, and refresh nearby or user-viewed sessions more often than distant sessions. Keep Yelmo availability null until a read-only method is verified. These probes were local; reliability from a scheduled cloud runner still needs a separate test.

Raw research captures, normalized schedules, per-room availability results and the repeatable audit helper are in `/private/tmp/phenomena-research-20261119/`: `horizon-*`, `cinesa-horizon-*.json`, and `audit_horizon_availability.py`. No production collector, cron or notification flow was changed for this audit.

## Mooby: one fetch covers all three cinemas

Pages checked:

- [Dedicated Atmos programme](https://www.moobycinemas.com/dolby-atmos).
- [Balmes full programme](https://www.moobycinemas.com/balmes).
- [Aribau programme](https://www.moobycinemas.com/aribau).
- [Bosque full programme](https://www.moobycinemas.com/bosque).
- [Public schedule JavaScript](https://www.moobycinemas.com/assets/js/events-grid.js?v=0.0.347).

The fetched Aribau page and dedicated Atmos page both contain `window.shops = {...};` with all six Mooby cinemas; the two captured objects were identical. Parse this assignment as JSON, without evaluating page JavaScript. The relevant identities are:

| Cinema | Numeric ID | Stable code |
| --- | --- | --- |
| Balmes | 29 | `BAL-BALMES` |
| Aribau / Aribau Cinema | 28 | `BAL-ARIBAU` |
| Bosque | 27 | `BAL-BOSQUE` |

Each shop has `events[]`. These are film **variants**, with `code`, `imdbid`, `name`, `locale_title`, `version`, `audio`, `language`, `subtitles_lang`, and `performances[]`. A performance supplies `performance_code`, `time` (`YYYYMMDDHHmmss`), `schedule_date`, `hall_code`, and `hall_name`.

Carry version/audio/language from the variant into its own performances before combining films. Do not merge variants by IMDb ID first and then apply the combined labels to every performance. Reject unspecified versions even if the film title contains VOSE; discrepancies should be reviewable, not guessed.

For Balmes and Bosque, require all four conditions in the table, including the actual room and explicit Dolby Atmos audio. The [dedicated Atmos page](https://www.moobycinemas.com/dolby-atmos) identifies Balmes rooms 8/9 and Bosque room 1. A room equipped with Atmos can show a non-Atmos presentation: Bosque's captured Sala 1 opera sessions were VOSE but Dolby Surround 5.1, so are excluded. For Aribau, filter the actual room; the UI's original-version and Aribau Cinema tabs are insufficient guarantees for every time shown on a film card.

Bosque was added after a fresh HTTP 200 capture of the Atmos page at approximately **11:10 Europe/Madrid on 19 November**. Its existing `BAL-BOSQUE` entry supplies film metadata, variant version/audio, performance ID, time, room and a Bosque-specific booking template. It requires no additional fetch beyond the shared Mooby payload. The strict predicate found **14 sessions in Sala 01**, spanning 20 November–23 December: six Hunger Games, one Dune and seven Avengers screenings. The six Hunger Games sessions fall within 19–25 November, at 21:05 daily from 20–25 November. `VOSE - INFINITY VISION - ATMOS` qualifies when the explicit audio and room also match; additional format labels do not disqualify a session. Original languages remain unrestricted.

The site's `shop_url` template takes performance ID, interface language, and theatre ID. `events-grid.js` confirms this order; the Spanish interface code is `esp`. Example booking pages opened read-only:

- [Balmes performance 189683](https://moobycinemas-balmes.admit-one.eu/seats/189683/): Clayface, VOSE/ATMOS, **SALA 08**, 19 November at 21:40.
- [Aribau performance 69872](https://moobycinemas-aribau.admit-one.eu/seats/69872/): Los juegos del hambre: Amanecer en la cosecha, VOSE, **SALA 05**, 20 November at 17:45.
- [Bosque performance 141987](https://moobycinemas-bosque.admit-one.eu/seats/141987/): Los juegos del hambre: Amanecer en la cosecha, VOSE/ATMOS, **SALA 01**, 20 November at 21:05. A fresh read-only HTTP fetch independently confirmed the room, labels and time.

No seats were selected. All three booking pages matched the structured source. `performance.data.available` was `false` for the original Balmes and Aribau records despite the booking page displaying a seat-selection interface. It is not a verified sold-out flag and must not become the existing frontend's `purchase_open: false`.

## Yelmo: public schedule JSON

The [La Maquinista page](https://yelmocines.es/cartelera/barcelona/westfield-la-maquinista) issues:

```http
POST https://yelmocines.es/now-playing.aspx/GetNowPlaying
Content-Type: application/json; charset=UTF-8

{"cityKey":"barcelona"}
```

Replaying this exact read-only request with curl, without cookies, Origin, authentication or API keys, returned HTTP 200 and approximately 1.07 MB of JSON. Its 455 La Maquinista session IDs exactly matched the browser response. A web-search fetch of the page itself had returned 403; the public endpoint and browser page worked from this machine.

Path through the response:

```text
d.Cinemas[]                     Key == westfield-la-maquinista
  Id = 81, VistaId = "1350"
  Dates[]                       FilterDate, ShowtimeDate
    Movies[]                    Id, Title, Poster, RunTime, Director, etc.
      Formats[]                 Name, Language, RelationshipFormatMovieId
        Showtimes[]             ShowtimeId, VistaCinemaId, Screen, Time,
                                TimeFilter, IsSpecialDate
```

The request includes other Barcelona-area cinemas, so cinema filtering is mandatory. Match language and experience **within one `Formats[]` entry**, then take only that entry's `Showtimes[]`.

- Require an explicit VOSE label in `Language`, regardless of original language. Japanese, French, Italian and German VOSE options were present, as well as English.
- Accept PREMIUM, XE (displayed as Macro XE), XE ATMOS and ATMOS. Preserve the raw format text.
- Include `CA PREMIUM`: the site's filter creates separate CSS tokens from the format name, so it falls within the PREMIUM experience. It accounts for 22 of the 49 matches, including theatre/opera and other event screenings. The other matches are 24 PREMIUM, 2 XE and 1 ATMOS.
- Exclude Spanish-dubbed, English without subtitles, and VOSI (English subtitles). Do not assume every room at a venue branded Premium meets the requested session criteria.

Use the public link format:

```text
https://compra.yelmocines.es/?cinemaVistaId=1350&showtimeVistaId=48239
```

The browser's visible Rocky session matched this example: 19 November at 20:15, PREMIUM, English VOSE. `Screen` is also exposed in the JSON.

**Date trap:** `TimeFilter` is not a reliable UTC instant for display in Madrid. In the captured payload, a displayed 17:15 time encodes as 23:15 UTC; converting that instant to Madrid would show 00:15 the following day. Read the calendar date from the date bucket and use the provider's `Time` string. The provider's [filter/rendering script](https://eu-static.yelmocines.es/content/scripts/action-now-playing-filters.js) does the same for normal sessions and contains special handling for `IsSpecialDate`. The probe conservatively reports and omits special-date and before-06:00 sessions until midnight/DST examples can be verified. None were present in the captured La Maquinista schedule.

## Cinesa: automatic anonymous-token bootstrap and future schedules

The [official Diagonal Mar page](https://www.cinesa.es/Cines/diagonal-mar/) loads correctly in the user's normal Brave browser. It offers date buttons from today through 7 January 2027. Those buttons alone do not establish that every date has screenings, but selecting **Friday 20 November** loaded a different, populated schedule. A qualifying session was independently observed:

- Los juegos del hambre: Amanecer en la cosecha, **20 November 2026 at 21:45**, **Sala 9, IMAX + VOSE**.
- Film ID: `HO00003802`; session ID: `032-60528`.
- [Session-specific booking link](https://www.cinesa.es/compra/butacas/?showtimeId=032-60528), observed in the page without starting checkout.

This corrects any inference that Cinesa itself only exposes today's times. The headless research browser and curl still received a Cloudflare challenge/HTTP 403 for both uppercase `/Cines/` and lowercase `/cines/` page URLs. The difference is browser access, not schedule coverage.

Brave's Network panel showed the initial schedule request:

```text
GET https://vwc.cinesa.es/WSVistaWebClient/ocapi/v1/showtimes/by-business-date/first?siteIds=032
```

The publicly downloadable [application JavaScript](https://www.cinesa.es/scripts/vite/src/main.DwNzMSLV.js) defines the date-specific route:

```text
GET https://vwc.cinesa.es/WSVistaWebClient/ocapi/v1/showtimes/by-business-date/YYYY-MM-DD?siteIds=032
```

It also defines a `film-screening-dates` route, and consumes `showtimes` with `relatedData` for films, sites, attributes and screens. The application supplies a bearer token through `authTokenProvider`, reading `api.authToken` from its configuration. Initial configuration can be embedded in `window.initialData` or fetched from `/api/omnia/v1/initialData`.

### Working token acquisition

Ordinary curl received HTTP 403 from the initial-data endpoint, and an unauthenticated API request returned 401. A fresh Python process using [`curl_cffi`](https://curl-cffi.readthedocs.io/en/latest/quick_start.html) with `impersonate="chrome"` successfully fetched both endpoints. This client supplies a Chrome-compatible TLS/HTTP fingerprint, beyond a User-Agent header. No user login, browser cookie export or CAPTCHA interaction was involved.

The flow implemented in `scripts/cinesa_showtimes.py` is:

1. `GET https://www.cinesa.es/api/omnia/v1/initialData`, accepting JSON.
2. Read `api.authToken` and verify `api.apiUrl` is exactly `https://vwc.cinesa.es/WSVistaWebClient`.
3. Send `Authorization: Bearer <token>` to that API with the same HTTP client type.
4. Discover dates via `/ocapi/v1/film-screening-dates?siteIds=032`.
5. Fetch each published business date within the requested horizon via `/ocapi/v1/showtimes/by-business-date/YYYY-MM-DD?siteIds=032`.

A separate, cookie-free `curl_cffi` client also fetched schedules successfully with the retrieved token. Ordinary Python urllib still received 403 even with the valid token, so **use this client for the schedule requests as well as bootstrap**. A browser User-Agent alone did not establish equivalent access.

The captured token is a JWT with an `exp` claim of **19 November 2026, 21:15:19 UTC**. Fresh bootstraps returned the same currently valid token; this appears to be shared/cached site configuration, not a token minted uniquely for each request. The implementation obtains configuration on every process start, refreshes within 60 seconds of known expiry, and re-fetches once after a 401. An already expired bootstrap token, persistent 401, 403, HTML challenge or malformed response fails the run. Transient 429/5xx responses get bounded retries, respecting short `Retry-After` delays. Token expiry/401 handling is regression-tested; actual provider rotation after expiry has not yet been observed.

Tokens stay in memory and are excluded from output and logs. Redirects are disabled on authenticated requests. No token or personal browser cookies are committed. The output file is replaced atomically only after complete collection succeeds, preserving the previous snapshot on failure.

### Verified schedule data

The response contains `businessDate`, `showtimes[]`, and `relatedData` tables for films, sites, attributes and screens. Each showtime supplies its ID, film/site/screen IDs, explicit-offset `schedule.startsAt`, a separate `filmStartsAt`, `attributeIds`, and `isSoldOut`. The collector joins film title/runtime and the public screen name, then requires **VOSE plus IMAX or iSense on the same showtime**. Original audio language is not inferred from VOSE; all original languages qualify. Cinesa's [VOSE guidance](https://ayuda.cinesa.es/hc/es/articles/16922771396893--Qu%C3%A9-sesiones-se-proyectan-en-idioma-original-VOSE) also places the designation at the individual session level.

Do not use aggregated film/date attributes to qualify individual sessions. `VO` means original audio without subtitles and is excluded. Resolve the public room name through `relatedData.screens`: a screen ID suffix is not necessarily the public room number (`032-12` was labelled Sala 11). Observed premium room names were `Sala 9 Imax` and `Sala 10  iSense`. Format still comes from session attributes, not that room label.

The collector retains the provider's business date separately from the actual calendar date/time, using the explicit timestamp offset and `Europe/Madrid` for display. `isSoldOut: false` means the provider has not marked the session sold out; it does not establish exact seats, price or successful booking.

Two fresh seven-day collections at **11:03 and 11:06 Europe/Madrid** each examined **235 screenings** and returned the same **19 qualifying session IDs** for 19–25 November: **11 IMAX in Sala 9, 8 iSense in Sala 10**. The 20 November Hunger Games session observed in Brave appears with the same ID/time/room in the API. Today's three matches agree with the mall fallback. Published-date discovery returned 35 dates through 7 January 2027. The later full horizon audit enumerated all 35 dates and found 76 matching sessions.

### Reproduce the automated collector

Use Python 3.10+ on a normal Python/container runner; `curl_cffi` includes a native curl implementation and is not a drop-in dependency for the existing JavaScript Cloudflare Worker. `--cinema diagonal-mar` is the default; `--cinema la-farga` selects the LUXE venue's VOSE-only qualification rule.

```sh
python3 -m venv /tmp/phenomena-cinesa
/tmp/phenomena-cinesa/bin/python -m pip install -r scripts/requirements-cinesa.txt
/tmp/phenomena-cinesa/bin/python scripts/cinesa_showtimes.py \
  --output /tmp/phenomena-cinesa/showtimes.json
python3 -m unittest discover -s scripts -p 'test_*.py'
```

The default fetches all published future business dates. `--start-date YYYY-MM-DD` selects a different initial business date; optional `--days` accepts 1–60 for a bounded run. Output includes requested coverage, published/fetched dates, latest published and qualifying dates, explicit window truncation, collection time, counts and normalized sessions with booking URLs. The current full Diagonal Mar programme needs 37 requests: one bootstrap, one date-discovery request and 35 schedule requests, excluding retries/token refresh. Run this from the intended scheduled host before choosing infrastructure: local success does not establish access from its IP or long-term resistance to provider changes.

### Cinesa LUXE La Farga

The [official cinema page](https://www.cinesa.es/cines/la-farga/) returned HTTP 200 with the Chrome-compatible client. Its embedded cinema record explicitly identifies `vistaCinema.key = "010"`, `value = "La Farga"`, and describes the venue as Cinesa LUXE with VOSE. The [shopping centre's description](https://centrolafarga.com/cines/) corroborates reclining seats, wider seats/row spacing, individual tables and 4K projection.

Reuse the existing anonymous bootstrap and API routes, changing `siteIds=032` to **`siteIds=010`**. Require VOSE at the session level but **do not require IMAX, iSense, Atmos or a per-session LUXE attribute**. The observed qualifying sessions have only the VOSE attribute. The collector records `venue_experience: "LUXE"` separately from `format: null` when no explicit session format is supplied. This avoids inventing an Atmos or IMAX presentation from the venue's comfort features.

Two fresh processes, at approximately **11:24 and 11:36 Europe/Madrid**, each examined **143 screenings** across 19–25 November and produced the same **10 qualifying session IDs**. Rooms: **Sala 2 (3 sessions)** and **Sala 7 (7)**. Films: Wildwood (1), Rocky (1), Hunger Games (8). Representative API records:

- `010-39274`: Wildwood, 19 November at 19:20, Sala 2, VOSE.
- `010-38636`: Hunger Games, 20 November at 21:15, Sala 7, VOSE.
- `010-39480`: Hunger Games, 20 November at 21:30, Sala 2, VOSE.

Booking links retain the existing session-specific route, for example `https://www.cinesa.es/compra/butacas/?showtimeId=010-38636`. No checkout was started. Date discovery returned 33 published business dates through 5 January 2027. The later full audit enumerated all 33 and found 23 matching sessions through 23 December, including rooms 1, 3 and 4 in addition to rooms 2 and 7. The same bootstrap/expiry/IP-access limitations as Diagonal Mar apply.

```sh
/tmp/phenomena-cinesa/bin/python scripts/cinesa_showtimes.py \
  --cinema la-farga --output /tmp/phenomena-cinesa/la-farga.json
```

### Shopping-centre fallback: today only

The [shopping-centre timetable](https://www.diagonalmarcentre.es/cine/) returned HTTP 200 with the schedule in the initial HTML. Within a desktop film card, qualified entries have:

```css
.gallery-items-desktop .gallery-item li.horari-item.vo-label.isense-label
.gallery-items-desktop .gallery-item li.horari-item.vo-label.imax-label
```

Check the VOSE text too. Read the film title from the same card's `.titol-peli`. Do not take the VOSE flag from one time and IMAX/iSense from another. The mobile layout duplicates these listings, so parse only one layout. A hidden `div.qweasd` also contains per-time JSON flags, but that appears to be a debugging artefact; the visible structured HTML is the better contract.

Observed on 19 November:

| Film | Time | Labels |
| --- | --- | --- |
| Clayface | 16:45 | VOSE + iSense |
| Godzilla Minus Zero | 22:15 | VOSE + IMAX |
| Cómo robar un banco | 21:50 | VOSE + iSense |

**Do not expand these times across the dates in `data-groups`.** The detail panel explicitly labels them “Hoy”. The [date-filter script](https://www.diagonalmarcentre.es/wp-content/themes/DM2018/js/directorio-cine.js) only hides/shows film cards; it does not fetch or replace times. In this capture, switching to tomorrow hid all films, and generated no schedule request. The dropdown listed 19–25 November while card date groups described 13–19 November.

Use the explicit `hoy` option's `data-group` as the date, and fail if it differs from the current Madrid day. Never carry these results into the next day as current listings. This fallback exposes no observed session booking IDs, seat counts or room numbers. Its purchase links lead to the cinema page. The three qualified times above also appeared on the official page's today view, but ongoing freshness/coverage is not established.

## Kinépolis Barcelona Splau

The [Laser ULTRA description](https://kinepolis.es/movie-formats/laser-ultra) confirms 4K laser projection and Dolby Atmos, installed in Splau rooms **11 and 12**. These room numbers describe Laser ULTRA equipment; they are not a restriction on the user's separate **VOSE + Atmos** criterion. Actual qualifying Atmos sessions were in rooms **16 and 17**.

### Access and the obsolete timetable trap

Plain curl and the headless browser received HTTP 403 for the supplied `https://kinepolis.es/kinepolis_movie_filter_now/PFULL/` URL. A fresh `curl_cffi` Chrome-compatible client received HTTP 200 without login, exported cookies, a bearer token or interaction. However, that legacy Drupal timetable has `list: null` and no programme. Its JavaScript's `kinepolis_movie_filter/load-content/now/PFULL/all/0/full` and corresponding `presales` route also returned HTTP 200 with empty programme data. **These responses do not establish that Splau has no screenings.**

The modern [Laser ULTRA page](https://kinepolis.es/movie-formats/laser-ultra) embeds the full structured national programme under JSON assignments to `Drupal.settings.variables`:

```text
complexes[]                 complexCode == PFULL, kine-api-id == 56
current_movies
  sessions[]                complexOperator == PFULL
  films[]                   join session.film.id to exact film.id
future_movies               same schema, overlaps current_movies
```

The site's [modern rendering code](https://kinepolis.es/sites/all/modules/custom/comato_replacement/js/common.js) reads these embedded current/future arrays before filtering the page display. Although the config also names metadata and programmation API hosts, this investigation did not establish a smaller direct programme API route. The working collector therefore uses the observed HTML source. The page is approximately **11.8 MB uncompressed** and contains other cinemas too; always filter `complexOperator`, deduplicate the overlapping arrays by session ID, and cache each fetched snapshot. This is heavier than the other sources.

### Session predicate and normalized data

`scripts/kinepolis_showtimes.py` decodes the JSON without evaluating JavaScript. It requires:

1. `complexOperator == "PFULL"`, matching `mainComplex`, and a public screening.
2. An **`Atmos` or `LASERULTRA` token in that session's `rawSessionAttributes`**.
3. An `es` subtitle token and no `nosubt`, plus matching Spanish subtitle IDs in `sessionSubtitles` and the exact film variant's `subtitles` (`code == "Span Subt"`).
4. The variant's `audioLanguage == originalAudioLanguage`, with its spoken-language code present in the session attributes. All original languages are accepted. Missing or contradictory metadata is an extraction error rather than a guessed match.

Do not match by title, by a film's combined format badges, or by room equipment alone. The raw combination `2D,Atmos,English,es` qualifies; `2D,Atmos,nosubt,Spanish` and `2D,English,es` do not. The session's `film.format` and `sessionAttributes` also resolve the observed Atmos and Laser ULTRA labels.

Available fields include provider session ID, Vista session ID, film ID and IMDb code, title, runtime, audio/original language, subtitles, actual room, explicit-offset showtime, business day and `isSoldOut`. Convert `showtime` to Europe/Madrid; preserve `businessDay` separately. The modern rendering code constructs booking links as:

```text
https://kinepolis.es/direct-vista-redirect/{vistaSessionId}/0/{mainComplex}/0
```

These are observed link templates, not completed bookings. A subsequent investigation verified per-area remaining-seat counts through the initial ticketing page; see the availability section below. `isSoldOut: false` alone does not establish a particular available seat or price.

### Verified coverage and reproduction

The initial modern-page capture and a fresh collector fetch at **11:36 Europe/Madrid** yielded the same **42 qualifying IDs** after deduplication, from **997 unique Splau sessions** examined. Qualifying dates span **15 December 2026–3 January 2027**:

| Type | Room | Matching sessions | Example |
| --- | --- | ---: | --- |
| VOSE + Laser ULTRA | 11 | 1 | Dune: Parte Tres, 15 December at 19:20; `PFULL-250511` |
| VOSE + Atmos | 16 | 39 | Vengadores: Doomsday, including 17 December at 15:00; `PFULL-253085` |
| VOSE + Atmos | 17 | 2 | Vengadores: Doomsday |

There are **zero matching sessions in 19–25 November** in the captured data. This is a healthy zero after inspecting a populated programme, distinct from the legacy endpoint's missing data. The programme does contain other VOSE screenings without the requested premium audio/format; they stay excluded. No qualifying Laser ULTRA session in room 12 was observed.

Use the same Python environment/dependency as Cinesa:

```sh
/tmp/phenomena-cinesa/bin/python scripts/kinepolis_showtimes.py \
  --output /tmp/phenomena-cinesa/splau.json
```

The default retains all 42 future matches in this capture. An explicit `--days 7` reports zero matches and flags the published dates beyond that window. `--input saved-page.html --as-of 2026-11-19T11:18:00+01:00` supports offline reproduction. Missing modern programme data, HTTP failures, schema inconsistencies and conflicting duplicate sessions fail collection without replacing the previous output. The network probe makes one request per run, with a timeout and no immediate retry; a scheduler should retry later and mark retained snapshots stale. Repeated local success is established, but the intended runner's IP and long-term source stability remain untested.

## Scheduled-runner readiness

A fresh cookie-free HTTP check at **10:44:48 Europe/Madrid on 19 November** returned HTTP 200 for Mooby, Yelmo and the mall fallback. Re-running the parser produced exactly the same qualifying session IDs as the initial 10:11 captures: 57 Balmes, 22 Aribau, 49 Yelmo and 3 fallback Cinesa sessions. This establishes repeatability on this machine over about 33 minutes, not production reliability from a cloud runner.

| Cinema / type | Rooms in the captured qualifying sessions | Sessions | Collection status |
| --- | --- | ---: | --- |
| Balmes VOSE + Dolby Atmos | 8: 30; 9: 27 | 57 | Plain HTTP; structured variant/room/time data; suitable for a scheduled adapter |
| Aribau Cinema VOSE | 5 | 22 | Same Mooby fetch; room is explicit; Atmos is not required or implied |
| Bosque VOSE + Dolby Atmos | 1 | 14; 6 in seven days | Same Mooby fetch; require room 01 and explicit VOSE/Atmos on the variant |
| La Maquinista VOSE + PREMIUM | 1, 3, 8, 10, 11 | 24 | Cookie-free JSON POST; room and language/experience group explicit |
| La Maquinista VOSE + CA PREMIUM | 1, 6, 10 | 22 | Same endpoint; includes alternative-content/event screenings |
| La Maquinista VOSE + XE | 9 | 2 | Same endpoint; Macro XE presentation |
| La Maquinista VOSE + ATMOS | 12 | 1 | Same endpoint; explicit ATMOS label |
| La Maquinista VOSE + XE ATMOS | No matching live example captured | 0 | Predicate is supported by the probe; combined live label is not yet verified |
| Diagonal Mar VOSE + IMAX | 9 | 11 in seven days | Automatic anonymous bootstrap + Vista API; repeated fresh-process HTTP success |
| Diagonal Mar VOSE + iSense | 10 | 8 in seven days | Same collector; actual session attributes and room names verified |
| La Farga LUXE + VOSE | 2: 3; 7: 7 | 10 in seven days | Same Cinesa anonymous bootstrap/API, site 010; LUXE is venue metadata |
| Splau VOSE + Laser ULTRA | 11 | 1 advance listing | Modern embedded programme; Chrome-compatible HTTP client |
| Splau VOSE + Atmos | 16: 39; 17: 2 | 41 advance listings | Same fetch and explicit session format/language; none in the next seven days |

Room lists here describe the matching records, not a permanent catalogue of all premium rooms. Continue to filter the format and language on each session, particularly at Yelmo and Cinesa.

Mooby and Yelmo provide film identity/title, scheduled date/time, cinema, room, session identity, language/version, format/audio and a session-specific booking destination. Mooby also provides IMDb ID and explicit original/subtitle languages. Yelmo's payload includes poster, runtime, director and synopsis, although the probe currently normalizes only the core session fields. Their bulk feeds do not provide verified remaining-seat counts. A subsequent per-session availability investigation verified seat grids for Mooby and Cinesa; see below. Yelmo seat counts remain unverified.

A 30-minute schedule collector is a reasonable starting design: one Mooby request for all three venues, one Yelmo request, one bootstrap plus date discovery plus one request per published date for each Cinesa venue (currently 37 requests for Diagonal Mar and 35 for La Farga), and one larger Kinépolis HTML fetch. A later combined Cinesa runner could share the bootstrap across venues. Availability polling is separate and should use its own cache and refresh frequency. Before calling it reliable, test these requests from the intended runner and observe repeated scheduled refreshes, including a programme update, date rollover and Cinesa token expiry. Keep independent source status/coverage, preserve still-valid prior data on failures, mark stale results, and distinguish a healthy zero-match result from a blocked or malformed response. For the mall fallback, expire coverage at Madrid midnight. Yelmo's unverified special-date/early-morning cases must stay explicit rather than silently shifting dates.

No new scheduled job has been deployed. Cinesa now has a working unattended bootstrap and collector, verified in multiple fresh local processes. Its remaining integration check is the intended runner and real token/date rollover, rather than obtaining a token from a manually opened browser.

## Seat availability compared with Phenomena

Investigated with read-only requests on **19 November 2026, around 11:40–11:45 Europe/Madrid**, with a follow-up Splau investigation at approximately **12:02**. The existing Phenomena Worker reads `Disponibles`, `Aforo`, `CompraAbierta` and `RazonCompraCerradaTexto` directly from its public session data, exposing remaining seats, capacity, whether sales are open, and a closure reason. The new showtime collectors collect schedules plus Cinesa/Kinépolis sold-out flags. Mooby/Cinesa per-seat sources below are verified research; Splau has a separate working `scripts/kinepolis_availability.py` collector. **These counts have not been integrated into the live site or scheduled polling.**

| Venue / rooms | Bulk showtime feed | Additional availability verified |
| --- | --- | --- |
| Mooby Balmes 8/9 | No reliable count; `available: false` is not a usable sold-out flag | Both booking pages contain a seat-status grid, room/row/seat labels and accessibility flags |
| Mooby Aribau 5 | Same limitation | Booking-page grid verified for Sala 5 |
| Mooby Bosque 1 | Same limitation | Booking-page grid verified for Sala 1 |
| Cinesa Diagonal Mar IMAX 9 / iSense 10 | `isSoldOut` | Anonymous GET endpoints return individual seat statuses and full layouts; both rooms verified |
| Cinesa LUXE La Farga | `isSoldOut` | Same endpoints; rooms 2 and 7 verified |
| Yelmo La Maquinista, all requested formats | No seat count or sold-out flag in the inspected schedule records | Booking app has a seat-map route, but unattended read-only access is not yet verified |
| Kinépolis Splau, Atmos / Laser ULTRA | `isSoldOut`, seating-plan flags | Remaining seats per seating area verified in rooms 11, 16 and 17; detailed seat map/capacity not yet established |

### Cinesa: per-seat availability works with the existing token

The [application bundle](https://www.cinesa.es/scripts/vite/src/main.DwNzMSLV.js) defines these routes, both confirmed HTTP 200 using a fresh automatically obtained anonymous token:

```text
GET https://vwc.cinesa.es/WSVistaWebClient/ocapi/v1/showtimes/{showtimeId}/seat-availability
GET https://vwc.cinesa.es/WSVistaWebClient/ocapi/v1/showtimes/{showtimeId}/seat-layout
Authorization: Bearer <anonymous site token>
```

No order, selected tickets, customer login or seat reservation was required. Availability supplies `seatAvailabilities[{seatId,status}]` and `isSoldOut`; layout supplies areas, rows, seat labels/IDs, positions and types such as `Normal`, `Wheelchair` and `Companion`. Observed statuses are `Available`, `Sold`, `Broken` and `House`. Join by seat ID. Count `Available` only, and report ordinary seats separately from accessible/companion spaces. Layout records represent mapped positions, not necessarily the saleable capacity for a particular customer/ticket type.

Point-in-time examples, **not current promises of inventory**:

| Room / session | Available ordinary seats | Available wheelchair / companion | Other seat statuses | Mapped positions |
| --- | ---: | --- | --- | ---: |
| Diagonal Mar IMAX 9, `032-60528` | 0 | 1 wheelchair, 1 companion | 146 sold, 6 broken, 2 house | 156 |
| Diagonal Mar iSense 10, `032-61091` | 324 | 2 wheelchair, 1 companion | 4 sold, 9 broken, 4 house | 344 |
| La Farga 7, `010-38636` | 8 | 2 wheelchair, 1 companion | 54 sold, 1 broken, 2 house | 68 |
| La Farga 2, `010-39274` | 36 | 1 wheelchair, 1 companion | 5 sold, 1 house | 44 |

All four had `isSoldOut: false`. The IMAX example demonstrates why this flag alone must not become an unqualified “seats available” badge. It has no ordinary seats left. Count availability is also distinct from finding adjacent seats or meeting booking rules.

Layout can be cached using the schedule's `seatLayoutId`; availability needs a separate fresh request per screening. At the current seven-day match counts, that means 29 availability requests across both Cinesa venues, plus layout requests on cache misses. Keep acquisition time and freshness with every result.

### Mooby: seat grids are embedded in the booking HTML

Fresh GET requests to the session booking links for Balmes performances `189683` (Sala 8), `189155` (Sala 9), Aribau `69872` (Sala 5) and Bosque `141987` (Sala 1) all returned HTTP 200. The HTML contains `GlobalPerfID`, `GlobalRowLabels`, `GlobalColumnData` and `GlobalSeatTypeCodes`. Its [seat rendering code](https://moobycinemas-bosque.admit-one.eu/script-v2/seats.js) explains how they are used.

`GlobalColumnData` entries expose a seat identifier, displayed seat/row labels, status, seat type, section, wheelchair/restricted-view/carer flags and linked-seat data. Identifiers `-1` and `-2` represent spacing/furniture rather than seats. The observed `O` entries render as available seats when their seat type is allowed; `X` renders unavailable (including isolated-seat handling). Observed `P` entries were wheelchair positions and need separate treatment. Do not call every unavailable seat “sold”: the grid does not establish whether it was sold, held or blocked.

The fresh captures contained these ordinary `O` positions with allowed seat types and no wheelchair/carer/restricted-view flag:

- Balmes Sala 8: **171**, from 182 mapped seat positions; one separate `P` wheelchair position.
- Balmes Sala 9: **112**, from 233 mapped seat positions; one separate `P` wheelchair position.
- Aribau Sala 5: **465**, from 1,053 mapped seat positions; four separate `P` wheelchair positions.
- Bosque Sala 1: **188**, from 500 mapped seat positions.

These are snapshots for the named screenings, not permanent room availability. A production parser should decode literal data without executing page JavaScript, validate performance identity, distinguish non-seat objects and accessibility/selection restrictions, and fail on unknown status codes. It will require one booking-page fetch per screening in addition to the shared Mooby schedule fetch. The full current qualifying programme contains 93 Mooby screenings; a seven-day horizon has 36, so prefer bounded polling and caching.

### Yelmo: remaining investigation

Yelmo's booking shell and [public application script](https://compra.yelmocines.es/static/js/main.d60d2c44.chunk.js) are readable with the Chrome-compatible client. The app calls `POST https://api-compra.yelmocines.es/api/seats` with cinema/showtime IDs, a checkout session ID, selected tickets and an `addTickets` flag. It processes a seat-layout response; a separate `/seats/set` action handles selection. This is a checkout-dependent route, not a proven standalone availability endpoint. No ticket-addition or seat-selection request was made. All La Maquinista experiences remain **availability unknown** in our collector pending a verified read-only method.

### Kinépolis Splau: remaining seats by seating area

The earlier root-page GET returning 403 was not the end of the ticketing investigation. **Following the normal cinema/session entry form succeeds** with a fresh Chrome-compatible HTTP client, without any customer login or saved browser cookies:

1. GET `https://kinepolis.es/direct-vista-redirect/{vistaSessionId}/0/PFULL/0`.
2. Read the `movie-program-vista-redirect-form`. It contains country/cinema/session/culture and other navigation fields, with no selected tickets, seats or payment details.
3. POST those navigation fields to `https://tickets.kinepolis.es`, preserving the source Origin and Referer, and follow its 302 redirect within the same request/session context.
4. The resulting `/Booking/TicketSelection` page contains **`var availSeats = [...]`**, with `AreaCode`, `SeatsAvailable`, and `IsSoldOut` for each seating area.

The [public redirect JavaScript](https://kinepolis.es/sites/all/modules/custom/movie_program/js/movie_program_vista_redirect.js) submits that same form automatically during normal navigation. An attempt to manually issue a separate GET after the 302 returned HTTP 500; following the redirect with the original navigation context worked. Plain root GET access is therefore a poor test of this flow.

The anonymous ticket-selection page explicitly had `OrderId: 0`, `NumberSeats: 0`, `SelectedTickets: null`, and `AllocatedSeats: null`. The collector validates those fields and stops if it sees selected tickets/seats or an actual order. Its only POST is the initial navigation form, not ticket addition, seat allocation or checkout submission. Cookie jars are created independently per screening and discarded; no anonymous session identifiers or cookie values are written into output.

**Read `availSeats`, not the individual ticket products' `SeatsAvailable` properties.** The latter were zero placeholders even when the area had 140 available seats. Different fares—General, Reducida and Fidelidad—refer to the same area. Sum each unique `AreaCode` once and retain its labels separately. The ticketing JavaScript itself uses `availSeats` to limit how many tickets can be selected.

Splau's public cinema identifier is `PFULL`; the ticketing page maps it to internal cinema ID `361`. The public session IDs also map to different internal identifiers, so do not build API requests by substituting public session IDs into internal fields. No standalone booking-API endpoint is needed for the verified area-count method.

Live examples captured at approximately **12:02 Europe/Madrid on 19 November**:

| Session / room | Standard area available | Premium recliner area available | Total reported available |
| --- | ---: | ---: | ---: |
| `PFULL-250511`, Sala 11, Laser ULTRA; Dune, 15 December 19:20 | 140 | 0 | 140 |
| `PFULL-253085`, Sala 16, Atmos; Avengers, 17 December 15:00 | 75 | 0 | 75 |
| `PFULL-258877`, Sala 17, Atmos; Avengers, 26 December 11:30 | 113 | 20 | 133 |

Two independent collector processes at approximately 12:02 returned identical area counts for all three screenings, with fresh per-screening cookie jars and no saved browser state.

The two observed area codes were `0000000000` (standard area, with general/reduced/loyalty or matinee fares) and `0000000002` (premium recliner area). Keep the provider's labels rather than assuming these codes will always have the same meaning. These are **reported availability by area**, not verified ordinary-seat counts: this page does not break out wheelchair/companion places, show a detailed seat map, establish total auditorium capacity or prove adjacent seats are available. Accordingly, the collector returns `availability_kind: "area_counts"`, `available_total`, `areas[]`, and null `capacity`/`accessibility_breakdown`.

The standalone collector is runnable with the existing Python/curl environment:

```sh
/tmp/phenomena-cinesa/bin/python scripts/kinepolis_availability.py \
  --session-id 250511 --session-id 253085 --session-id 258877 \
  --output /tmp/phenomena-cinesa/splau-availability.json
```

Each screening takes three HTTP requests (entry GET, navigation POST, redirected GET). Only normalized availability is saved, atomically after the batch completes; failures preserve the previous output. Tests cover area deduplication, misleading ticket-level placeholders, unknown/invalid counts, wrong cinema, nonempty order state, unexpected entry fields and excluding anonymous session identifiers from output. The page structure and entry context introduce more maintenance risk than a stable public JSON endpoint. Test the intended runner and apply caching/rate limits before scheduling; the verified method currently stops before ticket or seat selection.

Recommended data model: keep `sold_out`, ordinary available count, accessible/companion availability, mapped capacity, source and `availability_fetched_at` as distinct nullable fields. Unknown must remain unknown, not zero. Fetch availability separately from schedules so a seat-map failure cannot erase a valid screening. The local preview now collects counts automatically every 15 minutes, independently of page visits, and retains the last successful count and timestamp when a refresh fails.

The first complete local background pass on 19 November populated all **328 supported future screenings**: 94 Phenomena, 93 Mooby, 99 Cinesa and 42 Splau, with no errors. Yelmo's 49 sessions remain explicitly unknown. The shared cache is persisted at `static/preview-data/availability.json`; visible browser tabs read it every 15 seconds. The UI displays relative ages and has no manual seat-check button. This verifies the local process, not access from a cloud scheduler.

## Poster collection alongside showtime runs

Implemented locally on 19 November 2026. All four source adapters now emit a nullable **`poster_url`** tied to the exact source film identity. `scripts/collect_posters.py` accepts one or more normalized showtime files, downloads each unique URL once, and caches the original image bytes with a `posters.json` manifest. Image collection is a separate step in the same runner job, so an image failure cannot erase or invalidate showtimes.

A live batch across the seven venues fetched **49 distinct source assets**, covering every film variant in the 283 qualifying sessions. These are not 49 distinct movies: cinema chains and presentation variants can have separate artwork for the same film. The manifest deduplicates repeated URLs, including films shared by the two Cinesa venues, without merging unrelated films on title alone.

**High resolution is not universal in the cinema feeds.** The downloaded files measured:

| Source | Distinct assets | Actual pixel dimensions observed | At least 600 × 900 |
| --- | ---: | --- | ---: |
| Mooby, all three venues | 7 | Two 490 × 735; five 668 × 1,000 | 5 |
| Cinesa, both venues | 12 | Small posters around 196–236 × 295, plus 369 × 546 and 374 × 534; one 700 × 1,000; three 1,296 × 1,920 | 4 |
| Yelmo La Maquinista | 28 | Twenty-seven 137 × 204; one 264 × 386 | 0 |
| Kinépolis Splau | 2 | Both 440 × 660 | 0 |

Thus **9 of 49 source assets** meet the default target; the other 40 are explicitly flagged. The 600 × 900 threshold is a configurable product target suitable for a 300 × 450 card at twice its display resolution, not an industry definition of “high resolution.” No image is enlarged or regenerated. The Cinesa Clayface poster was also visually inspected and matches the film.

### Source details

- **Mooby:** `window.shops` has schedule/IMDb metadata but no poster URL. Parse the same page's `<a class="event" x-ref="tt…">` film cards and take their poster image, joined by exact IMDb ID. The shared schedule covers more venues than an individual page's artwork: the Aribau capture omitted Clayface's card, while the [Balmes page](https://www.moobycinemas.com/balmes) supplied it. The offline probe accepts repeated `--mooby-poster-page` arguments for additional captured venue pages. An Aribau capture plus Balmes/Bosque captures covered all seven qualifying films. Sources include `cms.elqueque.com` custom event posters and `www.bizcochito.es` film artwork; retain their actual URLs rather than inventing filenames.
- **Yelmo:** copy the exact movie's `Poster` field from the schedule JSON. The [Hunger Games synopsis page](https://yelmocines.es/sinopsis/los-juegos-del-hambre-amanecer-en-la-cosecha) uses the same small image in its poster and Open Graph metadata. Requesting JPEG instead of WebP did not increase resolution. Adjacent path variants failed and are not used. A separate verified artwork source is still needed for consistently large Yelmo posters.
- **Cinesa:** the anonymous bootstrap supplies `api.vistaCdn = https://vwc.cinesa.es/CDN`. The public application code's Vista image builder uses `/media/entity/get/FilmPosterGraphic/{filmId}`. This endpoint returns images without a bearer token or personal cookies, and without a requested thumbnail size. Some source files are large; others are intrinsically small in the observed response. Moviexchange release-poster URLs tested from the alternative CDN returned HTTP 400, so the collector uses the verified Vista route. A changed/missing CDN configuration leaves the poster null rather than failing the schedule.
- **Kinépolis:** take `mediaType == "Poster Graphic"` from the exact film variant's `images[]`; prepend `movieservice_image_url + "images"` to its `/ES/…` path. This matches `createPosterUrl` in the [public programme script](https://kinepolis.es/sites/all/modules/custom/comato_replacement/js/common.js). The `images` path segment is necessary. The website's `?impolicy=Poster` derivative is only 220 × 330; omitting it yielded 440 × 660. A documented [Akamai width request](https://techdocs.akamai.com/ivm/reference/test-images-on-demand) of 2,000 pixels still returned 440 × 660, so no larger native poster is established by this method.

The next artwork improvement is a reliable high-resolution fallback with verified movie identities, particularly for Yelmo, Splau and Cinesa's smaller files. Existing IMDb identifiers can help for Mooby/Splau; do not automatically choose a different chain's poster using an ambiguous title alone, especially for reissues, concerts and opera seasons. The current implementation preserves source provenance and reports the resolution gap rather than claiming all posters are high resolution.

### Runner and cache behavior

Install the optional image dependencies in the collector environment, then run the poster step after the schedule outputs are available:

```sh
/tmp/phenomena-cinesa/bin/python -m pip install -r scripts/requirements-posters.txt
/tmp/phenomena-cinesa/bin/python scripts/collect_posters.py \
  --input /tmp/phenomena-cinesa/showtimes.json \
  --input /tmp/phenomena-cinesa/la-farga.json \
  --input /tmp/phenomena-cinesa/splau.json \
  --output-dir /tmp/phenomena-cinesa/posters
```

Add the normalized Mooby/Yelmo reports as further `--input` arguments. The older shopping-centre fallback does not supply verified artwork in its normalized output; prefer the official Cinesa collector for those sessions. For the Mooby offline probe, add e.g. `--mooby-poster-page /tmp/phenomena-cinemas/balmes.html` after capturing that venue page.

The manifest records URL, provider/film references, actual width/height, decoded MIME type, byte length, SHA-256 filename, acquisition time, cache reuse, and `meets_target`. The response format can differ from the URL extension: Yelmo's `.jpg` URLs often deliver WebP, and Splau's deliver AVIF. Files keep the correct decoded extension and original bytes. `--min-width` and `--min-height` configure the target; `--max-age-days` defaults to seven, while zero forces a refresh.

Cached files are validated by size and SHA-256 and reused within their TTL. A failed refresh preserves the last valid file and marks its manifest entry `stale`; a first-time failure is `error`. Missing URLs are listed separately. Low resolution remains a successful image download with `meets_target: false`; manifest status describes acquisition, not whether every image meets the target. Individual poster failures produce a partial manifest and do not fail the scheduling step. Invalid input/cache files fail without replacing the previous manifest. The downloader restricts requests to the observed public image hosts, follows no redirects, verifies image contents, and never sends the Cinesa API token to an image host.

Tests cover exact source-film association, unique-URL deduplication, measured dimensions, preserving small images, warm-cache reuse, corrupted-file recovery, stale-file preservation and isolated missing/failed images. **53 tests passed** with the optional dependencies installed. The full live assets and manifest are under `/private/tmp/phenomena-research-20261119/poster-cache/`; this is a local cache, not deployed image hosting. No production Worker/frontend changes or scheduled job activation are included.

## Reproduce the probe

Only Python 3.9+ standard-library modules and curl are needed. Run from the repository root. Capture files contain public schedules; use a local scratch directory rather than committing complete third-party pages.

```sh
mkdir -p /tmp/phenomena-cinemas
curl --fail --silent --show-error --location --max-time 30 \
  https://www.moobycinemas.com/aribau -o /tmp/phenomena-cinemas/mooby.html
curl --fail --silent --show-error --max-time 30 \
  https://yelmocines.es/now-playing.aspx/GetNowPlaying \
  -H 'Content-Type: application/json; charset=UTF-8' \
  --data '{"cityKey":"barcelona"}' -o /tmp/phenomena-cinemas/yelmo.json
curl --fail --silent --show-error --location --max-time 30 \
  https://www.diagonalmarcentre.es/cine/ -o /tmp/phenomena-cinemas/diagonalmar.html
```

Supply the actual capture time, including its offset. The following time reproduces this investigation's saved captures, not future fetches:

```sh
python3 scripts/explore_premium_showtimes.py \
  --mooby /tmp/phenomena-cinemas/mooby.html \
  --yelmo /tmp/phenomena-cinemas/yelmo.json \
  --diagonal-mar /tmp/phenomena-cinemas/diagonalmar.html \
  --as-of 2026-11-19T10:11:00+01:00 \
  --output /tmp/phenomena-cinemas/qualified.json
python3 -m unittest discover -s scripts -p 'test_premium_showtimes.py'
```

The probe performs no network requests. It returns namespaced session IDs, cinema identity, local date/time, room, language, subtitles, raw format, source and booking URLs, and explicit unknown availability. Missing venue/schema/date information fails rather than silently producing a misleading empty schedule. Tests cover mixed format/language groups, wrong cinemas and rooms, non-English VOSE, VOSI exclusion, dates, and duplicate mobile markup.

Original captures and normalized output for this investigation are under `/private/tmp/phenomena-research-20261119/`. These are local research artefacts, not committed production data.

## Integration into the existing site

The current `src/worker.js` reads Phenomena's inline `addToJSON` structures, caches events in KV, and refreshes on the configured half-hour cron during UTC hours 6–20. `static/index.html` infers format badges from film names and routes purchases through Phenomena-specific checkout code. Additional cinemas require explicit session metadata and booking destinations.

Recommended next implementation:

1. Integrate independent source adapters: Mooby (one fetch for Balmes, Aribau and Bosque), Yelmo, Cinesa (Diagonal Mar and La Farga), and Kinépolis Splau. Verify access from the intended scheduled host. The Cinesa and Kinépolis collectors require a native Python/curl runtime; plan scheduled collection separately from the existing JavaScript Worker, which can consume/cache the resulting data. Local unattended HTTP access is now verified for all four chains; cloud-host access is not.
2. Normalize sessions before grouping movies. Keep `provider`, `cinema_id`, provider session ID, local date/time plus `Europe/Madrid`, actual room, version/language, subtitles, premium format, source URL, fetched timestamp, and booking URL/scope. Use IMDb IDs where available; do not merge unrelated films solely by title. Preserve provider film IDs elsewhere.
3. Apply the venue predicates above server-side. Show cinema, room and premium/language badges per session. Keep missing attributes explicit. Preserve existing Phenomena behavior while sending other venues to their own ticket sites.
4. Cache sources independently with last-success timestamps and coverage dates. A failure at one chain must not erase all cinemas. Distinguish a healthy zero-match schedule from an HTTP/schema failure, retain valid prior data with a stale state, remove past sessions, and expire the mall's today-only data at Madrid midnight.
5. Observe Cinesa bootstrap across a real token expiry and check a programme/date rollover before enabling the adapter in production. Alert on repeated collection failures and avoid publishing stale snapshots as newly refreshed data.

No shared checkout, ticket/seat selection, Telegram alerts, KV writes or production refreshes were exercised during this research. The availability audit used GET requests plus Splau's initial cinema/session navigation POST; no scheduled availability polling has been deployed.


## Local preview expansion and poster fallback — 19 November 2026

The preview now collects **all VOSE rooms** at the eight selected cinemas. Source adapters retain their original premium-only mode for the research CLI and tests; the preview opts into all rooms and emits a `big_screen` flag using the original predicates. Phenomena is VOSE-only in this page. The expanded snapshot contains **872 sessions in 107 film entries**. Its **370 big-screen sessions** exactly equal the previous snapshot’s VOSE subset. Search accepts `big screens only`, alone or combined with a film/cinema/format query. Splau now contributes 166 sessions from 19 November; 42 retain the original Atmos/Laser ULTRA designation.

Source film IDs and explicit reviewed links combine cross-cinema variants. The duplicate audit joined Wild Horse Nine, Club Kid, Scrooge, Heart of the Beast, Focker In-Law and the relevant Dune adaptations. Dune (1984), Dune (2021) and the double bill remain distinct. Every session ID and original provider metadata is preserved.

`scripts/poster_fallbacks.py` now runs after cinema-poster selection. For missing or sub-target images it queries the public IMDb suggestion feed, verifies an exact IMDb ID or an unambiguous exact title and known release year, then downloads and decodes the returned image from IMDb’s Amazon media host. Source IMDb identifiers, reviewed mappings in `scripts/poster_identities.json`, and match provenance are retained. No API key or browser login is needed in the verified local run. This is an observed public endpoint, not a documented service guarantee.

The initial fallback run upgraded 27 posters. After deduplication, 75 of 107 film entries clear the 600 × 900 portrait target. Unresolved event identities, two insufficient replacements and an oversized image rejected by the decoder retain their cinema artwork. Review candidates, failures and cached image dimensions are recorded in the ignored `static/preview-data/posters/fallbacks.json`. A failed fallback never removes showtimes; valid previous replacements are retained with their original timestamp. Cached successes are reused for seven days and unresolved lookups for one day. `npm run preview:posters` refreshes artwork without rescraping showtimes.

The first expanded background availability pass populated **all 823 supported sessions** with no errors. The 49 Yelmo sessions remain unknown. The UI only displays a seat total or “Sold out,” and the refresh age appears inline in the modal. Accessibility and seating-area breakdowns remain in the data but are not displayed.
