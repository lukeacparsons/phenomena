# Screening times and availability: expansion research

Investigated **19 November 2026**. Scope: the **13 missing permanent Barcelona cinemas**, plus **Filmax Gran Via** and **Ateneu Barcelonès**. This follows the [venue inventory](barcelona-cinema-inventory.md). The [structured research](barcelona-cinema-booking-research.json) contains request methods, parameters, venue IDs, dated samples and source hashes.

**Twelve of these 15 venues expose remaining-place counts or seat states in the sampled booking sources.** Screening times are retrievable for all 14 permanent cinemas. Ateneu has a working event feed, but its film-screening filter returned only past events. These are verified source capabilities, not completed or deployed collectors. Samples include different language versions; the product's VOSE filter is a separate step.

## Coverage and implementation route

| Venue | Screening times | Availability established | Work needed |
| --- | --- | --- | --- |
| Mooby Arenas | Existing `window.shops`, shop 24 / BAL-ARENAS | Admit One seat map; sample 191 ordinary seats | Extend existing Mooby venue configuration |
| Mooby Glòries | Same feed, shop 25 / BAL-GLORIAS | Sample 95 ordinary seats | Same adapter |
| Mooby Gran Sarrià Club | Same feed, shop 26 / BAL-SARRIA | Sample 18 ordinary seats | Same adapter |
| Cinesa Diagonal | Existing Vista API, site 012 | Layout + availability API; sample 132 ordinary, 2 wheelchair, 1 companion | Add venue and remove hardcoded availability fallback |
| Cinesa SOM Multiespai | Same API, site 017 | Sample 370 ordinary, 4 wheelchair, 2 companion | Same adapter changes |
| Cinemes Verdi | A1 programme JSON; booking page supplies auditorium | Sample Sala 1: 302 ordinary seats | New A1 schedule parser; reuse Admit One seat parsing |
| Verdi Park | Same programme, separately identified by booking-room label | Sample Sala A V.Park: 104 ordinary seats | Cache per-session room and venue mapping |
| Cinemes Girona | A1 programme JSON; booking page supplies room | Ticket-type selection verified; remaining count **unresolved** | Schedule integration possible independently |
| Renoir Floridablanca | Dated official HTML and Pillalas session links | Seat states in booking HTML; sample 107 ordinary, 2 accessibility places, 3 unavailable | New HTML schedule and Pillalas seat adapters |
| Zumzeig | Codetickets event discovery + session JSON | Explicit remaining count and seat map; sample 63 total = 57 normal + 6 mobility-area places | New Codetickets adapter; enrich language from cinema site |
| Filmoteca | Euromus bulk programme + official agenda | Explicit per-session remaining count; sample Chomón 318, Laya 173 | New Euromus adapter; join official language labels |
| Espai Texas | Cinema calendar and Koobin session metadata | Layout plus separate occupancy updates; samples 157 and 45 selectable seats | New Koobin adapter with state-update handling |
| Cinema Maldà | Weekly day-by-day text | **Box-office-only**; no online remaining count found | Editorial schedule parser; availability stays unknown |
| Filmax Gran Via | Film-page JSON-LD and accessible HTML | Admit One map; sample Sala 12: 108 ordinary seats | New schedule parser; reuse seat parsing |
| Ateneu Barcelonès | WordPress event-filter JSON | **Event-specific, unverified**; no upcoming classified screening found | Cultural-event collector, admission rules per event |

These numbers are **dated observations for individual sessions**, not venue-wide availability or permanent capacities. The JSON records each session and acquisition time. Counts can change immediately.

## Reusing the current collectors

