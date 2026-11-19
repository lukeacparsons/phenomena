# VO Barna: long-tail search and AI question page plan

Research date: 19 November 2026. Scope: VO Barna at the intended `vobarna.com` origin, including Barcelona and the nearby municipalities actually covered by the catalogue. This is a content and product plan, not a deployment or a traffic forecast.

## Implementation update — 19 November 2026

The first content batch is implemented in English, Spanish and Catalan:

| Plan item | English page | Delivered behavior |
| --- | --- | --- |
| P01 | `/en/showtimes/today/` | Remaining sessions on the absolute Madrid date, split before 18:00 and 18:00–midnight. |
| P03 | `/en/showtimes/english-language/` | Session-confirmed English audio for today plus the following six calendar days. Multilingual audio containing English is a separate section; films have expandable screening lists. |
| P04 | `/en/guides/english-subtitles-barcelona/` | Durable VOSI/audio/subtitle explanation plus all collected upcoming sessions with confirmed English subtitles. An honest empty state preserves the guide when there are no matches. |

The existing version guide now includes VO, VOSE, VOSC and VOSI, a comparison table and independent audio/subtitle examples. VO alone does not establish the presence or absence of subtitles.

**Homepage constraint:** all additional discovery navigation is inside the existing closed footer disclosure. Other information pages also place these new navigation links in a closed footer disclosure. The homepage filters, grid and modal interaction are unchanged by this batch. New-page screening results use semantic lists, with stacked cards on mobile so selecting a screening does not require sideways scrolling.

Each match exposes its actual audio/subtitle labels, cinema, room, date/time, source and collection time. **Select screening** opens the canonical film page with the exact session selected in the modal; **Tickets** continues to the operator. Canonicals, reciprocal EN/ES/CA alternates, breadcrumb/list structured data, sitemap entries and `llms.txt` discovery links are generated with the pages. The HTML works without JavaScript. A small enhancement removes started sessions and updates counts; after Madrid midnight, an open today/English-audio page requests a refresh rather than presenting yesterday as today.

**Deliberate scope boundary:** this batch selects from explicit session audio/subtitle fields, using the existing exact language normalizer. It does not infer English from film metadata, country, VOSE or an unknown language label. Supported film-to-session language derivation and shared typed browser/WebMCP language/time/geography filters remain follow-up work; the homepage’s broad free-text search has not been changed into an exact language filter.

Still to implement from the first six concepts: **P02 this weekend**, **P05 original-version IMAX**, and **P06 35mm/70mm**. The Gràcia-after-20:00/seating question also still needs the planned geography and sourced seating selection. Search Console/Bing verification and submission, remote publication-freshness monitoring and production reporting follow-up remain separate operational tasks.

Validation: language independence and unknown/multilingual cases, Madrid midnight and DST boundaries, generated metadata/footer placement, all nine localized pages without JavaScript, exact-session modal/reload/keyboard behavior, mobile layout and expired-session handling. The static audit covers every generated page and checks internal links, fragments, alternates and sitemap membership. Evidence is recorded in `docs/seo-geo-discovery-pages-2026-11-19.json`.

**Recommendation: become the source that answers “which exact screening meets my needs?”** Build a small set of useful discovery pages around audio, subtitles, dates and formats, supported by the existing film and cinema pages. The distinctive opportunity is the intersection of those facts: the right film, in the right language, at a suitable time, in a particular auditorium, with an official booking destination.

**Agreed visitor journey:** information pages provide the readable, source-backed facts needed to answer searches and AI questions. Each recommended screening then has a direct action that opens VO Barna's film modal with the matching session selected and its **Tickets** button visible. The visitor clicks Tickets to continue to the cinema. Both the information pages and this modal destination are required parts of the plan.

Start with **six new page concepts**, expand the **two existing guides**, and improve the **film and cinema templates**. Expand into neighborhoods, recommendations and practical comparisons when the data and observed demand justify them. A question does not automatically need its own URL; many related questions should be answered together on one substantial page.

**What this analysis establishes—and what it does not**

The research combines the current repository, its collected programme, public search results, first-person questions and selected operator sources. There is no authenticated Search Console, Bing Webmaster Tools, keyword-volume dataset, site analytics or private AI-chat query data in this assessment. Priorities below are judgments about intent, evidence, differentiation and readiness, not measured search-volume rankings. Example searches are proposed targets; example AI prompts are constructed scenarios, not transcripts from a generative engine.

The [publication guide](vobarna-publication.md) says domain attachment and production publication remain outstanding. A web-tool request to the intended domain could not retrieve it; that alone does not prove the domain is offline. This plan therefore assesses the local implementation and launch opportunity, not live rankings. The earlier [SEO/GEO audit](seo-geo-audit-2026-11-19.md) describes a prior implementation; its missing-HTML findings should not be treated as still unresolved. The builder now generates locale homepages, film and cinema pages, two guides, metadata and crawler controls.

## 1. What people are trying to accomplish

There are six useful audience groups. These are working hypotheses, not measured segments.

