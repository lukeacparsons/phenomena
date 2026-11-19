# Original-audio catalogue integration

Implemented 19 November 2026 in the local VO BARNA preview. Run `npm run preview:refresh`; the generated `static/preview-data/screenings.json` records the collection time, per-source coverage, screening identities and version evidence. No production refresh or deployment is involved.

## Language rule

`scripts/original_audio.py` qualifies screenings using an explicit original-version label (VO, VOSE, VOSC, VOSI and source equivalents), or a verified match between screening audio and the film's original language. Explicit dubbing or conflicting known audio/original languages reject a screening. Spanish and Catalan originals are eligible. Subtitle language is separate from audio: VOSE does not imply English, and a VO label with no subtitle information does not prove subtitles are absent.

Unmarked Spanish-language sessions are not automatically original. The A1 feeds provide original-language metadata; cross-provider matching uses only an exact, non-conflicting IMDb identity. Internal ticket-system IDs and translated-title guesses are not used for this purpose. Every accepted row retains `original_audio`, `source_version` and `original_audio_evidence`.

## Sources and coverage

| Source | Integrated programme | Important constraint |
| --- | --- | --- |
| Mooby | Balmes, Bosque, Aribau, Arenas, Glòries, Gran Sarrià; published sessions in every room | Original labels or screening audio matched to exact-ID original-language evidence |
| Cinesa | Diagonal Mar, La Farga, Diagonal, SOM Multiespai, Barnasud; all advertised dates | Original-version attributes required; unmarked Spanish sessions remain excluded |
| Yelmo | La Maquinista, Castelldefels and Sant Cugat, including published advance sessions | Original-version variant required; a bare Spanish label is insufficient |
| Kinépolis | Splau, current and advance sessions | Screening audio must match original audio; Spanish subtitles are no longer required |
| Phenomena | Published programme | Explicit original-version label required; unmarked titles remain excluded |
| Verdi / Verdi Park | Shared A1 programme, split by each performance's booking-room label | Rooms 1–5 are Verdi; A–D V.Park are Verdi Park. Unknown rooms are excluded, never duplicated between entrances |
| Girona | A1 programme and verified booking rooms | Film-level original language cannot qualify a screening without version/audio evidence |
| Renoir Floridablanca | Every advertised programme date | Original-version label is parsed per film card; mobile duplicates are ignored |
| Filmoteca | Euromus bookable programme | Explicit VO/VOSE/VOSC labels qualify. VE/VC identify audio language and can mean dubbed versions, so are excluded. Free or other screenings absent from the booking feed are not yet covered |
| Zumzeig | Full official programme index joined to Codetickets event IDs or exact festival ticket URLs | Original version comes from the official film page. Festival sessions also require the booking feed to identify Zumzeig as the venue |
| Texas | Official cinema calendar joined to Koobin performance pages | Actual date/time must agree; midnight in a booking URL is not used as the screening time. Theatre performances are excluded |
| Maldà | Weekly programme plus dated homepage film cards, including advance screenings beyond that week | Dates use the published programme year, including year rollover. Duplicate slots are reconciled; untimed announcements are excluded. Original versions only; box-office booking with unknown availability |
| Filmax Gran Via | Film index and structured screening events | Session `inLanguage` is checked against exact-ID original-language evidence; film nationality does not prove original audio |
| Ateneu Barcelonès | Cinema-category agenda monitor | No future entries found. A new event needs version and public-admission verification before import |
| CineBaix | Official weekly programme | Version and date parsed separately for each screening; VOE/VOC originals qualify, DOE/DOC dubbing does not |
| Sant Cugat Cinemas, Montcada, Can Castellet | Official Online Cinema Tickets catalogues, including advance bookings | Explicit film-variant labels qualify. Optional editorial metadata can prove native originals only for the exact theatre, event and performance |
| Cinema Capri | Municipal venue agenda | Exact dates and version evidence required; a reviewed original-language record supports the December Ernest Cole screening. Untimed/range announcements remain excluded |
| OCINE Màgic Badalona | Current, release and advance booking sections, joined to film variants | The parent film's VO attribute is not inherited by dubbed variants; the API's bare `versio: O` is not evidence of original audio |
| Institut Français | Official cinema agenda, with official Ohlalà festival fallback | Venue, time and original-version proof required. Festival fallback is explicitly partial coverage |
| Casa Elizalde | Permanent cinema programme and individual dated pages | Double bills with consistent original-version labels qualify; performance/workshop events excluded |
| CaixaForum Barcelona | Activity/cycle indexes and dated film pages | Barcelona venue required. Multi-day date ranges are not expanded into invented daily sessions |
| CCCB/Xcèntric, Albareda, Can Carol | Permanent programme links and discovery monitors | No showtimes imported while original audio or exact film start time remains unverified |

Sources without a reliable shared film identity retain separate entries. In particular, Filmoteca's booking identifiers describe performances, not a global film catalogue: matching an old film to IMDb by its title alone would risk attaching the wrong film or combining a double bill. Such entries can have repeated titles until an authoritative identity mapping is available.

## Availability and artwork

Existing availability adapters are reused for all configured Mooby/Cinesa venues and for Verdi/Verdi Park and Filmax's compatible Admit One pages. Filmoteca carries the nested **per-session** `hihaPlaces`, never the programme-group total. Zumzeig uses the dedicated sessions endpoint for available counts and honors `showDisponibles`; event-list placeholder zeroes and externally sold festival counts remain unknown. Both sources timestamp those counts at catalogue refresh time. Other new ticket providers currently have unknown availability, as described in the README.

Posters come from verified source links and explicitly allowed image hosts. Artwork or enrichment failures do not discard screening times. Version metadata is cached for six hours and A1 room identities for 24 hours. Each cinema is validated and published independently: failures preserve that cinema's last valid rows and collection timestamp while successful cinemas update. Excluded ambiguous versions and unresolved rooms are recorded in coverage where supported. The [crawler watchdog](crawler-robustness-audit.md) alerts when collection timestamps become stale.

## Verification

`scripts/test_original_catalogues.py` checks original Spanish versus dubbed Spanish, subtitle independence, conflicting language evidence, A1 room routing, Filmoteca's language codes and room identities, Zumzeig's full-index discovery and placeholder counts, Renoir responsive duplicates, Texas calendar/booking agreement, Maldà dates, and Filmax's session-language checks. Existing collector, cache, identity, search and browser-service checks run through `npm test`.

Endpoint discovery and observed limitations: [booking research](barcelona-cinema-booking-research.md). Follow-up [regular-screening audit](regular-screening-venues.md) distinguishes recurring cultural/civic programmes, active nearby cinemas and seasonal hosts. These are public website interfaces rather than guaranteed partner APIs; their structure is validated during collection.

The [nearby/cultural integration](nearby-cultural-integration.md) adds nine nearby cinemas and six cultural programmes. `scripts/test_nearby_catalogues.py` checks malformed booking tables, exact venue/performance identity, native Spanish proof, OCINE variant isolation, cultural date/venue boundaries, and preservation of unrelated sessions during `npm run preview:nearby`.
