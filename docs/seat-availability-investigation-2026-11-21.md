# Seat availability: deeper booking-source investigation

Investigated **21 November 2026**. The initial pass returned valid live counts for **219 previously uncovered screenings across six cinemas**. The follow-up adds **88 Yelmo screenings across all three cinemas and two verified Girona sold-out observations**, for **309 newly readable screenings across ten cinemas**. The adapters are integrated into the collector; production observations refresh independently of these investigation results. Counts are dated observations, not booking guarantees.

| Cinema / source | Live checks passed | What was missing |
| --- | ---: | --- |
| Renoir Floridablanca | 123 | Seat states are in Pillalas HTML; no ticket selection is needed. |
| Espai Texas | 35 | The initial map must be combined with the response's occupancy updates. |
| OCINE Màgic | 15 | The existing film-detail API already includes per-performance remaining counts. |
| Institut Français, OH LÀ LÀ festival | 10 | Codetickets bookable-zone counts are available even when `showDisponibles` is false. |
| Verdi and Verdi Park | 36 combined | Ticket-only / unallocated pages still embed complete inventory in `jsSectionData`. |
| Yelmo Maquinista / Castelldefels / Sant Cugat | 50 / 24 / 14 | Map requires an anonymous fare basket, cancelled without seat allocation; proxy rotation resolves direct-route failures. |
| Cinemes Girona | 2 | Official sold-out flags corroborated by the exact booking pages; positive counts unresolved. |

The [structured receipt](seat-availability-investigation-2026-11-21.json) records per-cinema totals, acquisition windows, sample session URLs, count meanings, zero-count cases, transport verification and fixture hashes. All 219 applicable screenings from the initial pass passed its final live checks. One further Institut Français screening uses Eventbrite and remains unsupported; this does not stop collection of its festival screenings. Verdi verification specifically selected upcoming IDs absent from the existing availability cache. All 88 Yelmo screenings in the audited programme now have verified counts after resolving fare variants and testing the proxy pool.

## Verified collection paths

### Renoir