| Audience | Immediate job | Important constraints |
| --- | --- | --- |
| Residents who want undubbed films | Find a film and book a convenient showing | Date, audio, subtitles, familiar cinema, price |
| Visitors and international residents | Find something they can understand | English audio versus English subtitles, local title, location, time |
| Cinephiles | Choose a particular presentation or programme | Film identity, restoration, 35mm/70mm, room, sound, retrospective |
| Catalan-speaking viewers | Find originals or subtitles in Catalan | Catalan audio and VOSC are separate; dubbed Catalan is outside current scope |
| Families and groups | Find a suitable shared outing | Age classification, audio, start/end time, access, adjacent seats |
| People outside central Barcelona | Find a convenient local option | Municipality, current collection coverage, transport and parking |

The long tail follows a reusable pattern:

`film or experience + audio + subtitles + date/time + place + room/format + practical constraint`

For example, `Dune 1984 VOSE Barcelona Saturday 35mm` and “Find the original Dune on Saturday in original audio, ideally on film” express related intent. Title, edition, language and format must all apply to the same screening. A cinema having an IMAX room does not make its other sessions IMAX.

## 2. Evidence and the competitive opening

**Language confusion is observed demand.** Public threads ask whether VOSE implies English, whether Japanese films have English subtitles, and how to understand non-English dialogue in an otherwise English film. Those questions support separate audio and subtitle discovery, plus explanations on the actual booking journey. The comments are evidence of uncertainty, not authoritative statements about current availability. [English-subtitle request](https://www.reddit.com/r/AskBarcelona/comments/1mi8b03/cinemas_with_english_subtitles/), [Dune subtitle question](https://www.reddit.com/r/Barcelona/comments/1bmu9is), [VOSE question](https://www.reddit.com/r/Barcelona/comments/pky0fl).

**Room quality plus original audio is observed demand.** Other threads combine VOSE with large screens, reclining seats and IMAX, or compare Phenomena with Diagonal Mar. This supports factual auditorium comparisons and screening-level format results, rather than an unsupported universal “best cinema” ranking. [Large-screen request](https://www.reddit.com/r/Barcelona/comments/14cooux), [seating and equipment question](https://www.reddit.com/r/Barcelona/comments/zzr377), [Phenomena versus Diagonal Mar question](https://www.reddit.com/r/AskBarcelona/comments/1t2zvvp/phenomena_o_cinesa_diagonal_imax_para_ver_project/).

**Generic English listings already have direct competitors.** English Cinema Barcelona offers current listings, today, cinema profiles and an original-version guide; Englishmovi.es also presents English screenings and film pages. Kovu exposes original-version listings with dates and price information. This was a qualitative search sample, not a rank-tracking study or a complete feature audit. These pages establish competition, not the accuracy or completeness of every listing. [English Cinema Barcelona guide](https://englishcinemabarcelona.com/guides/english-movies-in-barcelona), [Englishmovi.es](https://barcelona.englishmovi.es/), [Kovu VO listings](https://kovufilms.com/vose).

**English subtitles merit a particularly useful page.** The local snapshot has 20 sessions explicitly marked `English` subtitles / `VOSI`, across four film/event records. Some are concert events, so they should not all be described as feature films. A checked Filmax operator page exposes a VOSI session; an official historical festival programme also defines and uses VOSI. Together these support an evidence-based discovery page that can show exceptions to blanket forum answers. They do not prove that every film, or every date, has an English-subtitled showing. [Filmax event](https://cinesfilmax.com/bts-world-tour-arirang-in-kaohsiung-live-viewing), [Asian Film Festival 2025 programme and version legend](https://asianfilmfestival.barcelona/2025/wp-content/uploads/2025/10/POSTER-PARRILLA-AFFB25_490x680_LOW-RES-1.pdf).

**Strategic inference:** VO Barna should compete on session-level evidence, languages beyond English, sourced room information and useful combinations. “We aggregate cinema listings” is already an established proposition. Claims that competitors cannot do something would require a fuller audit.

## 3. What the existing data can support

Snapshot inspected: `static/preview-data/programme.json`, generated **19 November 2026 at 18:11:19 UTC**. It contains **304 film/event records, 2,980 stored sessions, 38 directory entries and sessions at 34 venues**. These are stored-snapshot counts, not a promise that every session is still upcoming. Some directory entries monitor programmes without verified sessions.

| Field or asset | Observed coverage | Consequence for the plan |
| --- | --- | --- |
| Explicit session audio field | 1,855 / 2,980, or 62.2% | Normalize and verify language selection before making an exhaustive English-only claim. Original-audio eligibility does not always identify the language. |
| Explicit subtitle field | 1,983 / 2,980, or 66.5% | Show known languages and preserve unknowns. Blank must not become “no subtitles.” |
| Room field | 2,870 / 2,980, or 96.3% | Good foundation, but a room label still needs a verified join to technical research. |
| Numeric session price | 76 / 2,980, or 2.6% | A complete “cheapest showing” comparison is not ready. Separate observed tariffs from session prices. |
| English subtitle field | 20 sessions | Supports a focused guide with current verified matches; supply is narrow and can fluctuate. |
| Catalan subtitle field | 91 sessions | Supports a VOSC listing candidate after label normalization and source checks. |
| Format tags | 45 IMAX; 183 Dolby Atmos; 14 35mm; 2 70mm | Format discovery is plausible; counts overlap and represent this snapshot only. |
| Genres / classifications / runtimes | Present on 116 / 81 / 169 of 304 records respectively | Recommendations, family selection and finish-time estimates need fuller coverage or explicit editorial selection. Presence does not establish classification jurisdiction or accuracy. |
| Cinema and auditorium research | 59 venue dossiers; 219 room records, including 27 unmapped placeholders | Strong comparison material, but not 59 live catalogues or 219 fully verified rooms. Exclude unmapped records from factual comparisons. |

Sources: [programme and collection description](../README.md), [public builder](../scripts/build_public_site.py), [cinema dossiers](cinema-dossiers.json), [auditorium research](auditoriums.json), [practical information](cinema-practical-info.json).

The current search and WebMCP tools support dates, cinema IDs, formats and a curated premium selection. They do not expose typed audio/subtitle filters, time-of-day bounds, price limits, distance, ratings thresholds or adjacent-seat selection. Free-text language matches can hit film metadata as well as session fields; they must not serve as the correctness rule for a language landing page. Cinema research is not yet part of the WebMCP results. [Existing tool scope](../README.md#browser-agent-tools-webmcp).

## 4. Search clusters and their page owners

“Observed” means a directly related public question or competing result was found in this research. “Hypothesis” means a plausible extension requiring first-party validation. Neither label implies a volume estimate. The same intent can appear in any interface language.

| Cluster | Representative searches | Likely AI question or request | Page owner and priority |
| --- | --- | --- | --- |
| Original-version discovery — observed | `original version cinema Barcelona`; `cartelera VOSE Barcelona`; `cinema versió original Barcelona` | “Where can I see undubbed films in Barcelona?” | Existing locale homepage; improve introduction and discovery links. Foundation. |
| English audio — observed | `movies in English Barcelona`; `cine en inglés Barcelona`; `[film] English Barcelona` | “I don't speak Spanish. What can I watch in English?” | New English-audio listings; explain multilingual dialogue. First release. |
| English subtitles — observed | `English subtitles cinema Barcelona`; `VOSI Barcelona`; `cine subtítulos inglés Barcelona` | “Find a non-English film with English subtitles.” | One English-subtitle guide with live matches. First release. |
| Today and tonight — observed competing pages | `VOSE Barcelona hoy`; `English cinema Barcelona tonight`; `cinema VO avui` | “Show me three options for tonight.” | New today page with a clearly defined tonight section. First release. |
| This weekend — hypothesis | `VOSE Barcelona este fin de semana`; `cinema VO cap de setmana` | “What can we see on Saturday or Sunday?” | New rolling weekend page. First release, then measure. |
| Exact film and edition — observed | `[film] VOSE Barcelona horarios`; `[original title] tickets Barcelona`; `Dune 1984 Barcelona` | “Find the 1984 Dune, not the remake.” | Existing film page, with year and edition identity. First-release template work. |
| Film plus format — observed | `[film] IMAX VOSE Barcelona`; `[film] 70mm Barcelona` | “Which showing has both original audio and IMAX?” | Format section on the film page, linked from the IMAX/film-projection guides. First release. |
| Version terminology — observed | `does VOSE mean English`; `qué significa VOSI`; `VOSC què vol dir` | “Will the audio or subtitles be in English?” | Expand existing version guide; contextual links beside sessions. First release. |
| IMAX original version — observed | `IMAX VOSE Barcelona`; `IMAX English Barcelona`; `Diagonal Mar original version` | “Can I watch it in IMAX without dubbing?” | New IMAX guide with qualifying sessions. First release. |
| Film projection — observed related format questions | `70mm cinema Barcelona`; `35mm screenings Barcelona`; `70mm vs IMAX Barcelona` | “What can I see on 35mm or 70mm?” | One film-projection guide with separate 35mm and 70mm sections. First release. |
| Screen and sound comparison — observed | `biggest VOSE screen Barcelona`; `Dolby Atmos Barcelona VOSE`; `best cinema sound Barcelona` | “Prioritize picture and sound over convenience.” | Expand existing format guide and link to sourced room sections. First release. |
| Venue-specific decisions — observed | `Phenomena vs Balmes`; `Verdi or Renoir`; `Diagonal Mar best seats` | “Which of these cinemas suits this film and my preferences?” | Cinema pages and, later, one comparison guide. Avoid one page for every pair. |
| Neighborhood — observed competing coverage | `VOSE Gràcia`; `cinema original Eixample`; `English cinema near Sagrada Familia` | “Find a screening near where I'm staying.” | Verified area pages; start with Gràcia, then assess Eixample. Second release. |
| Nearby municipality — hypothesis | `VOSE Sant Cugat`; `cine VO Badalona`; `versió original Cornellà` | “Can I see it locally without going into central Barcelona?” | Municipality pages only where there is useful current coverage or substantive venue guidance. Second release. |
| Catalan subtitles — observed terminology/programmes | `cartellera VOSC Barcelona`; `pel·lícules subtítols català` | “Find an original-language film with Catalan subtitles.” | New VOSC listing page. Second release; high product fit. |
| Catalan originals — hypothesis | `pel·lícules originals en català Barcelona` | “What can I watch with Catalan original audio?” | Separate audio selection, initially a section/filter. Do not imply coverage of dubbed Catalan films. |
| Other original languages — hypothesis | `French films Barcelona`; `cinema japonés Barcelona`; `películas italiano VO Barcelona` | “Find something in French with Spanish subtitles.” | Typed filters first; promote only languages with recurring supply and demand. |
| Classics and repertory — hypothesis grounded in catalogue | `classic films Barcelona this week`; `cine clásico Barcelona`; `retrospectiva Barcelona` | “Show me a classic or restoration I can see this week.” | Editorially classified classics/repertory page. Second release. Old release year alone is insufficient. |
| Anime — observed subtitle question | `anime Japanese English subtitles Barcelona`; `anime VOSE Barcelona` | “Can I see this anime in Japanese and understand the subtitles?” | Film page first; one anime guide only with a verified recurring programme and tags. |
| Independent film and documentaries — hypothesis | `independent cinema Barcelona this week`; `documentales VO Barcelona` | “Suggest a documentary or independent film showing this week.” | Curated collection pages after metadata/editorial review. |
| Comfort and seating — observed | `VOSE reclining seats Barcelona`; `cine butacas cómodas VOSE`; `Phenomena numbered seats` | “Find an original-version cinema with reserved, comfortable seating.” | Cinema room facts, then a comfort comparison guide. Verify current policies. |
| Price and discounts — hypothesis/competing coverage | `cheap VOSE cinema Barcelona`; `cine VOSE día espectador`; `cine gratis Barcelona` | “Find an original-version showing under €8.” | Dated tariff/discount guide first. Session-price filtering waits for adequate data; free events require explicit price evidence. |
| Family suitability — hypothesis/competing coverage | `kids movies English Barcelona`; `cine infantil inglés Barcelona` | “Find an afternoon film suitable for my eight-year-old.” | Curated family page after Spanish classification, language and age suitability checks. |
| Accessibility — hypothesis | `wheelchair accessible VOSE Barcelona`; `cine bucle magnético Barcelona` | “Find step-free access and a wheelchair space for this showing.” | Verified cinema/room sections before any citywide shortlist. General venue access is not seat availability. |
| Booking and availability — observed booking questions | `[film] tickets Barcelona tonight`; `Phenomena sold out alternatives` | “Find another showing with seats and open its booking page.” | Existing film page and screening tools; report observed availability with its age. |
| Time, travel and occasion — hypothesis | `late night cinema Barcelona`; `short films tonight Barcelona`; `cinema date night Gràcia` | “Plan a film after dinner and get us home by midnight.” | Filtered results and linked venue facts first. Travel times and actual finish times need additional evidence. |
| Festivals and special events — observed programmes | `VOSI festival Barcelona`; `film Q&A Barcelona`; `concert cinema Barcelona subtitles` | “Find a special screening with a Q&A or English subtitles.” | Existing event/film records; seasonal hub only with verified dates, versions and event type. |

Do not target dubbed-film searches as though VO Barna were a complete general cinema listing service. Likewise, do not create city pages outside the verified geographical coverage merely because the query pattern is repeatable.

## 5. The first release: six new pages

These are proposed paths, not pages already implemented. Preserve published entity and guide paths. “Readiness” includes the work described in section 8.

| ID | Proposed English path and page title | Direct answer and required content | Why build it / readiness |
| --- | --- | --- | --- |
| P01 | `/en/showtimes/today/` — **Original-language cinema in Barcelona today** | Show today's remaining sessions immediately, with absolute date, local start time, film, audio, subtitles, venue, room and tickets. Provide a tonight section and clear links to language/format choices. | Strong booking intent and shared date template. Requires local-date rollover and expiry logic. |
| P02 | `/en/showtimes/this-weekend/` — **Original-language films in Barcelona this weekend** | Show the exact Friday–Sunday date range, grouped by day, with verified original-audio sessions and useful language links. State whether dates are only partially published. | Planning intent; demand less directly validated than P01. Reuses the date template. |
| P03 | `/en/showtimes/english-language/` — **Films in English in Barcelona: showtimes and tickets** | Show sessions whose audio has supporting English-language evidence, with subtitles separately labeled. Date controls and today/weekend sections; distinguish multilingual originals. | Competitive but directly relevant and conversion-oriented. Depends on typed language normalization. |
| P04 | `/en/guides/english-subtitles-barcelona/` — **Cinema with English subtitles in Barcelona: VOSI screenings** | Explain the audio/subtitle distinction, list current confirmed English-subtitled sessions, identify films versus events, describe source labels, and link to source/booking pages. State explicitly when none are collected. | Strong observed question and narrower differentiation. Sparse supply favors a durable guide plus live list, not an empty standalone filter page. |
| P05 | `/en/guides/imax-original-version-barcelona/` — **IMAX in original version in Barcelona: screenings and cinemas** | List sessions with both verified original audio and an advertised IMAX format, plus exact audio/subtitle fields. Explain cinema versus auditorium versus session. Link to verified room facts. | Observed high-intent combination, existing format tags and research. Verify current room mapping; no blanket IMAX 70mm or “real IMAX” claims. |
| P06 | `/en/guides/35mm-70mm-barcelona/` — **35mm and 70mm screenings in Barcelona** | Separate the two formats; list explicit session-format evidence, edition/restoration information where known, venue and tickets. Explain how film projection differs from an IMAX label. | Relevant to the site's room research and repertory coverage. Narrow supply; combine into one maintained guide initially. |

All six need a short answer near the start, substantive relevant results, source/check information and useful next actions. A permanent guide remains useful between screenings through verified explanatory and venue content. A broad listings page needs recurring inventory; do not launch it solely to show an empty table.

**Improve these existing pages alongside the six new concepts:**

| Existing owner | Change | Query families served |
| --- | --- | --- |
| `/en/guides/vose-vosc-original-version/` | Add VOSI, a label/audio/subtitle table, French VOSE and English VOSC examples, treatment of unknowns, and links to relevant current results. Do not interpret VO alone as proof of no subtitles. | Terminology, dubbing, language misunderstandings. |
| `/en/guides/cinema-screen-sound-formats/` | Turn the existing source-linked comparison into a clear decision aid: room, advertised screen dimensions, projection, sound, seating, evidence date and limitations. Explain the separate dimensions of quality. | Large screen, Atmos, comfort, format comparisons. |
| Film template: existing `/en/films/{registered-slug}/` | Put relevant local availability first; group sessions by date and expose audio/subtitles/formats together. Include title aliases, edition/year, booking links, nearby alternatives and a truthful no-upcoming-session state. | Film + city + language + date + format combinations. |
| Cinema template: existing `/en/cinemas/{registered-slug}/` | Add concise answers about programme, room-specific equipment, verified seating policies, exact address/entrance, access and transport sources. Separate monitored programmes from collected showtimes. | Venue + language, room, seats, address, access and booking questions. |

Enhance the home, guide index and directory navigation to link these destinations with ordinary descriptive anchors. Publish dedicated IMAX and film-projection detail in their own guides; keep the general format guide as the comparison overview so the same explanation is not repeated across competing pages.

## 6. Second release and research-dependent backlog

Order within each group should change in response to impressions, site searches, failed searches and booking clicks.

| Candidate | Proposed owner | Entry criterion |
| --- | --- | --- |
| VOSC showtimes | `/ca/cartellera/vosc/` and reviewed locale equivalents | Normalized subtitle evidence and recurring current inventory. Strong next candidate given the inspected snapshot. |
| Gràcia cinema guide and showtimes | `/en/areas/gracia/` | Verified venue membership, exact entrances, useful programme selection and genuinely local information. |
| Eixample cinema guide and showtimes | `/en/areas/eixample/` | Same; handle sub-neighborhoods and boundaries explicitly. “Near Sagrada Família” is not automatically an Eixample address. |
| Sant Cugat / Badalona / Cornellà | One municipality page at a time | Verify actual source coverage. A single useful venue may be better served by its existing profile. |
| Choosing a Barcelona cinema | `/en/guides/compare-barcelona-cinemas/` | Source-supported comparisons by picture, sound, seating, programme and location. Put common pairwise comparisons in sections until a standalone comparison has enough unique value. |
| Classics and repertory | `/en/guides/classic-films-barcelona/` | Reviewed classic/repertory/restoration tagging and edition identity. Avoid counting a double bill as two independent bookable events. |
| French-language screenings | `/en/showtimes/french-language/` | Repeated inventory over at least four weekly snapshots and evidence of demand. Apply the same gate to other languages. |
| Anime, documentaries or independent cinema | One curated collection per demonstrated need | Reliable classification and recurring supply. Do not infer anime from language or independent cinema solely from venue. |
| Comfortable seats and reserved seating | One comparison guide plus room sections | Current seat type, seat-allocation policy and room-specific sources; subjective comfort clearly attributed. |
| Cheap cinema / discount days | One dated practical guide | Current price category, conditions, fees, supplements and booking channel. No “cheapest in Barcelona” conclusion from partial data. |
| Free original-version screenings | One guide plus dated events | Explicit zero-price evidence, registration conditions and original-audio evidence. A missing price is not free. |
| Family films in original audio | Curated guide with current sessions | Verified relevant age classification, runtime, language and editorial suitability notes; do not classify concert events or unknown films automatically. |
| Accessible original-version cinema | Room facts first, city guide later | Distinguish step-free route, lift, accessible toilet, wheelchair positions, companion places, audio description and hearing assistance. Recheck with primary sources. |
| Festivals, outdoor screenings and Q&As | Seasonal hub when supported | Confirm current-year programme, date range, location, version, price/registration and event type. Preserve useful historical pages without presenting past events as current. |
| Highest-rated films showing now | A transparent curated/listing view | Verified identities, source-specific scores, observation dates, minimum vote counts and a clear ranking rule. Never silently mix incompatible ratings scales. |

These are candidate concepts, not a commitment to publish every row. No separate URL is needed for every language × neighborhood × date × genre × format combination.

## 7. AI questions: the answers the pages should make possible

AI requests often combine constraints and ask for a shortlist, comparison or action. Build pages that supply the facts for those tasks. Google documents related-query exploration in AI features, but that is not evidence of the frequency of these particular cinema prompts. [Google AI feature guidance](https://developers.google.com/search/docs/appearance/ai-features).

| Constructed request | Required answer | Page/tool support and gap |
| --- | --- | --- |
| “Find three films in English after 8pm near Gràcia, preferably with comfortable reserved seats.” | Up to three distinct films with matching sessions, audio/subtitle evidence, date/time, location and sourced seating information. Each recommendation opens its film modal with that session selected and Tickets visible. | P01 + P03 + a Gràcia information page + film/cinema/room pages. Add time bounds, typed language and geography selection, seating evidence and modal deep links. Rank the seating preference without silently relaxing the requested language, time or location. |
| “Find a Japanese film with English subtitles this weekend.” | Same-session Japanese audio + English subtitles + weekend dates; report no confirmed match honestly. | P04 + P02. Never substitute Japanese audio with Spanish subtitles without explaining the changed constraint. |
| “¿Dónde veo esta película en VOSE e IMAX el sábado?” | Exact film/edition and sessions satisfying both version and format. | Film page + P05; existing date/format filters are useful. |
| “Què puc veure en VOSC diumenge a Gràcia?” | Catalan-subtitled sessions on the requested Sunday at verified Gràcia venues. | VOSC + area page + film pages; typed subtitle and geography support needed. |
| “Compare Phenomena and Balmes for this film: screen, sound and seats.” | The actual rooms showing the film, sourced equipment, seating policy, current times, and unknowns. | Film and cinema pages + format guide. Expose room research through tools later. |
| “Find a good thriller under two hours that starts after dinner.” | Verified genre, runtime, chosen start window and a transparent reason for recommendation. | Candidate collection + film pages; metadata and time filters need work. Runtime excludes uncertain trailers/intermissions. |
| “Can my eight-year-old watch something in English on Saturday afternoon?” | Verified classification and language, runtime, timing and suitability information. | Family candidate; not safely solved by title or genre alone. |
| “I use a wheelchair; find a showing with space for me and a companion.” | Room-specific access and suitable space types, current availability evidence and booking method. | Cinema/room sources + screening. Ordinary seat totals cannot answer this. |
| “Find the cheapest English showing under €8 including fees.” | Comparable session total for an applicable ticket type, with observation time. | Currently incomplete. Give only verified prices and state the comparison's coverage. |
| “Find two seats together in an original-version showing.” | Adjacent-seat inventory or a booking flow where the user can inspect it. | Not established by cached seat counts; open official seat selection without claiming adjacency. |
| “Show me another screening because this one is sold out.” | Same work/edition and compatible version, alternatives ordered by time/location, dated availability. | Existing film search and screening details; unknown availability stays unknown. |
| “Plan a cinema evening near my hotel and get us home before midnight.” | Known location, travel estimates, showing and estimated finish with uncertainty. | Area/film pages provide inputs; location, routing and actual end time are not currently supplied. |

**Information pages answer the question; screening actions open the modal.** For the Gràcia example, the pages need to supply the following facts:

| Part of the question | Information that must be available to read and cite | Page owner |
| --- | --- | --- |
| “in English” | Verified audio for the particular session, with subtitle language separate | English-audio listings and film/session details |
| “after 8pm” | Absolute date and local start time, with the intended date range stated | Date listings and film/session details |
| “near Gràcia” | Venue address and neighborhood, plus an explicit definition of proximity when including nearby venues | Gràcia guide and cinema profiles |
| “comfortable reserved seats” | Room-specific seat type, current assigned/reserved-seating policy, source and check date; subjective comfort clearly attributed | Cinema/room profiles and the seating comparison guide when ready |
| “three films” | Up to three distinct film identities with qualifying sessions and reasons they match | Relevant listings or a composed recommendation using the same data |

The Gràcia information page should directly address a question such as **“Where can I watch films in English near Gràcia after 8pm?”** with a concise answer, relevant venue/seating facts, current matching sessions, sources and check dates. Put an **Open screening** action beside each match. Add the relevant sourced seating sections to cinema profiles even before a broader comfort guide is published. This combined intent is ready to promote only when the location and seating information supporting it has been verified; its information dependencies remain part of the implementation scope.

For a three-film answer, each option gets its own modal-opening link. Selecting one opens that film and highlights the exact recommended session; do not automatically open three dialogs or pick an unrelated showing. The visible path is **question → informed recommendation → selected film/session modal → Tickets → official cinema booking**. Visitors arriving on an information-page citation get the same screening actions alongside the answer.

For browser agents, a useful result contains canonical information-page destinations for citations, a separate modal-opening action URL, an exact screening identifier, absolute time with zone, separate audio/subtitle evidence, advertised format, source, collection time and the official booking destination used by Tickets. The action URL must preserve film, screening and locale when opened directly, in a new tab, or after refresh. Agents already operating the site can use `show_screening` for the same modal state. If there are zero matches, distinguish **no collected match**, **unknown/unpublished dates** and **unsupported constraint**.

**Current implementation gap:** `show_screening` already opens the film dialog, but the public service prefers canonical film/screening URLs, and the standalone detail-page script does not restore a modal. Verify and extend the external-link journey explicitly; a link to a static film page or a screening fragment alone does not yet satisfy the agreed modal destination. Keep complete information pages and ordinary booking links as the readable fallback when the enhancement is unavailable. [Service links](../static/cinema-service.js), [modal and URL state](../static/cinemas.js), [standalone detail-page enhancement](../static/site-page.js).

Keep existing WebMCP as a complementary browser interaction mechanism. Its presence is not proof of indexing, AI-engine support or citations. Buying tickets, reserving seats and sending alerts are not capabilities of the current tools; requests for those actions should resolve to the supported booking handoff rather than an invented completed action.

## 8. Content and implementation requirements

**Normalize the facts before multiplying pages.** Introduce shared typed predicates for original-audio qualification, audio language(s), subtitle language(s), date/time, cinema/municipality and advertised session formats. Preserve raw source labels and evidence. Normalize values such as `EN`, `en`, `Inglés` and trailing punctuation without confusing audio with subtitles. Multilingual audio should remain multilingual; mention English dialogue without promising an entirely English soundtrack.

Use explicit session language first. Derive language from a film only when verified original-language evidence and the particular session's original-audio qualification support it; record the derivation. Never infer English from VOSE, the title, the poster or the site's interface language. A source-confirmed original French film in VOSE belongs in French-audio and Spanish-subtitle results, not English-audio results. Where a stored source URL is a general venue/programme page, retain the specific screening/version evidence behind the claim and prefer a direct event link when available.

**Use one shared query definition per page.** HTML results, visible counts, interactive filters, shareable links and browser-tool answers must agree. Extend the current builder and query service rather than writing an unrelated keyword-matching implementation. Relevant starting points are [public builder](../scripts/build_public_site.py), [editorial copy](../scripts/site_content.py), [search](../static/cinema-search.js), [service](../static/cinema-service.js), [routing](../src/public-routing.mjs) and [identity policy](vobarna-publication.md#slug-policy).

**Make temporal promises precise.** Resolve “today,” “tomorrow” and “weekend” in Europe/Madrid and print absolute dates. Proposed weekend definition: Friday 00:00 through Sunday 23:59 local time, selecting the current weekend on Friday–Sunday and the next one Monday–Thursday. Show only future sessions within it. Proposed “tonight” section: remaining sessions from 18:00 local time to midnight; label the range. Use stable rolling URLs rather than publishing a new dated landing page daily. Test midnight, Sunday/Monday rollover and daylight-saving boundaries.

**Keep evidence freshness separate.** Programme collection, seat observations, prices and room research have different clocks. Display the relevant timestamp and stale/unknown state. A fresh build does not mean a failed cinema source was successfully checked. Expire past listings even during provider failures; show coverage gaps and official programme links. Show cached seat counts as observations, not live guarantees.

**Design for direct answers and decisions.** Start with a concise, specific answer, followed immediately by useful results or a comparison table. Include film identity/year, exact date/time, cinema and municipality, room where known, audio, subtitles, version/format, source and last check. Give each recommended session an action that opens the selected film/session modal, where Tickets leads to its official booking destination. Maintain readable information and an ordinary booking fallback without JavaScript. Add a small number of relevant question-and-answer sections where they resolve real confusion. There is no need for a large generic FAQ block on every page.

**Localize intent as well as copy.** EN should naturally address visitors and English-audio/subtitle questions; ES should use phrases such as “cartelera”, “sesiones”, “versión original” and “subtítulos”; CA should use “cartellera”, “sessions”, “versió original”, “avui” and “cap de setmana”. These are editorial choices, not measured language-market shares. Keep the existing `/en/`, `/es/`, `/ca/` model; add reviewed route mappings such as `showtimes` / `cartelera` / `cartellera` and `today` / `hoy` / `avui`. Generate reciprocal alternates only for translations actually published. Preserve film title aliases without creating duplicate work identities.

**Control overlap and indexing.** The homepage owns broad original-version discovery. The English page owns English-audio discovery. Today/weekend pages own date-led discovery. Specific film pages own named-film combinations; guides own explanatory/comparison intent. Initially handle “English IMAX tonight in Gràcia” as a filtered result linked from these owners. Give new substantive landing pages self-canonicals; keep arbitrary filter states out of the sitemap and retain the existing noindex handling. Do not canonicalize genuinely different language or intent pages to the homepage. Google warns that unrestricted faceted URLs can waste crawl resources. [Faceted navigation guidance](https://developers.google.com/crawling/docs/faceted-navigation).

Do not add crawl blocks that prevent a crawler from seeing an intended noindex directive. Evaluate additional crawl controls later using real crawl behavior. Do not apply an empty-filter policy blindly to a substantial evergreen guide: an English-subtitle guide can still be useful when its current session list is empty. Never turn expired film identities into unrelated redirects.

**Keep discoverability conventional.** Maintain readable HTML, internal links, accurate titles, source attribution and structured data matching visible facts. Preserve the actual publisher/venue distinction. Google states that its AI features do not require special AI files or special schema; these content choices improve usefulness and interpretability without guaranteeing citations. [Google AI feature guidance](https://developers.google.com/search/docs/appearance/ai-features).

## 9. Delivery sequence and acceptance criteria

The sequence is dependency-based rather than a promised calendar estimate. The user has requested analysis and a plan; implementation and publication have not been performed in this task.

1. **Confirm the launch foundation.** Complete the existing publication checklist, continuous refresh and monitoring, publisher/correction details, indexability checks and measurement setup. This is required before expecting organic acquisition; content preparation can proceed locally meanwhile.
2. **Build shared language/date selection and modal destinations.** Normalize audio/subtitle evidence and add predicates needed by P01–P04. Verify selection against real source examples and meaningful edge cases. Use the same model for generated pages and interactive results. Provide modal-opening action URLs alongside canonical information-page URLs and verify direct navigation, new tabs and refresh.
3. **Publish P01, P03 and P04; expand the version guide.** These cover the clearest immediate language/time needs. Confirm their actual indexable HTML and booking destinations before broadening.
4. **Publish P02, P05 and P06; improve formats and entity templates.** Reuse the date/listing machinery. Source-check relevant room joins and format explanations. Complete substantive EN/ES/CA translations before advertising alternates.
5. **Observe, then expand.** Review four weekly inventory snapshots and initial query/engagement signals. Start with VOSC and a verified Gràcia page if the evidence remains favorable. Require additional facts before price, family, accessibility or travel promises.

Acceptance criteria for the first release:

- Direct HTTP HTML contains the main answer, matching sessions and ordinary links without requiring JavaScript.
- English audio, English subtitles, VOSE, VOSC and VOSI produce the correct independent selections; unknown language is never silently treated as confirmed.
- A French VOSE example does not enter English-audio results; an English VOSC example can appear in both English-audio and Catalan-subtitle results; IMAX at one room does not label another room's screening.
- Relative date pages roll over correctly and remove expired sessions. Missing source coverage is visible and is not phrased as “nothing is showing in Barcelona.”
- Film identity, edition and title aliases resolve to the existing persistent URL; no duplicate pages are created for spelling variants or translations of the same work.
- Counts, links, visible facts and any structured data agree. Localized pages have the right language, canonical and actual alternates.
- Information pages expose the facts supporting their target questions in readable HTML, including source-backed location and room/seating facts where those are part of the answer.
- Every recommended screening has a working modal-opening destination. Direct navigation, new tabs and refresh open the correct film with the exact session selected and its Tickets button visible; Tickets uses that session's official booking destination.
- A three-film recommendation contains distinct films, with each action opening only the selected recommendation. Expired or unavailable targets show an explicit status and suitable alternatives without silently selecting another session.
- Each priority page has relevant internal links, a useful mobile results layout and the information-page → selected modal → Tickets journey, with complete readable information and booking links available when JavaScript is unavailable.

## 10. How to validate and reprioritize

Treat the initial backlog as a testable hypothesis. The main outcome is a successful screening decision and an official-ticket click; the site cannot infer completed purchases at an external cinema.

| Signal | What to collect | Decision it informs |
| --- | --- | --- |
| Search discovery | Search Console/Bing query and landing-page impressions/clicks, grouped by language, film, subtitle, format, date and place | Which existing pages need better answers; which new clusters deserve a page |
| On-site demand | Aggregated searches, selected filters, no-match reasons and exits from results | Which constraints users actually combine and which data gaps frustrate them; avoid retaining personal addresses or other unnecessary free text |
| Booking usefulness | Existing `vobarna:ticket-click` wired to analytics, with landing page, locale and relevant category | Whether a page helps users choose, rather than merely attracting visits |
| Data reliability | Source age, stale coverage, audio/subtitle completeness, corrected mismatches | Whether the answer is trustworthy enough to promote |
| Inventory stability | Weekly counts of qualifying films, sessions and venues per candidate page | Whether a proposed collection will remain useful between release cycles |
| AI visibility | Available referral data plus a fixed, small set of representative prompts run with engine/date/locale recorded | Whether pages are cited and whether cited language, time and format claims are correct |

Use the 12 constructed requests in section 7 as a repeatable qualitative evaluation set. Record cited URLs, answer accuracy, constraint satisfaction and whether the booking destination works. Repeat at a consistent cadence and compare multiple runs; individual answers are variable and this is not a population-wide AI ranking metric. AI referrals undercount exposure when users do not click or referrer information is missing.

Review initial results after roughly 30 days of actual indexable publication and again at 60–90 days, allowing for indexing delays. Do not demand a traffic target from an unlaunched site with no baseline. Expand a page family when it has useful recurring supply and evidence of demand or strong decision value; merge overlapping weak pages and improve missing facts before generating more URLs.

**Recommended implementation scope:** the six new page concepts and the two-guide/two-template improvements form the initial batch. The highest-value editorial test is the English-subtitle page; the most reusable engineering work is shared language/date selection and accurate film/cinema answers.
