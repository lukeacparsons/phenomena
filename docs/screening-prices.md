# Prices collected with the programme

The catalogue now retains published admission prices from the programme responses it already reads. No ticket selection, seat reservation, basket or checkout requests were added.

The 19 November live refresh retained prices for **1,956 of 3,097 screenings (63%) across 20 venues**, up from 76 Phenomena screenings. This includes both individual admission amounts and explicitly labelled fare ranges. All 38 monitored venues passed health checks after the refresh and targeted Maldà/Institut updates.

| Source | Price evidence retained |
|---|---|
| Mooby's six cinemas | Exact performance's `data.tickets.prices`, converted from integer euro cents; unnamed ticket types remain a labelled range |
| Verdi, Verdi Park and Girona | The same A1 performance price array, joined by the existing session identity |
| Sant Cugat Cinemas, Montcada, Can Castellet | A1 prices only when theatre, event, performance ID and date/time match the booking listing |
| Filmax | Each `ScreeningEvent`'s EUR `AggregateOffer`; low/high prices remain a range |
| Texas | The exact booking page's named `GENERAL` fare, with other ticket labels retained as options; zero-priced annual passes do not make the screening free |
| Filmoteca | The containing programme group's published `preu`, explicitly scoped to that programme; zero is accepted only with an explicit free-admission screening label |
| Institut Français | The event's dedicated price block: general admission, concessions and pack conditions kept separately |
| CaixaForum | The matched event's structured EUR admission offer, excluding unrelated exhibition prices in the footer |
| Casa Elizalde | Explicit free admission and reservation conditions in the verified cinema event |
| Maldà | Explicit `Preu`/`Precio` and free-admission notices within an individual timed entry or dated film card |
| Phenomena | Existing published film/event price, now with structured provenance |

## Meaning and display

`price_data` carries `currency`, `kind`, `scope`, `source_url`, `checked_at`, and either one `amount` or `minimum`/`maximum`. Named ticket `options` and `conditions` are retained when published. `fees: unknown` means the programme did not establish the final booking fee. Acquisition timestamps come from that provider's collection receipt, not a later page build or metadata update.

Each accepted programme now also appends a timestamped price sample to the private [observation history](observation-history.md). Repeated prices share one stored payload while retaining every collection timestamp. History survives replacement of the current catalogue and expiry of the screening.

The old `price_eur` field is retained internally for a single published amount. It is **not** populated with the cheapest fare in a range. Screening prices are kept in the crawler's source snapshot and excluded from the browser projection, generated screening HTML and WebMCP responses. Showtime details display the room and seat availability. General venue tariffs are separate directory research and are not automatically applied to every screening.

For the A1 minor-unit conversion, 15 exact Verdi session IDs were cross-checked against the operator's structured HTML prices: for example, API `600` matches published EUR `6.00`. Mixed, malformed or zero-placeholder price arrays are rejected rather than interpreted as ordinary admission.

## Current gaps

The sampled Cinesa and Kinépolis programme responses do not expose price fields. Their booking flows need separate investigation if exact admission and fees are wanted. Yelmo, Renoir, CineBaix, Capri and OCINE likewise have no integrated session-price adapter. Some of their general tariffs already appear in cinema profiles.

Zumzeig's event list exposes an event-level “from” amount but also sets `showPrecioDesde: false`; sampled dedicated session responses had no price. This hidden event field is not published as a screening quote. External festival ticket channels may use different tariffs.

Free Filmoteca entries without an explicit free-admission label remain unpriced even when the API has a zero. Unnamed discounted/member fares remain ranges, not standard adult prices. No final checkout total is claimed.

## Robustness and verification

Price parsing is optional: absent or unsupported fields leave schedules intact. Tests cover euro-cent conversion, malformed/zero data, foreign currencies, concession versus general admission, passes versus free entry, exact performance joins, source timestamps, compact browser projection, localized ranges and WebMCP output.

The live scan also found that Maldà now publishes two consecutive weekly programmes on one page. The parser follows each explicit week heading and confines version/price evidence to each timed entry. A private hire or unmarked festival event cannot borrow the next film's original-version label or price. The previous outside-week rejection remains in force within each section.

Local evidence, sample captures, test output and the refresh log are in ignored `output/pricing/`.

Initial collection verification passed 288 Python tests and 36 JavaScript tests; the final Institut single-price variation also passed the targeted pricing suite. The compact-browser contract check passed 666 searches. Subsequent frontend checks require prices to remain in the source snapshot while being absent from the browser projection and WebMCP responses. The managed collector continues collecting prices internally.