The [Mooby website](https://www.moobycinemas.com/aribau) embeds all six shops in `window.shops`. Each event has version, original language and subtitle fields; performances include date/time, `performance_code`, `hall_code` and `hall_name`. The three missing cinemas are already in this payload. Their session-specific booking links returned the same `GlobalPerfID`, `GlobalColumnData` and `GlobalSeatTypeCodes` structure used by [premium_availability.py](../scripts/premium_availability.py).

Extend the hardcoded shop list in [explore_premium_showtimes.py](../scripts/explore_premium_showtimes.py), keeping the existing rules for ordinary versus accessibility/flagged seats. The programme's `data.available=false` does **not** mean sold out: this value coexists with available seats in booking maps.

Cinesa uses the current [anonymous website bootstrap](https://www.cinesa.es/api/omnia/v1/initialData) and Vista routes already implemented in [cinesa_showtimes.py](../scripts/cinesa_showtimes.py):

```text
GET /ocapi/v1/film-screening-dates?siteIds={012|017}
GET /ocapi/v1/showtimes/by-business-date/{YYYY-MM-DD}?siteIds={site}
GET /ocapi/v1/showtimes/{site-session}/seat-layout?siteIds={site}
GET /ocapi/v1/showtimes/{site-session}/seat-availability?siteIds={site}
```

The base is `https://vwc.cinesa.es/WSVistaWebClient`; requests use the fresh public anonymous bearer token. Both new sites passed the existing seat adapter with an explicitly configured client, including screen-ID validation. The availability module currently maps every cinema other than La Farga to Diagonal Mar in **two places**. Replace those fallbacks with explicit venue configuration before integrating these sites. Also keep “big screens” eligibility separate: setting a new venue's `requires_premium_format=false` currently makes every room qualify.

## Verdi, Verdi Park and Girona

[Verdi](https://barcelona.cines-verdi.com/api/get-events) and [Girona](https://www.cinemesgirona.cat/api/get-events) both expose `/api/get-events` and `/api/get-theaters`. Programme responses use `result[]`, with `performances[].code` as the booking identifier and `time` as a 12-digit local timestamp. Their theatre identities are `46 / VERDIBCN` and `31 / GIRONA`. The internal numeric performance `id` is different from the booking `code`.

The programme does not include auditoriums, but **Verdi's booking HTML resolves the earlier venue-mapping gap**. Sample links returned `Sala 1`, `Sala 4` and `Sala A V.Park`, alongside their seat maps. This agrees with the [operator's room descriptions](https://barcelona.cines-verdi.com/sales): numbered rooms at Verdi and lettered rooms at Verdi Park. Fetch and cache the room for each new performance; do not infer the entrance from the film, time or shared theatre ID. Unknown/new room labels should remain unresolved until checked.

```text
https://verdibcn.admit-one.eu/?p=tickets&s=VERDIBCN&perfCode={code}&language=esp
https://girona.admit-one.eu/?p=tickets&perfCode={code}&language=esp
```

Verdi's seat layout uses the existing Admit One structure. A sample whose programme reported `data.available=false` had 104 available seats. Hidden generic messages such as “Tickets Not Yet Available” also occur in the booking HTML's reusable dialogs; searching the whole document for such text would produce false closure results.

Girona's sampled performance `41266` displayed its date, time, **SALA 02** and ticket types, with quantity choices 0–10. No seat map or remaining inventory appeared before ticket selection. **Ten is the per-order limit, not remaining availability.** Keep its count unknown. Its programme is still suitable for showtime collection. Validate source IMDb IDs before joining film metadata; some supplied values resemble internal event codes.

## Renoir Floridablanca

The [official programme](https://www.cinesrenoir.com/cine/renoir-floridablanca/cartelera/) supports `?fecha=YYYY-MM-DD`. Traverse its advertised dates, parse room/version/time, and deduplicate repeated responsive markup by session booking URL. The earlier capture contained 17 distinct timed links repeated in 51 anchors.

The [sample Pillalas page](https://www.pillalas.com/pase/barcelona/renoir-floridablanca/el-director/1097178/) contains seat buttons directly in HTML:

```text
[data-seat-id][data-state="normal"]       ordinary available
[data-seat-id][data-state="vendida"]      unavailable
[data-seat-id][data-state="minusvalido"]  accessibility place
```

The direct capture and rendered browser agreed on 107 / 3 / 2 respectively, with zero tickets selected. No additional XHR was needed to obtain those states. Verify the page's session, room and date before accepting counts, and treat new state values as a parser change rather than assuming availability.

## Zumzeig: a useful public JSON source

The [cinema's film pages](https://zumzeigcine.coop/cinema/films/rose/) provide language/version and ticket links. The [Codetickets portal](https://www.codetickets.com/portal/zumzeigcooperativa/online) uses entity **349**, channel **1602**. Observed public requests:

```text
GET https://api.codetickets.com/api/entidad/zumzeigcooperativa
GET https://api.codetickets.com/api/evento/349/1602/eventos?lang=ca_ES
GET https://api.codetickets.com/api/evento/349/1602/{event}/sesiones?lang=ca_ES
```

Discovery returned 27 events and 52 nested session summaries. The separate Rose session endpoint returned **nine dated sessions through 3 December**, compared with three ticket dates on the sampled cinema film page. Use the portal to discover the full published booking horizon, and the cinema site for editorial metadata and language.

**Do not read availability from the event-list summaries.** Its Rose session `105076` has `disponibles=0`, even with `showDisponibles=true`. The dedicated sessions endpoint, session detail, seat response and visible booking UI instead agree on **63**. Use `/sesiones` or the session-detail response for counts.

For deeper inspection, the browser makes read-only JSON POST requests with `{"userId":""}` to:

```text
/api/evento/349/1602/{event}/{session}?lang=ca_ES
/api/evento/349/1602/{event}/{session}/zonasprecios?lang=ca_ES
/api/evento/349/1602/{event}/{session}/zonas/{zone}/butacas?lang=ca_ES
```

For Rose, event `38184`, session `105076`, zone `546`, the map contained 57 free normal-area places and six free mobility-area places. The reported total is therefore not the ordinary-seat count. Other numeric seat states need complete interpretation before exposing a detailed map. No browser login or bearer token was needed for these observed requests.

Three events override `urlComprar` to festival ticket channels. Preserve those destinations and leave their availability unknown until that channel is checked.

## Filmoteca: bulk dates and remaining places

Film pages in the [official agenda](https://www.filmoteca.cat/web/ca/view-agenda-setmanal) link to Euromus with activity and cycle IDs. The booking site reads its programme with:

```text
POST https://euromus.cultura.gencat.cat/filmoteca/ActionServletJson
Content-Type: application/x-www-form-urlencoded

elem=activitatsNou
codiMuseu=FILMOTECA
property=FILMOTECA
codiActiv=
codiCombi=
codiCicle=
grupActiv=
dataVisita=
lang=1
```

Leaving the filters empty returned **21 programme groups and 136 distinct screenings**, from 19 November through 31 December 2026: 68 in Chomón and 68 in Laya. Each nested `cicle[]` row includes title, date, start/end time, room and `hihaPlaces`. A filtered [Chomón sample](https://euromus.cultura.gencat.cat/filmoteca/venda/index.jsp?lang=1&nom_cache=FILMOTECA&property=FILMOTECA&codiActiv=1025&codiCicle=10) returned 318 places; a Laya sample returned 173.

Use **nested per-session `hihaPlaces`**, not the top-level programme total. `capacidad=10` is also not the remaining count. Room identity must include `codiRecinte`: both halls can have `codiSala=1`. Store the activity ID, cycle/session ID, date and time together.

This is online sale inventory. Reconcile it with the official agenda so a screening remains visible when booking closes, is unavailable online, or is handled differently. Preserve the website's explicit version labels; the numeric booking `codiIdioma` values have not been mapped. Film pages can also contain old screenings, so filter on actual session dates. The observed counts have not been separated into ordinary and accessibility places.

## Texas, Maldà and Ateneu

**Texas:** the [cinema calendar](https://espaitexas.cat/cartellera-cinema/) has `day_YYYY-MM-DD` containers, film links and displayed times. Use these dates/times rather than interpreting the URL: some booking slugs end in `0000` for screenings that are not at midnight. Koobin session pages add an explicit event ID, timestamp and room, such as **CINE: SALA 1**.

The page requests its map using a read-only POST to `https://espaitexas.koobin.cat/widget/` with `action=aforo_evento`, plus fresh `trans_id` and `pid` values from that same anonymous session. The response has **HTML, CSS and JavaScript state updates**. In the [Human Scale sample](https://espaitexas.koobin.cat/ca/the-human-scale-vose-20261123-1900), initial HTML marked all 157 places available; the response then marked 112 unavailable, leaving **45**. Blue Heron's sample had 157 selectable places and no occupied-seat updates.

A collector must apply the recognized updates, handle accessibility/package/reserved/inactive states, and fail on unexpected syntax. It should parse data rather than execute arbitrary downloaded JavaScript. Direct HTTP replay worked; isolated headless Chrome received a WAF-403. Preserve previous data and report unknown on transport failures. No ticket-selection or cart-add action is needed for the successful map request. Keep film/theatre types and VOSE/VOSC distinct.

**Maldà:** the [day-by-day page](https://www.cinemamalda.com/cartelera-dia-a-dia/) contains parseable weekly dates and times, with the year/month in its programme heading. The [homepage](https://www.cinemamalda.com/) explicitly advertises box-office-only sales. No online count source was found. Undated “coming soon” cards are not sessions, and “minimum audience: five” is not inventory. One version label differed between pages (`VOSCAT` / `VOSCAST`); preserve that conflict for review.

**Ateneu:** the [agenda](https://ateneubcn.cat/programacio/) exposes a public WordPress filter request:

```text
POST https://ateneubcn.cat/wp-admin/admin-ajax.php
action=get_activities_filter
nonce={fresh PT_Ajax.nonce from the agenda}
filters=tipus-1174
```

The film-screening type `tipus-1174` returned 12 events, all historical; the latest was **21 November 2025**. Fields include start time, room, event URL and `campos_activitat_exclusiu_socis`. The cinema-section filter is `seccio-9529`, which can include activities other than screenings. A collector can use this feed, but must retain dates and check each event's public access and reservation conditions. No upcoming screening or availability-count endpoint was established.

## Filmax Gran Via

Filmax has an [accessible film index](https://cinesfilmax.com/wai) and readable [session lists](https://cinesfilmax.com/wai/el-director). Its main [film page](https://cinesfilmax.com/el-director) contains JSON-LD `@graph` entries of type `ScreeningEvent`, with ISO timestamps, language, format and booking URLs. The sample had eight events matching eight distinct ticket links.

Follow those links to `filmax.admit-one.eu`: the same seat-map structure is present. Performance `222679` returned **Sala 12**, 21 November at 17:00, and 108 ordinary available seats. This is a verified reuse opportunity for the seat parser, while the schedule needs its own JSON-LD/HTML collector. Generic `schema.org/InStock` metadata must not substitute for a count or validated sold-out status. Filmax remains an L’Hospitalet entry.

## Implementation order and acceptance checks

1. **Extend Mooby and Cinesa** for the five missing chain venues; configure availability and premium eligibility explicitly.
2. **Add Verdi/Verdi Park, Renoir, Zumzeig and Filmoteca**, using the verified booking sources above. Resolve and cache Verdi room identities as part of schedule enrichment.
3. **Add Girona and Maldà schedules with unknown counts**, and implement Texas's additional occupancy-state parsing. Add Filmax through its JSON-LD and shared seat parser.
4. **Add Ateneu as an event source** when there is a qualifying dated screening; keep its admission rules with each event.

Use separate refresh paths for programme discovery and availability. A reasonable starting policy is programme refresh every 4–6 hours and availability every 15 minutes, with per-provider sequential requests, cached static layouts, backoff and the existing stale-data behavior. Bulk Filmoteca and Zumzeig requests can avoid one request per session. Refresh far-future counts less often; a count needs its acquisition time.

Before integration, check a second session/date per adapter, language handling, session/room identity, repeated markup, sale-closed and empty responses, and changed schemas. Keep `unknown`, `sales closed`, `no online stock`, and `available` distinct. Missing data, a request failure, a booking cap or an unverified zero must not become “sold out.” Preserve the original source facts for ordinary, wheelchair, companion and reported-total counts.

No tickets or seats were selected, no holds were requested, and no checkout was submitted. Only programme/layout reads were performed. Some booking pages initialize an empty anonymous basket as part of normal navigation. The research files omit anonymous session tokens and personal credentials. The live directory, programme collectors and production deployment remain unchanged.