GET the exact [Pillalas screening URL](https://www.pillalas.com/pase/barcelona/renoir-floridablanca/wild-horse-nine/1097239/). Deduplicate `data-seat-id`, count `data-state="normal"`, retain `minusvalido` separately, and exclude `vendida`. Validate canonical session URL, room, date and time. An empty or unrecognized map is not zero.

The browser-like HTTP client initially received English labels on the unprefixed URL. Explicit `Accept-Language: es-ES,es;q=0.9` supplies the Spanish date/room labels validated by the parser. The final run passed all 123 screenings in seven rooms, including a genuine zero ordinary-seat result. Captured example: 161 ordinary and two wheelchair places.

### Texas

GET the exact [Koobin screening](https://espaitexas.koobin.cat/ca/the-human-scale-vose-20261123-1900), validate event ID, timestamp and cinema room, then POST `action=aforo_evento` with that anonymous page's fresh `trans_id` and `pid` to `/widget/`. No ticket or seat selection is required.

The returned HTML initially marks every place available. Its separate JavaScript applies sold/occupied, inactive, reserved and package states. The parser accepts only reviewed update syntax and interprets it as data; it never executes downloaded JavaScript. Unknown selectors/statements or incomplete updates reject the observation.

The captured Human Scale response contains 157 initial places, of which 115 are marked unavailable, leaving **42**. The second-room sample has 83 initial places minus three unavailable, leaving **80**. These are selectable-place totals without a verified accessibility breakdown, stored as `reported_total`. All 35 upcoming screenings in both rooms passed.

### OCINE Màgic

GET `/api/v1/pelicula/{film_id}?lang=ca` on [the official ticket site](https://tickets.ocinemagic.es/). Inspect the exact `subPelicules[].sessions[]` entry using `planificacio`, variant ID, local date/time and room. Its `disponibles` is the remaining total; `totals` is capacity. Reuse a single acquired film response for all its performances during a refresh, preserving that acquisition timestamp.

The independent `/api/v1/aforament` map verified the meaning of two film totals. Performance 178397 had **395 remaining = 393 ordinary + two accessibility places**; performance 174723 had **278 = 276 + two**. The production adapter therefore stores `reported_total`, and only uses the film GET. It does not need the empty anonymous session initialization used for that cross-check. All 15 current original-audio performances passed, across four rooms and multiple dates.

### Institut Français festival

The [OH LÀ LÀ Codetickets channel](https://www.codetickets.com/portal/oh-la-la-festival/online/38148/102656) resolves to entity 522 / channel 2430. Read-only POST requests with `{"userId":""}` return session detail and `/zonasprecios`. Validate exact session ID, timestamp and `recinto="Institut français"`, then sum each unique bookable zone once.

**Do not use the general session total for this channel.** Session 102656 reports 240 at session level but **213** in its bookable zone, matching 213 free seat records. Session 102663 reports 229 at session level but **197** in the zone, matching its free seats. There are also occupied, temporarily held and excluded seat states. The adapter uses the explicit zone counts as `area_counts`; it does not reinterpret the seat symbols or infer accessibility from the SVG field named `minus`.

`showDisponibles=false` controls display of the general total; it does not mean the seat map is unavailable. Other ticket channels remain unknown until verified, including the Eventbrite WALLAY! screening.

### Verdi / Verdi Park: corrected assumption

The previous collector treated `GlobalUnallocatedPerformance=true` as proof that no public count existed. The new pass found an active `jsSectionData = [...]` JSON assignment on these [ticket pages](https://verdibcn.admit-one.eu/?p=tickets&s=VERDIBCN&perfCode=222700&language=esp), alongside a commented duplicate which must be ignored.

Each section provides `seatTypes`, `seatdata`, `availableSeats`, `soldSeats`, `totalSeats` and eligible ticket categories. Performance 222700 reports **302 remaining + 13 sold = 315 total**, agreeing with 302 true and 13 false seat-availability flags. Performance 222720 reports **218 remaining of 218**, also agreeing with the records.

The fallback validates the performance ID, unique section/seat identities, empty selected-ticket/seat counts, exact boolean states, and agreement between totals and seat records. It counts each eligible seat category once, never once per fare. Missing inventory still remains unknown. All 36 previously missing upcoming Verdi/Verdi Park screenings passed this fallback.

### Yelmo: Maquinista, Castelldefels and Sant Cugat

The public [Yelmo purchase application](https://compra.yelmocines.es/) calls `https://api-compra.yelmocines.es/api/`. Its `schedule` response supplies the exact cinema, film, room and local screening time. `tickets` creates an anonymous session and returns fares by seating area. Empty or zero-quantity attempts do not return usable inventory: a successful HTTP status alone is insufficient.

The normal `seats` request requires one public fare with `addTickets=true`. Reviewed fare types are `adulto`, `general-evento`, `adulto-evento` and `miercoles`, with no membership recognition, voucher, package or minimum group requirement. Youth and restricted fares do not qualify. This returns a complete map with `seats_allocated=false`, `seats_allocated_count=0`, `selected_seats=[]` and one fare still awaiting allocation. The adapter never calls `seats/set` or payment. In a `finally` block it calls `order/cancel`, including after malformed responses and timeouts. Cancellation failure retries once, rejects the observation and prevents opening another basket. Later cleanup attempts respect the persisted cooldown, including when closing or restarting the fetcher.

Only `Empty` positions in the reviewed public-fare areas count as ordinary availability. `Sold`, `Reserved`, `Broken` and `House` are excluded. `Special` and its linked `7` places are excluded rather than guessing accessibility subtypes. The UI's source explicitly separates special-needs places; [Vista's seating documentation](https://developer.vista.co/digital-platform/seating) also distinguishes ordinary, wheelchair and companion places. Unknown states, duplicate/out-of-range positions, missing areas, mismatched identities and unexpected allocations fail validation.

Captured samples: **472 ordinary** at Maquinista performance 48642; **64 ordinary** at Castelldefels 30895 (five broken and two special/linked places excluded); **88 ordinary** at Sant Cugat 25564 (26 sold, one broken and four special/linked places excluded). All three anonymous sample baskets were explicitly cancelled. Published room capacity is not used as the remaining count: broken seat records can remain in the map while being excluded from its capacity field.

The initial direct pass checked 88 upcoming screenings: **48 valid counts**, **14 unrecognized public fare variants**, and **26 HTTP 405 responses**. A diagnostic confirmed that `schedule` remained readable but `tickets` returned plain-text `Service Unavailable`, including for a performance whose fare page had worked earlier. Throttling is a possible explanation, not a confirmed diagnosis.

The existing private cinema proxy on **es-mad-wg-101** restored the same ticket-session and map calls from the collector server. A temporary independent **es-mad-wg-102** tunnel supplied a second verified exit IP, leaving the working Cinesa tunnel intact. The first 43-screening pool pass returned 35 counts and eight unrecognized Wednesday/adult-event fares, with **zero transport failures and 43 confirmed cancellations**. After validating those fare types, all eight rechecks returned counts and confirmed cancellation. Combined with the direct successes, coverage is **88 of 88**, including six zero ordinary-seat observations. This proves the tested reads and transport path, not indefinite immunity from throttling.

`scripts/yelmo_transport.py` rotates between complete screening checks, keeping schedule, fares, map and cancellation on the same route and anonymous session. It paces requests by two seconds plus jitter, tries at most two routes per screening, and persists per-route exponential cooldowns (15 minutes to six hours, plus jitter), honoring longer numeric or date-form `Retry-After`. HTTP 403/405/429, 5xx and network failures cool the affected route. A configured pool never silently falls back directly. An exclusive file lock and private atomic recovery file preserve the cursor, cooldowns and unfinished basket across restarts; cleanup must succeed on the original route before any new basket is created. Failed cleanup also backs off across screenings and restarts. Corrupt recovery state fails closed. [Runtime configuration and secondary-tunnel template](collector-server-deployment.md#provider-routes).

### Girona: verified sold-out observations, other counts unresolved

The official [programme API](https://www.cinemesgirona.cat/api/get-events) includes `performances[].data.available`. Despite its name, the official frontend interprets string values `"1"` and `"2"` as **sold out**. Boolean `false` is the absence of that warning, not a remaining count. Ticket prices and the 0–10 order selector are not inventory either.

For flagged performances, the adapter validates theatre 31, film ID, exact performance ID and time, then independently reads the [corresponding booking page](https://girona.admit-one.eu/?p=tickets&perfCode=41156&language=esp). It records zero only when that same page explicitly says the session is sold out. Promotion forms can repeat the same performance ID; conflicting IDs are rejected. The programme is fetched once per provider pass, and unflagged pages need no further request.

The live pass confirmed **two sold-out screenings in the current catalogue**, performances 41156 and 41268. The other **61 upcoming catalogue screenings remain unknown**, with no errors in the final pass. A third sold-out programme entry, 41155, was also checked manually but is outside this catalogue selection. The diagnostic next step for an ordinary performance went directly from quantity to payment details without a map or remaining count. No payment details were entered or submitted; its four-minute temporary checkout expired. The automated Girona adapter never advances beyond the initial booking page.

## Remaining gaps and specific findings

| Source | Result of this pass | Next useful step |
| --- | --- | --- |
| Girona | Sold-out flags now confirmed through the matching booking page and integrated as zero. The normal quantity step leads directly to payment, with no public remaining count in the inspected responses. | Find another explicit remaining-inventory source. Keep unflagged sessions unknown. |
| Sant Cugat Cinemas, Cinemes Montcada, Can Castellet | Same ticket-first barrier on their current official Admit One / onlinecinematickets links. The new Verdi inventory assignment is absent from these sampled legacy pages. | Continue at the later booking step without creating an inventory hold; do not assume the shared provider implies the same response format. |
| CineBaix | Read the official Taquilla81 programme and opened an empty session. The sampled unnumbered performance embeds a seat-state template but renders a ticket-quantity selector; no remaining count was established. | Inspect numbered performances or the programme's occupancy fields and verify their meaning. Do not treat this template as inventory. |
| Casa Elizalde | The 1 December film's official booking page explicitly says registration opens **24 November 2026**. Its session-calendar iframe returned empty content in this check. | Recheck after registration opens. Closed/not-yet-open reservations do not imply zero places. |
| Cinema Capri | The published 16 December municipal film page has its schedule but no session booking link or remaining count. | Follow the cinema's ticket channel when that performance opens. |
| CaixaForum | The current programme URL returned a Cloudflare block in the direct probe. | Inspect the reachable official booking flow; no conclusion about inventory availability. |
| Maldà | Earlier official evidence says box-office-only sales; no new online inventory source was established in this pass. | Keep unknown unless an official online source appears. |

## Integration and verification

`scripts/expanded_availability.py` supplies the new parsers and HTTP reads; `scripts/yelmo_availability.py` handles Yelmo's temporary basket and cleanup, and `scripts/yelmo_transport.py` handles its route pool and recovery state. `premium_availability.py` dispatches to them and reuses clients within a provider pass. `availability_cache.py` includes the six new provider keys in its existing 15-minute refresh cycle. The Admit One fallback also repairs missing counts within the already supported Verdi provider.

Existing sequential per-provider collection, bounded concurrency, failure backoff, timestamped stale values and observation-history persistence remain in effect. Browser visits do not trigger provider requests. Fixtures contain only public booking facts and normalized inventory, without cookies, anonymous session tokens or personal information.

Initial verification: **73 targeted Python tests and 11 WebMCP tests passed**, including 13 new tests covering captured responses, wrong identities, duplicated seats/zones, unknown states, inconsistent inventory, withheld/absent data, accessibility semantics, response locale, shared acquisition times and collector registration. That pass covered all 219 newly readable performances without ticket or seat selection. The Yelmo/Girona follow-up adds 26 regression tests for captured maps, strict sold-out handling, cancellation guarantees, route affinity, bounded failover, persistent backoff, recovery after restart and concurrent collectors. Targeted checks cover **40 availability tests, 12 transport tests, 14 observation-history tests, nine deployed-collector tests and 11 WebMCP tests**. The secondary-tunnel template passed Docker Compose validation. Live proxy checks used isolated code and data inside the collector container; they did not publish observations or deploy the adapters. All 51 pool-test baskets were explicitly cancelled, and the temporary tunnel was removed after verification.
