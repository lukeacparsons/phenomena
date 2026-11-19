# Barcelona cinema inventory

Researched **19 November 2026**. This is a directory and source-discovery audit; the live showtime collectors have not been expanded by this research.

The subsequent [booking-source investigation](barcelona-cinema-booking-research.md) establishes availability sources for 12 additions, resolves Verdi's entrance mapping through booking-room labels, and documents bulk Filmoteca and Zumzeig programme APIs. Consult it for the latest integration findings; the source-discovery observations below describe the earlier inventory pass.

**The working city inventory contains 20 permanent cinema venues, of which 13 are missing from our directory.** Our six existing Barcelona entries cover seven venues because Aribau Multicines and Aribau Cinema share one feed. La Farga and Splau are already covered outside the municipality.

Every entry on the user-supplied [English Cinema Barcelona list](https://englishcinemabarcelona.com/cinemas) is accounted for: **20 matched, six already integrated, 14 missing from the live directory**. The missing set comprises the 13 city venues below plus Filmax Gran Via in L’Hospitalet. That reference groups the two Aribau entrances together, lists Verdi and Verdi Park separately, and does not include our existing La Farga or Splau entries. Its English-only weekly totals should not determine whether a venue belongs in our broader directory.

Files:

- [Structured inventory](barcelona-cinema-inventory.json): addresses, aliases, existing IDs, verification stages, source links, every reference-page match, and supplemental candidates.
- [Source audit](barcelona-cinema-source-audit.json): observed provider IDs, programme counts, sample dates, source hashes and integration limitations.

The inventory was reconciled against current operator programmes, the [exhibitors’ association](https://gremicines.com/cinemes/) and a [municipality-based discovery directory](https://jaumepahissa.cat/cartellera). It is a well-supported working inventory of permanent cinemas, not a statutory census. The regional and cultural lists are explicitly broader discovery lists, with unresolved entries labelled accordingly.

## Missing permanent cinemas in Barcelona

All 13 have an official website/programme source. “Verified” below means the stated source was inspected, not that an importer has been implemented.

| Cinema | Location | Source discovery and remaining work |
| --- | --- | --- |
| **Zumzeig Cinecooperativa** | Béjar, 53 · Sants-Montjuïc | [Weekly agenda](https://zumzeigcine.coop/) and [film detail](https://zumzeigcine.coop/cinema/films/rose/) provide sessions, version and Codetickets links. The sample shows three VOSE screenings. Build a date-aware HTML collector and remove repeated agenda widgets. |
| **Cinema Maldà** | Pi, 5 · Ciutat Vella | [Official weekly programme](https://www.cinemamalda.com/) has explicit times and VOSE/VOE/VOSCAT labels. It states **tickets only at the box office**. Valid directory addition even without online booking or seat availability. |
| **Espai Texas / Cinemes Texas** | Bailèn, 205 · Gràcia | [Cinema-only programme](https://espaitexas.cat/cartellera-cinema/) links to Koobin. The [current venue has two cinema rooms](https://espaitexas.cat/qui-som/), plus theatre. Preserve Catalan subtitles and dubbed Catalan separately; the homepage mixes film and theatre. |
| **Filmoteca de Catalunya** | Salvador Seguí, 1 · Ciutat Vella | [Official programme](https://filmoteca.cat/web/ca) and film pages expose dates, rooms and version. [Sala Chomón and Sala Laya](https://www.filmoteca.cat/web/ca/article/seu-del-raval) belong to one venue. Current dates must be separated from historical cycle listings. |
| **Cinemes Verdi** | Verdi, 32 · Gràcia | Public [programme JSON](https://barcelona.cines-verdi.com/api/get-events), theatre identity and ticket templates verified. Room-to-venue mapping remains unresolved. |
| **Cinemes Verdi Park** | Torrijos, 49 · Gràcia | Shares Verdi’s programme endpoint but has an [independent entrance with no internal connection](https://barcelona.cines-verdi.com/on-som). Keep a separate directory record; never duplicate every shared-feed session into both venues. |
| **Renoir Floridablanca** | Floridablanca, 135 · Eixample | [Official HTML](https://www.cinesrenoir.com/cine/renoir-floridablanca/cartelera/) includes seven rooms, dates, session times, versions and Pillalas links. Its responsive markup repeats the same sessions three times. |
| **Cinemes Girona** | Girona, 175 · Eixample | [Official programme](https://www.cinemesgirona.cat/) and [public JSON](https://www.cinemesgirona.cat/api/get-events) verified. Shares the A1 website family with Verdi, but requires its own language mapping and film-ID validation. |
| **Mooby Arenas de Barcelona** | Gran Via, 385 · Eixample | Already present in the embedded Mooby feed, theatre **24**, code **BAL-ARENAS**. [Operator confirms 12 rooms](https://www.moobycinemas.com/sobre-arenas). Existing collector currently skips this shop. |
| **Mooby Glòries** | Diagonal, 208 · Sant Martí | Same feed, theatre **25**, code **BAL-GLORIAS**. [Operator confirms eight rooms](https://www.moobycinemas.com/sobre-glories). Preserve the provider’s GLORIAS spelling in source IDs. |
| **Mooby Gran Sarrià Club** | General Mitre, 38–44 · Sarrià-Sant Gervasi | Same feed, theatre **26**, code **BAL-SARRIA**. [Eight premium rooms](https://www.moobycinemas.com/sobre-sarria); comfort branding alone does not establish a giant screen or Atmos. |
| **Cinesa Diagonal** | Santa Fe de Nou Mèxic · Sarrià-Sant Gervasi | Public Vista site **012** verified, plus a successful VOSE sample using the existing client. [Municipal record](https://guia.barcelona.cat/ca/detall/cinesa-diagonal-c-ludic-diagonal_99180125327.html) gives number 18; provider gives s/n. Distinct from Diagonal Mar. |
| **Cinesa SOM Multiespai** | Passeig d’Andreu Nin · Nou Barris | Public Vista site **017** verified, plus a successful VOSE sample. [Shopping centre confirms 12 rooms](https://sommultiespai.com/ocio/cinesa/). Heron City is its historical name. |

The seven city venues already covered are Phenomena, Balmes, Bosque, Aribau Multicines (rooms 1–4, Aribau 8–10), Aribau Cinema (room 5, Aribau 5), Diagonal Mar and La Maquinista. Entrance mapping is documented in the existing [venue dossiers](cinema-dossiers.json).

## What the programme probes established

Mooby and A1 counts below include **all published sessions dated 19 November onward**, including elapsed times on that date. They are dated research observations, not current ticket or seat availability. Advance events create gaps: the latest date is not evidence of continuous programming.

| New source | Published VOSE sessions observed | Latest qualifying date in capture |
| --- | ---: | --- |
| Mooby Arenas | 134 | 24 December 2026 |
| Mooby Glòries | 118 | 24 December 2026 |
| Mooby Gran Sarrià Club | 84 | 5 May 2027 |
| Verdi + Verdi Park, combined feed | 190 | 18 December 2026 |
| Cinemes Girona | 38 | 23 February 2027 |
| Cinesa Diagonal | 4 in the **20 November sample only** | Full advertised calendar extends to 17 June 2027; full VOSE horizon not checked |
| Cinesa SOM Multiespai | 6 in the **20 November sample only** | Full advertised calendar extends to 30 December 2026; full VOSE horizon not checked |

The three additional Mooby cinemas expose **336 VOSE sessions** without needing a new provider. Their real programme room codes span 12, 8 and 8 rooms. The embedded shop field `n_screens` incorrectly says five for every Mooby shop in the capture; use the verified operator descriptions instead.

Verdi and Girona expose `/api/get-theaters` and `/api/get-events`, as used by their public JavaScript. Their theatre identities are `46 / VERDIBCN` and `31 / GIRONA`. Performances have a code and a 12-digit local timestamp. **No auditorium field was present in the sampled performance objects.** The JSON-LD on their homepages is useful supporting evidence but not a replacement for the full programme endpoint.

Two important A1 constraints remain: Verdi’s `V.O. SUB. CASTELLANO` label needs an explicit mapping; Girona’s apparent IMDb values can mirror internal event codes, so a `tt` prefix alone is not sufficient identity evidence. Both feeds include `data.available=false` values despite published ticket links. Their meaning was not established, so they must not become “sold out” or zero seats.

Renoir’s selector advertised 19–25 November. The captured day contained **17 distinct timed ticket links repeated across 51 HTML anchors**, across all versions. A collector should traverse advertised dates and deduplicate by session link, then apply the version filter. This pass did not claim a complete normalized Renoir VOSE count.

Cinesa’s existing Chrome-compatible transport worked for both missing city cinemas. Plain curl and the web reader returned 403 for some Cinesa pages. The successful authenticated requests used only the public website’s anonymous token, retained in memory, and read-only programme endpoints. No orders, reservations or seats were created.

## Ateneu Barcelonès and other cultural screening venues

**Ateneu Barcelonès belongs in the broader directory**, at **Canuda, 6**, with the category “cultural screening venue.” Its [own cinema section](https://ateneubcn.cat/seccions/cinema/) describes recurring cycles. A [documented public screening](https://ateneubcn.cat/activitats/pasolini-50-anys-de-llegat-cinematografic/) took place in Auditori Oriol Bohigas and was free for members and non-members. That event was **21 November 2025**, not 2026; it is evidence of screening activity, not an upcoming showtime. The [current agenda](https://ateneubcn.cat/programacio/) distinguishes film screenings and member access. A new collector must retain each event’s admission and reservation conditions. This is separate from Ateneu Fort Pienc and from Ateneu Cinema in Igualada.

Other supported cultural additions:

| Venue | Evidence and category |
| --- | --- |
| Institut Français de Barcelona, Moià 8 | [Municipal venue record](https://guia.barcelona.cat/detall/institut-francais-de-barcelone_92086003767.html) and the [Ohlalà 2026 screening grid](https://www.ohlalafilmfestival.com/es/parrilla/). Recurring and festival cinema. |
| CCCB, Montalegre 5 | [L’Alternativa’s current venues](https://alternativa.cccb.org/2026/ca/festival/informacio/seus) confirm screening activity. Store auditorium/theatre/hall under the venue and festivals as organisers. |
| CaixaForum Barcelona | [Operator programme](https://caixaforum.org/ca/barcelona/activitats) includes screenings and cineclub activities. Preserve event-level language and admission. |
| CosmoCaixa Barcelona | [SUNCINE programme](https://cosmocaixa.org/ca/p/suncine) verifies a 14 November 2026 screening, now past. Museum admission and screening reservation are separate. |
| Museu Etnològic i de Cultures del Món, Montcada 12 | [Municipal programme](https://guia.barcelona.cat/ca/detall/_99400765522.html) verifies three November screenings, ending 17 November. Cultural host rather than daily cinema. |

Ten further leads are retained with lower confidence: Biblioteca Jaume Fuster, CASA SEAT, Albareda, La Casa Elizalde, Fabra i Coats, CaixaForum Macaya, Can Carol, Casal de Barri de Trinitat Nova, La Bonne and MACBA. Festival-venue mentions, third-party listings or older programme material establish leads; dated operator screenings still need checking. Film-related talks, workshops and gallery video installations should not automatically become cinema sessions.

### Civic and seasonal coverage

The [current municipal Pantalla programme](https://ajuntament.barcelona.cat/centrescivics/ca/projecte/pantalla-bdc-17a-edicio) provides a much wider route into neighbourhood screenings. We recorded its **22 linked centres plus Sala La Pau**, which appears in the [dated calendar](https://beteve.cat/agenda/pantalla-barcelona-cinema-centres-civics/), reconciling the advertised 23 locations. The structured inventory contains every name and available official venue link. Host-centre names do not always identify the actual screening room: Urgell can use IES Poeta Maragall, and La Marina uses Sala Maremar.

Maintain a separate seasonal category for [Sala Montjuïc](https://www.salamontjuic.org/?lg=2), [Cinema Lliure at Platja de Sant Sebastià](https://cinemalliure.com/localitats-catalunya/) and [CCCB’s Gandules](https://www.cccb.org/en/w/seasons/gandules-2026). Their 2026 summer activity is not a current November programme. Gandules is a CCCB programme, not an additional permanent cinema.

## Nearby cinemas

La Farga in L’Hospitalet and Splau in Cornellà are already integrated. The following ten nearby candidates are separate from the Barcelona-city total:

| Candidate | Municipality | Verification and next step |
| --- | --- | --- |
| [Filmax Gran Via](https://cinesfilmax.com/) | L’Hospitalet | Also on the user’s reference page. Official site advertises 4DX/ScreenX and A1/Admit One. Inspect programme payload before claiming adapter reuse. |
| [OCINE Màgic](https://www.ocinemagic.es/) | Badalona | Trade-directory entry confirmed; direct website timed out. Programme and VOSE still unresolved. |
| [Cinesa LUXE Barnasud](https://www.cinesa.es/cines/barnasud/) | Gavà | Public site ID **040** verified; venue programme probe still needed. |
| [Yelmo Premium Castelldefels](https://www.yelmocines.es/cartelera/barcelona/premium-castelldefels) | Castelldefels | Anec Blau location. Directory confirmed; direct web read returned 403. Need provider cinema identity. |
| [Yelmo Premium Sant Cugat](https://www.yelmocines.es/cartelera/barcelona/premium-sant-cugat) | Sant Cugat | Directory confirmed; distinct from Sant Cugat Cinemas. Programme probe pending. |
| [Sant Cugat Cinemas](https://www.cinemessantcugat.com/) | Sant Cugat | Current official programme found; A1 family suggests a reusable approach, still untested here. |
| [CineBaix](https://www.cinebaix.cat/) | Sant Feliu | Strong source: dates, rooms and explicit VOSE/VOE/VOC/DOE/DOC in HTML. |
| [Cinemes Can Castellet](https://www.cinemescancastellet.com/) | Sant Boi | Current official programme found; session extraction pending. |
| [Cinemes Montcada](https://www.cinemesmontcada.com/) | Montcada i Reixac | Official address verified. Empty rendered programme remains unresolved, not evidence of closure. |
| [Cinema Capri](https://www.cinecaprielprat.com/) | El Prat | Official forthcoming films and municipal cineclub found; programme uses mixed images and text. |

The JSON also retains 12 regional leads: Yelmo Abrera, Yelmo Baricentro, Cinesa Parc Vallès, Cinema Catalunya, Eix Macià, Imperial, Kinépolis Mataró Parc, Foment Mataroní, La Calàndria, Cinema Edison, OCINE Granollers and Espai l’Amistat. These are an expansion shortlist, not an exhaustive Barcelona-province inventory. Parc Vallès public site ID **031** was verified; the other regional feeds were not probed.

## Closed venues and duplicate-name traps

| Name | Treatment | Evidence |
| --- | --- | --- |
| Boliche | Closed in 2024; exclude from active inventory | [Closure report](https://www.lavanguardia.com/cultura/20241023/10045919/cine-boliche-cierra-definitivamente.html) |
| Yelmo Comèdia | Closed January 2024 | [betevé](https://beteve.cat/cultura/cinema-comedia-barcelona-tancara-diumenge-14-gener/) |
| Yelmo Icaria | Closed July 2023 | [betevé](https://beteve.cat/cultura/cinema-comedia-barcelona-tancara-diumenge-14-gener/) |
| Méliès | Closed in the pandemic period | [Closure report](https://beteve.cat/artic/tanquen-melies-cinemes/) |
| Palau / Palacio Balañà | Closed February 2020 | [Closure report](https://www.latorredebarcelona.com/actualitat/tanca-palau-balana/) |
| Aribau Club | Closed 2018; distinct from the two active Aribau venues | [Closure report](https://www.timeout.cat/barcelona/ca/noticies/tanca-laribau-club-sense-dir-adeu-073018) |
| Renoir Les Corts | Closed 2012; do not confuse with Floridablanca | [Europa Press](https://www.europapress.es/catalunya/noticia-cierran-cines-renoir-les-corts-barcelona-20120621141227.html) |
| IMAX Port Vell | Closed 2014; distinct from the current Diagonal Mar IMAX | [Site redevelopment report](https://elpais.com/espana/catalunya/2025-07-15/el-liceu-comienza-el-desembarco-en-el-puerto-de-barcelona-con-el-concurso-arquitectonico-de-la-nueva-sede.html) |

Also preserve aliases without creating new venues: Cinesa La Maquinista → current Yelmo La Maquinista; Heron City → SOM Multiespai; Full / Full HD → Kinépolis Splau; Gran Sarrià → Gran Sarrià Club; Cinemes Texas / former Lauren Gràcia → current Espai Texas. The Cinesa bootstrap explicitly classifies its former La Maquinista page as closed; that does not mean the current Yelmo venue is closed.

## Recommended implementation sequence

1. **Complete the directory metadata for all 13 missing city cinemas**, plus Filmax and Ateneu as requested. Venue visibility should not depend on having a qualifying session today. Separate permanent cinemas, cultural hosts and seasonal programmes.
2. **Extend the existing source families:** three additional Mooby shops and Cinesa sites 012/017. Keep the existing premium-room selection explicit; new cinemas must not inherit a “big screens” designation automatically.
3. **Cover the independent/cultural programme gaps:** Verdi and Verdi Park, Renoir, Girona, Zumzeig, Filmoteca, Texas and Maldà. Resolve Verdi’s entrance mapping, preserve source languages, and support box-office-only admission at Maldà. Ateneu needs event-level public-access checks and a current dated screening before adding showtimes.
4. **Expand nearby and event coverage** using verified programmes, then work through the lower-confidence regional and cultural leads.

The existing product preference is original audio with **Spanish subtitles**, across all original languages. Inventory inclusion is broader than that session filter. A VOSE-only view can legitimately show few or no sessions at a Catalan-focused venue; it must not relabel VOSC as VOSE or imply the cinema is inactive. Preserve original audio, subtitle language, dubbing and unknown values separately before any filtering.

Before enabling any new collector, verify session identity, date/time interpretation, language, duplicate handling, booking destination, stale-data behavior and failure detection. Seat availability is a separate capability and remains unknown until independently established. No ticket purchase, contact with venues, production refresh or deployment was performed during this inventory.
