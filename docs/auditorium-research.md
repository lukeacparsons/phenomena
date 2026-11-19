# Auditorium research — 19 November 2026

Latest pass: [four individual sala seat-count observations and further research](cinema-technical-deep-research.md). The active catalogue now has 224 room records, 180 with capacity evidence, and 26 unidentified placeholders. Marketplace figures require current confirmation; grouped capacities are not assigned to individual rooms. [Photo provenance audit](cinema-technical-deep-photos.md).


Latest technical follow-up: [Girona laser/Atmos and Albareda seated capacity/stage details](cinema-research-next-steps.md). The room catalogue now contains 176 records with capacity evidence; stage dimensions are separate from screen and room measurements.


<!-- cinema-expansion-20261119 -->

The shared catalogue now has **219 room records**, including **27 explicitly unmapped placeholders**, across **59 researched venues**. **176 records have capacity evidence**, including dated, secondary, disputed and configuration-dependent figures. Its **58 screen/display pairs** comprise 44 current measurement records, twelve Mataró pairs with inferred axes, one disputed Casa Elizalde height and one Jaume Fuster LED display. **34 salas have source-identified interior photos**, with date/currentness caveats. [Comprehensive venue reference](cinema-comprehensive-research.md) · [Earlier gap research](cinema-gap-research.md) · [Photos](cinema-gap-photos.md) · [Earlier regional pass](cinema-regional-research.md). Room records are not a complete enumeration of every sala. The original eight-venue research follows below.

<!-- /cinema-expansion-20261119 -->

**85 salas across the eight indexed cinemas.** The current VOSE snapshot uses 69 of them. This catalogue also includes the other 16 rooms, so its coverage does not depend on which rooms happen to be showing VOSE films today.

| Collected | Coverage |
| --- | ---: |
| Current published screen measurements | 29 rooms: all 28 at Splau, plus Phenomena |
| Seat/capacity observations | All 85 rooms; mixed published figures and mapped positions |
| Live public booking layouts | 56 rooms: all Mooby, Cinesa and Yelmo rooms |
| Reference images, including foyers, promotions and drawings | 86, including 42 auditorium interiors and 4 drawings |
| Source-identified numbered-room interior photos | 6 rooms; includes a labelled promotional composite; capture/currentness limits apply |
| Operator-linked 360° tours | 4 |
| Verified current auditorium length × width × height | None found |

The main gaps are current physical room dimensions, exact projector/lens models outside Phenomena, screen dimensions outside Splau/Phenomena, and certified capacities where booking counts conflict with published figures. Unknowns remain empty. This is a documented public-source survey, not a certified or exhaustive venue specification.

Files: [structured catalogue](auditoriums.json), [image gallery and source index](auditorium-images.md), [image manifest](auditorium-images.json), [sanitized seating layouts](auditorium-seatmaps.json).

## Reading the numbers

**Published seats** reproduce the numerical claims of their sources. **Mapped positions** count all places represented in a booking layout, regardless of sale status. Maps can include wheelchair and companion positions and can omit closed areas; neither number should silently replace the other. Separately listed wheelchair or VIP counts must not automatically be added to the headline seats.

All screen dimensions below are **width × height in metres**. A dagger (†) means the operator's table does not label the axes: its longer number is provisionally treated as horizontal, and the original string is preserved in JSON. These are screen measurements, not room dimensions. No screen areas, auditorium sizes or viewing angles have been estimated from photographs or seating grids. Yelmo’s additional >150 m² claim is a published format-level lower bound without a sala assignment; it is not counted among the 29 room-specific width/height measurements.

Equipment claims apply to a room or venue as explicitly indicated. They do not establish the presentation format of every session. “—” means not found. Rooms marked * are absent from the indexed VOSE snapshot, not closed.

## Strongest findings

- **Phenomena:** 15 × approximately 6.2 m screen, Christie CP4435-RGB 4K RGB laser, approximately 20 m throw, and retained 35/70 mm projection after the 2026 renovation. [Manufacturer release](https://www.christiedigital.com/press-releases/phenomena-experience/).
- **Splau:** a current operator table supplies seats, accessibility, screen dimensions and sound for all 28 rooms. Salas 11 and 12 are separately identified as Laser ULTRA, combining 4K laser and Atmos. [Room table](https://kinepolis.es/cines/kinepolis-barcelona-splau/info/), [Laser ULTRA](https://kinepolis.es/movie-formats/laser-ultra).
- **Diagonal Mar:** Sala 9 is LUXE IMAX; Sala 10 is 4K/Atmos iSense. Published capacity figures conflict with live booking maps. [Operator room guide](https://www.cinesa.es/cines/diagonal-mar/).
- **La Farga:** all seven rooms are listed as 4K/Dolby 7.1 with LUXE recliners. [Operator room guide](https://www.cinesa.es/cines/la-farga/).
- **Mooby:** Balmes 1/6/8/9 explicitly advertise laser, with Atmos in 8/9; Bosque 1 advertises 4K/Atmos; Aribau 5 advertises 4K. [Balmes](https://www.moobycinemas.com/sobre-balmes), [Bosque](https://www.moobycinemas.com/sobre-bosque), [Aribau](https://www.moobycinemas.com/sobre-aribau).
- **Yelmo:** the 2025 technical report describes Barco Series IV 4K laser throughout the 12-room venue. Current programme labels identify 4DE in Sala 4, SJ in Sala 7, Atmos in Sala 12, and XE sessions in both 8 and 9. A February 2025 distributor list independently supports two XE rooms. Exact screen measurements per XE sala remain unresolved. [Technical report](https://rubik-audiovisual.com/cine-yelmo-premium-westfield-la-maquinista-todo-en-uno/), [public schedule API](https://yelmocines.es/now-playing.aspx/GetNowPlaying).


## What the deeper search added

- **12 Yelmo layouts:** 1,794 mapped positions in total. Every sala now has a capacity observation, but this does not certify all 85 occupancies. Sala 12 has an unresolved 403-versus-402 internal API discrepancy.
- **Yelmo screen area:** the operator’s own award submission says its Macro XE screen exceeds **150 m²**. It supplies neither width/height nor a sala number, so the claim stays at venue/format level. [Operator submission](https://congresoaecc.aedecc.com/candidato/cine-yelmo-premium-westfield-la-maquinista-presentado-por-cine-yelmo/).
- **25 additional image references:** 21 photos and four architectural drawings. Diagonal Mar’s event listing explicitly labels interiors for Salas 3 and 10; numbered entrance photos identify Diagonal Mar 10 and Yelmo 12. Capture dates are not established. [Diagonal Mar listing](https://www.venuesplace.com/es/6897-cinesa-diagonal-mar), [Yelmo submission](https://congresoaecc.aedecc.com/candidato/cine-yelmo-premium-westfield-la-maquinista-presentado-por-cine-yelmo/).
- **Balmes plans:** COAC provides elevation, floor plans and a section credited to MMASS Arquitectes. They are useful architectural references, but their available resolution and room-number mapping do not establish current sala dimensions. A photographer’s portfolio adds an unnumbered auditorium view. [COAC archive](https://www.arquitecturacatalana.cat/es/obras/multicinemes-balmes), [Jordi Anguera](https://jordiangueraphoto.com/proyectos/arquitectura/multicines-balmes).
- **Mooby equipment baseline:** the operator’s March 2026 interview describes digital projection throughout, phased laser/Atmos upgrades and no active 35/70 mm projection. It does not identify models in each sala. [Operator interview](https://box-office.es/news/un-legado-que-mira-a-un-futuro-brillante/).

| Cinema | Capacity observations | Width/height measurements | Booking layouts | Source-identified interior-photo rooms |
| --- | ---: | ---: | ---: | ---: |
| Phenomena Experience | 1/1 | 1/1 | 0/1 | 1/1 |
| Mooby Balmes | 12/12 | 0/12 | 12/12 | 0/12 |
| Mooby Bosque | 9/9 | 0/9 | 9/9 | 0/9 |
| Mooby Aribau | 5/5 | 0/5 | 5/5 | 0/5 |
| Cinesa Diagonal Mar | 11/11 | 0/11 | 11/11 | 2/11 |
| Cinesa LUXE La Farga | 7/7 | 0/7 | 7/7 | 0/7 |
| Yelmo Premium La Maquinista | 12/12 | 0/12 | 12/12 | 0/12 |
| Kinépolis Barcelona Splau | 28/28 | 28/28 | 0/28 | 0/28 |

Photo counts exclude entrances, unnumbered interiors, filename candidates and inferred Junior mapping. Source identity does not prove the photo reflects the room’s current appearance. All eight cinemas still lack verified current auditorium length × width × height.


## Phenomena Experience

Sources: [Christie: Phenomena Experience renovation](https://www.christiedigital.com/press-releases/phenomena-experience/), [Sala Abierta: first-hand Phenomena technical visit](https://www.salabierta.es/?p=2496).

The manufacturer's screen height is approximate. The first-hand technical visit reports 15 × 6.27 m and 420 seats; the indexed programme's capacity field is 419. The former 450-seat figure predates the renovation.

The visit reports a Cinemeccanica Victoria 8 film projector with a 5,000 W UXL-5000HR xenon lamp, Dolby CP850/CP650 processors, five Dolby 136 screen systems, ten SB218XL screen subwoofers plus four surround subwoofers, and 28 DSR1260/1280 surrounds (10 side, 8 rear, 10 ceiling). It describes 15 QSC amplifiers, a Q-SYS Core 110f and AES67 networking, plus unnumbered Ezcaray seating. These component details are **reported by the visitor**, distinct from manufacturer-confirmed projector/screen details. [Technical visit](https://www.salabierta.es/?p=2496).

The projector's 35,000-lumen figure is a model rating, not measured output at the screen. A room photograph from the renovation release is in the [gallery](auditorium-images.md#phenomena-experience).


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 420 / 419 snapshot | — | 15 × ≈6.2 | Christie CP4435-RGB · 4K RGB laser | Atmos; CP850 / CP650 |

## Mooby Balmes

Sources: [Mooby: about Balmes](https://www.moobycinemas.com/sobre-balmes).

The operator specifically assigns laser to 1, 6, 8 and 9 and Atmos to 8 and 9. Other rooms' projection resolution and sound are not established. All 12 have mapped seating layouts. One official auditorium image has a filename suggesting Sala 9, but the page does not caption its room number. Infinity Vision mentions Balmes without a room assignment. The [COAC drawings](https://www.arquitecturacatalana.cat/es/obras/multicinemes-balmes) and [photographer’s interior](https://jordiangueraphoto.com/proyectos/arquitectura/multicines-balmes) are now cached in the gallery; neither resolves numbered-room dimensions.


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | — | 135 | — | Laser | — |
| 2 | — | 172 | — | Digital; model unknown | — |
| 3 | — | 101 | — | Digital; model unknown | — |
| 4 | — | 101 | — | Digital; model unknown | — |
| 5 | — | 144 | — | Digital; model unknown | — |
| 6 | — | 114 | — | Laser | — |
| 7 | — | 110 | — | Digital; model unknown | — |
| 8 | — | 182 | — | Laser | Dolby Atmos |
| 9 | — | 233 | — | Laser | Dolby Atmos |
| 10 | — | 156 | — | Digital; model unknown | — |
| 11 | — | 114 | — | Digital; model unknown | — |
| 12 | — | 110 | — | Digital; model unknown | — |

Operator-linked tours (capture dates and room coverage not independently verified): [TOUR 360º](https://www.google.es/maps/place/Balmes+Multicines+V.O.+12+sales+3D/@41.4072618,2.1386817,3a,75y,72h,90t/data=!3m8!1e1!3m6!1sLselwkl5-9QAAAQfDQMDvw!2e0!3e2!6s%2F%2Fgeo3.ggpht.com%2Fcbk%3Fpanoid%3DLselwkl5-9QAAAQfDQMDvw%26output%3Dthumbnail%26cb_client%3Dsearch.TACTILE.gps%26thumb%3D2%26w%3D129%26h%3D106%26yaw%3D72.596535%26pitch%3D0!7i13312!8i6656!4m2!3m1!1s0x12a4980e972e6497:0x2e54344b703ca35e!6m1!1e1).

## Mooby Bosque

Sources: [Mooby: about Bosque](https://www.moobycinemas.com/sobre-bosque), [Mooby Infinity Vision](https://www.moobycinemas.com/infinity-vision).

Sala 1's 500-seat claim also appears on the [Infinity Vision page](https://www.moobycinemas.com/infinity-vision), and matches its mapped positions. Other room capacities below are map counts. Official auditorium photographs do not identify a sala. Venue-level 3D advertising does not identify its room coverage.


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 500 | 500 | — | 4K | Dolby Atmos |
| 2 | — | 110 | — | Digital; model unknown | — |
| 3 * | — | 171 | — | Digital; model unknown | — |
| 4 | — | 142 | — | Digital; model unknown | — |
| 5 | — | 179 | — | Digital; model unknown | — |
| 6 | — | 253 | — | Digital; model unknown | — |
| 7 | — | 183 | — | Digital; model unknown | — |
| 8 | — | 174 | — | Digital; model unknown | — |
| 9 | — | 299 | — | Digital; model unknown | — |

Operator-linked tours (capture dates and room coverage not independently verified): [TOUR 360º](https://www.google.es/maps/place/Bosque+Multicines+9+sales+3D/@41.4015013,2.1518899,3a,75y,252h,90t/data=!3m8!1e1!3m6!1solZwF4k1Y0oAAAQuq1MDtg!2e0!3e2!6s%2F%2Fgeo0.ggpht.com%2Fcbk%3Fpanoid%3DolZwF4k1Y0oAAAQuq1MDtg%26output%3Dthumbnail%26cb_client%3Dsearch.TACTILE.gps%26thumb%3D2%26w%3D129%26h%3D106%26yaw%3D252.3204%26pitch%3D0!7i13312!8i6656!4m2!3m1!1s0x12a4a2a27964f483:0x7a639a18fa2e672f!6m1!1e1).

## Mooby Aribau

Sources: [Mooby: about Aribau](https://www.moobycinemas.com/sobre-aribau).

Sala 5 is the large Aribau Cinema auditorium. The operator's “more than 1,100” claim differs from 1,053 mapped positions. Closed sections are a possible explanation, not an established fact. The map has two provider seat-type codes and 48 non-empty grid rows; these are not measured architectural rows. Image filenames suggest Salas 2, 4 and 5, all marked as candidates. The operator links separate tours for rooms 1–4 and Sala 5.


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | — | 223 | — | Digital; model unknown | — |
| 2 | — | 155 | — | Digital; model unknown | — |
| 3 | — | 247 | — | Digital; model unknown | — |
| 4 | — | 216 | — | Digital; model unknown | — |
| 5 | >1100 | 1053 | — | 4K | — |

Operator-linked tours (capture dates and room coverage not independently verified): [TOUR 360º SALES 1-4](https://www.google.es/maps/@41.3860978,2.1625803,3a,75y,48.09h,90.18t/data=!3m7!1e1!3m5!1sjJ08AIFYxbkAAAQvOj2NKA!2e0!3e2!7i13312!8i6656?hl=es), [TOUR 360º ARIBAU CINEMA](https://www.google.es/maps/place/Aribau+Multicines+5+sales+-+Sala+5/@41.3861049,2.162574,3a,75y,50h,90t/data=!3m8!1e1!3m6!1sNuTwKiPusuUAAAQukBUVhg!2e0!3e2!6s%2F%2Fgeo1.ggpht.com%2Fcbk%3Fpanoid%3DNuTwKiPusuUAAAQukBUVhg%26output%3Dthumbnail%26cb_client%3Dsearch.TACTILE.gps%26thumb%3D2%26w%3D129%26h%3D106%26yaw%3D50.781208%26pitch%3D0!7i13312!8i6656!4m2!3m1!1s0x12a4a28b7e2ef005:0xbb184e1ef64c0765!6m1!1e1).



## Cinesa Diagonal Mar

Sources: [Cinesa Diagonal Mar — Las salas](https://www.cinesa.es/cines/diagonal-mar/).

The room guide is embedded in the official page under **Las salas**. It lists two wheelchair spaces per room except Sala 9, where it lists four; its booking layout represents two. Sala 3 separately lists 32 VIP seats and Sala 7 lists 26. Inclusion in the headline totals is not defined, so those numbers have not been added.

All 11 published seat counts differ from their booking-map counts. The sanitized layouts preserve normal, wheelchair and companion counts individually. Public **Sala 11 maps to internal screen ID `032-12`**; the suffix must not be used as its sala number. Screen dimensions, IMAX laser model and iSense projector model remain unverified. The shopping-centre IMAX/iSense pictures are promotional. The deeper pass separately found [event-listing photos](https://www.venuesplace.com/es/6897-cinesa-diagonal-mar) explicitly captioned Sala 3 and iSense/Sala 10, plus a Sala 10 entrance with a readable number. These establish source room identity, not current appearance; the same listing has stale totals and inconsistent capacity prose.


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 74 | 73 | — | 2K | Dolby 7.1 |
| 2 | 191 | 204 | — | 2K | Dolby 7.1 |
| 3 | 235 | 246 | — | 2K | Dolby 7.1 |
| 4 | 213 | 236 | — | 2K | Dolby 7.1 |
| 5 | 184 | 192 | — | 2K | Dolby 7.1 |
| 6 | 223 | 243 | — | 2K | Dolby 7.1 |
| 7 | 221 | 247 | — | 2K | Dolby 7.1 |
| 8 | 206 | 214 | — | 2K | Dolby 7.1 |
| 9 | 149 | 156 | — | 4K | IMAX sound |
| 10 | 340 | 344 | — | 4K | Dolby Atmos |
| 11 | 65 | 73 | — | 2K | Dolby 7.1 |

## Cinesa LUXE La Farga

Sources: [Cinesa LUXE La Farga — Las salas](https://www.cinesa.es/cines/la-farga/), [La Farga centre cinema page](https://centrolafarga.com/cines/).

Published wheelchair spaces for rooms 1–7 are **2, 1, 1, 3, 3, 2, 2**. The headline published figures equal all mapped positions, including wheelchair and companion places; adding these separately would double count. The [centre's page](https://centrolafarga.com/cines/) also shows recliners and individual tables, but none of its seven photos identifies a room number. No room-level source found supports an Atmos or iSense claim here.

Operator-managed Venuu event listings give **54 seated for Sala 1** and **138 for Sala 5**, numerically equal to each live layout minus wheelchair positions. That inclusion rule is an inference, not an explicit definition. Both list event AV, microphones, Wi-Fi and accessible facilities, without equipment models. Sala 5’s body text incorrectly calls it Sala 1; its title and numerical claim are retained with that warning. The new photographs remain candidates because the images themselves have no room number. [Sala 1 listing](https://venuu.com/es/es/espacios/cinesa-la-farga-sala-1), [Sala 5 listing](https://venuu.com/es/es/espacios/cinesa-la-farga-sala-5).


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 56 | 56 | — | 4K | Dolby 7.1 |
| 2 | 44 | 44 | — | 4K | Dolby 7.1 |
| 3 | 47 | 47 | — | 4K | Dolby 7.1 |
| 4 | 140 | 140 | — | 4K | Dolby 7.1 |
| 5 * | 141 | 141 | — | 4K | Dolby 7.1 |
| 6 * | 91 | 91 | — | 4K | Dolby 7.1 |
| 7 | 68 | 68 | — | 4K | Dolby 7.1 |

## Yelmo Premium La Maquinista

Sources: [Rubik: La Maquinista technical feature](https://rubik-audiovisual.com/cine-yelmo-premium-westfield-la-maquinista-todo-en-uno/), [Yelmo public programme, all languages](https://yelmocines.es/now-playing.aspx/GetNowPlaying).

Projection details are from **venue-wide technical reporting dated August 2025**, not individual projector inventories. The report also identifies Dolby speakers/servers, some Barco servers, Arts Alliance Media Screenwriter TMS, Kelonik projection/audio integration and Lumma 4D integration. Premium reclining seats have footrests and USB; the special Junior/4D rooms should not inherit a standard recliner specification without confirmation.

A fresh all-language programme query identifies **Sala 4 = 4DE/4DE 3D**, **Sala 7 = SJ (Junior)**, **Sala 12 = ATMOS**, and XE sessions in both **8 and 9**. A [February 2025 distributor list](https://www.myentrada.com/imgs/YELMO_CINES-RELACI%C3%93N_2025-02.pdf), visually checked, also lists two XE rooms, one Junior and one 4DE among 12 rooms. Its Premium/Junior/XE/4DE categories overlap. This supports two XE rooms despite the older feature’s single-room wording; it does not supply individual equipment inventories. [Yelmo’s 4DE page](https://www.yelmocines.es/4de) describes the effects.

The [operator award submission](https://congresoaecc.aedecc.com/candidato/cine-yelmo-premium-westfield-la-maquinista-presentado-por-cine-yelmo/) states **Macro XE >150 m²** with Atmos but does not identify a room. That lower bound is not copied into both Salas 8 and 9. Its Sala 12 entrance photograph visibly confirms the room number and Atmos sign; the other auditorium views lack numbered captions. The Junior photo can be linked to Sala 7 only as a corroborated inference from the unique SJ format and mixed seating zones.

**All 12 public booking layouts were collected.** Each sala number was checked against both the public programme and the booking summary for the exact showtime. Internal area labels are inconsistent in Salas 1, 2, 3 and 6, so they are retained without renumbering the rooms. No seats were allocated or selected; each temporary one-category-ticket preview was immediately cancelled, with no purchase. These are static mapped-position counts, not live availability or certified person capacity.

Sala 7 has **60 conventional positions, 7 loungers and 12 “SUPER PUFF” positions**. Sala 12 contains **403 distinct row/seat labels**, whereas its API area summary says **402**; both observations are preserved. The booking system’s special-position codes are not independently decoded as wheelchair or companion places. Pre-refurbishment Cinesa/Dolby Cinema capacities and dimensions remain separate from current Yelmo data.

| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | — | 71 | — | Barco Series IV · 4K laser | PREMIUM, CA PREMIUM (session labels) |
| 2 * | — | 71 | — | Barco Series IV · 4K laser | PREMIUM (session labels) |
| 3 | — | 60 | — | Barco Series IV · 4K laser | PREMIUM, CA PREMIUM (session labels) |
| 4 * | — | 158 | — | Barco Series IV · 4K laser | 4DE, 4DE 3D (session labels) |
| 5 * | — | 132 | — | Barco Series IV · 4K laser | PREMIUM, 2D (session labels) |
| 6 | — | 131 | — | Barco Series IV · 4K laser | PREMIUM, CA PREMIUM, 2D (session labels) |
| 7 * | — | 79 | — | Barco Series IV · 4K laser | SJ (session labels) |
| 8 | — | 208 | — | Barco Series IV · 4K laser | XE, PREMIUM (session labels) |
| 9 | — | 225 | — | Barco Series IV · 4K laser | XE, PREMIUM (session labels) |
| 10 | — | 133 | — | Barco Series IV · 4K laser | PREMIUM, CA PREMIUM (session labels) |
| 11 | — | 123 | — | Barco Series IV · 4K laser | PREMIUM (session labels) |
| 12 | — | 403 ‡ | — | Barco Series IV · 4K laser | ATMOS (session labels) |

‡ Sala 12: 403 mapped entries / 402 reported by the API area summary; unresolved.

## Kinépolis Barcelona Splau

Sources: [Kinépolis Splau room information (Spanish)](https://kinepolis.es/cines/kinepolis-barcelona-splau/info/), [Kinépolis Laser ULTRA](https://kinepolis.es/movie-formats/laser-ultra).

Every row of the Spanish operator table lists accessibility and a VIP zone. PMR spaces are recorded separately in JSON. Only Salas **11 and 12** receive a current room-specific Laser ULTRA projection claim; contemporary projector models for the other rooms are unknown.

There are unresolved official-source conflicts: the Spanish table gives **38 seats for Sala 2**, the Catalan table **39**. For **Sala 19**, Spanish dimensions are **4.80 × 8.40 m in source order**, Catalan **4.80 × 8.00 m**. The Spanish seat column totals **2,594**, with **45 PMR spaces** separately listed; adding them gives **2,639**, still different from the introduction's **2,687**. Both languages' conflicting observations remain in JSON. [Catalan table](https://kinepolis.es/ca/bioscopen/kinepolis-full-splau/info/).

The [corporate events page](https://empresas.kinepolis.es/cines/kinepolis-barcelona/) advertises stages up to 85 m² without assigning a sala. Its auditorium photos also lack reliable room labels: filenames `Sala1` and `Sala2` alone could be image sequence labels and are not used as room identities.


| Sala | Published seats | Mapped positions | Screen W × H (m) | Projection | Sound / format |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 138 | — | 10.8 × 6.8 † | — | Dolby Atmos |
| 2 | 38 / 39 | — | 7.63 × 3.81 † | — | Dolby 7.1 |
| 3 | 130 | — | 10.8 × 6.8 † | — | Dolby 7.1 |
| 4 | 38 | — | 7.63 × 3.81 † | — | Dolby 7.1 |
| 5 * | 34 | — | 8.88 × 4.04 † | — | Dolby 7.1 |
| 6 | 159 | — | 11.98 × 7.53 † | — | Dolby Atmos |
| 7 | 161 | — | 12.7 × 7.9 † | — | Dolby Atmos |
| 8 | 49 | — | 8.78 × 4.28 † | — | Dolby 7.1 |
| 9 * | 240 | — | 15 × 8 † | — | Dolby Atmos |
| 10 | 48 | — | 9.34 × 4.92 † | — | Dolby 7.1 |
| 11 | 240 | — | 15 × 8 † | Laser ULTRA · 4K laser | Dolby Atmos |
| 12 * | 240 | — | 15 × 8 † | Laser ULTRA · 4K laser | Dolby Atmos |
| 13 | 49 | — | 10.38 × 4.62 † | — | Dolby 7.1 |
| 14 | 222 | — | 15 × 8 † | — | Dolby Atmos |
| 15 | 47 | — | 10.6 × 5.25 † | — | Dolby 7.1 |
| 16 | 130 | — | 10.93 × 6.86 † | — | Dolby Atmos |
| 17 | 140 | — | 10.93 × 6.86 † | — | Dolby Atmos |
| 18 | 133 | — | 15.4 × 8.1 † | — | Dolby Atmos |
| 19 * | 43 | — | 8.4 × 4.8 † | — | Dolby Atmos |
| 20 * | 36 | — | 8.2 × 4.76 † | — | Dolby Atmos |
| 21 | 28 | — | 8.19 × 4.8 † | — | Dolby Atmos |
| 22 | 34 | — | 9.15 × 5.05 † | — | Dolby Atmos |
| 23 * | 41 | — | 9.1 × 5.2 † | — | Dolby Atmos |
| 24 * | 37 | — | 9.23 × 5.3 † | — | Dolby Atmos |
| 25 * | 37 | — | 9.23 × 5.3 † | — | Dolby 7.1 |
| 26 | 27 | — | 8.2 × 4.8 † | — | Dolby Atmos |
| 27 | 39 | — | 11.15 × 6.5 † | — | Dolby Atmos |
| 28 * | 36 | — | 10.98 × 6.37 † | — | Dolby Atmos |

## Historical Splau dossier — do not treat as current

The operator's [historical technical dossier](https://empresas.kinepolis.es/wp-content/uploads/2023/06/Fichas-dossier-Full-CAT.pdf) has a 2023 upload path. Its direct URL returned 404; the figures below were recovered from search-index text, **without access to verify the original PDF visually**. They differ materially from the live tables. They are retained as leads for obtaining the original technical drawings, and never fill current unknown fields.

The first-row column contains slash-separated distances in some rows. Their distinct meanings were not established. The floor areas are text extractions whose mapping must be checked against the original floor plan; **Sala 14's 129 m² is especially suspect**.

| Sala | Historical capacity | PMR | Historical screen W × H (m) | First-row distance, raw (m) | Unverified floor area (m²) |
| --- | ---: | ---: | --- | --- | ---: |
| 1 | 140 | 2 | 10.34 × 6.9 | 4.53 / 2.53 | 231 |
| 2 | 39 | 1 | 6.89 × 3.51 | 3.37 | 79 |
| 3 | 132 | 2 | 10.26 × 6.8 | 2.30 | 231 |
| 4 | 39 | 1 | 6.99 × 3.51 | 3.26 | 76 |
| 5 | 35 | 1 | 8.36 × 3.74 | 3.02 | 89 |
| 6 | 161 | 2 | 11.4 × 7.63 | 4.67 | 270 |
| 7 | 163 | 2 | 12.31 × 8 | 4.46 | 294 |
| 8 | 50 | 1 | 8.29 × 3.98 | 5.11 | 121 |
| 9 | 250 | 3 | 14.27 × 8.11 | 6.20 | 388 |
| 10 | 49 | 1 | 8.7 × 4.62 | 5.11 | 119 |
| 11 | 252 | 3 | 14.3 × 8.11 | 5.72 / 3.90 | 388 |
| 12 | 256 | 3 | 14.32 × 8.11 | 5.74 / 3.93 | 388 |
| 13 | 50 | 1 | 9.97 × 4.32 | 4.90 | 129 |
| 14 | 232 | 3 | 14.41 × 8.11 | 4.90 | 129 ? |
| 15 | 48 | 1 | 9.93 × 4.95 | 4.80 | 128 |
| 16 | 134 | 3 | 10.35 × 6.9 | 4.44 / 2.55 | 226 |
| 17 | 142 | 2 | 10.43 × 6.96 | 4.70 / 3.67 | 230 |
| 18 | 124 | 3 | 14.4 × 8 | 5.73 / 4.14 | 311 |
| 19 | 44 | 1 | 8 × 4.25 | 3.12 | 94 |
| 20 | 37 | 1 | 7.8 × 4.21 | 2.97 | 81 |
| 21 | 29 | 1 | 7.79 × 3.95 | 3.43 | 76 |
| 22 | 35 | 1 | 8.85 × 4.75 | 3.21 | 90 |
| 23 | 42 | 1 | 8.7 × 4.65 | 2.70 | 93 |
| 24 | 38 | 1 | 8.83 × 4.75 | 4.71 | 94 |
| 25 | 38 | 1 | 8.83 × 4.75 | 4.89 | 94 |
| 26 | 28 | 1 | 7.8 × 4.25 | 3.47 | 81 |
| 27 | 40 | 1 | 10.75 × 5.75 | 2.20 | 126 |
| 28 | 38 | 1 | 10.58 × 5.82 | 3.02 | 115 |

The dossier also describes curved screens, a venue-level mix of Barco 2K/4K laser and Christie 2K/4K xenon, and Eyes3Shut 3D in rooms 7, 9, 11, 16, 18, 20, 22, 27 and 28. It does not establish a current room-to-projector model mapping.

## Maps and review-photo pilot

Public Maps listing previews were inspected for all eight cinemas. **Five interior references** were saved: Balmes, Bosque, Aribau, Diagonal Mar and Maquinista. The other three previews were exterior views and were not duplicated into the image catalogue. This was a preview sample, not a complete collection of reviews or galleries. [Per-venue results and source links](auditorium-maps-research.json).

Bosque’s view is a **probable Sala 1** based on its large layout and distinctive blue-lit interior; Aribau’s view visually matches the existing Sala 5 candidate and supplies a larger file. Neither has an explicit numbered caption in the retrieved Maps data. Balmes and Diagonal Mar remain unnumbered. Maquinista’s preview carries a **2019 provider date** and appears to show the former cinema configuration; it is historical-only, not a current Yelmo sala photograph. Provider dates are not verified capture dates.

**No new confirmed numbered-room interiors were added**: coverage at the end of that pilot was three salas. The five files are additional source references, not five newly verified rooms or necessarily five distinct photographic compositions. An apparent La Farga cross-listing duplicate was traced to related-room recommendation cards; existing candidates remain unchanged.

The local Chrome app denied access. Anonymous public place data and photo previews were readable, but a full-gallery request returned HTTP 403 and the embedded legacy tour thumbnail requests also returned 403. No further requests to those denied resources were made. The four interactive tours remain unvisited.

## Additional visitor-photo and review findings

The follow-up saved **16 additional references** and added source-identified interiors for **three more rooms**: **Aribau 5**, **Balmes 9** and **Diagonal Mar 9 (IMAX)**. Coverage is now **six of 85 rooms**, including a room-labelled promotional composite for Balmes 9. Dates/current appearance remain qualified; photographs are not measurements.

- **Aribau 5:** an explicitly captioned [Time Out photograph](https://www.timeout.cat/barcelona/ca/sales-de-cinema/aribau-multicines-1), plus three [May 2026 seating-update photos](https://www.salabierta.es/?id=155&page_id=2314&view=topic), including a row-marker detail. The report describes a partial replacement of roughly 200 seats; it does not resolve total capacity.
- **Balmes 9:** [room-labelled promotional image](https://www.salabierta.es/?p=2181) showing the interior and Christie RealLaser branding. A visitor photo is a visual Sala 9 candidate; no original numbered review caption was recovered.
- **Diagonal Mar:** [firsthand IMAX review](https://www.salabierta.es/?p=50) supplies an interior and glasses/tray detail, joined to the operator’s Sala 9 identity. Additional event imagery is a candidate. Venuu adds a corroborated iSense Sala 10 angle and a tentative Sala 6 view.
- **La Farga 5 and Bosque 1:** additional interior references strengthen candidates. The new Yelmo Atmos image remains a **Sala 12 candidate** because its article calls it Sala 13; the MacroXE photograph cannot distinguish rooms 8 and 9.

Generic event-gallery images and a misleading image-search description were excluded. No new exact screen width/height, physical room dimensions or certified seat counts were found. The IMAX review’s approximate area claim is retained as a lead only. All new files have source URLs, pixel dimensions, hashes and association notes in the [image manifest](auditorium-images.json).

## Deeper-search coverage and unresolved leads

This pass checked operator booking data, event-hire listings, an operator-submitted award entry, a distributor’s room-format list, original technical reporting, an operator interview, architectural archives, photographer portfolios and linked technical PDFs. Searches used Spanish, Catalan and English terms for screen size, seats, technical sheets, plans and equipment. The [structured search notes](auditorium-research-log.json) retain useful leads and rejected matches.

No additional room-specific screen width/height or verified current room dimensions emerged. The historical Splau dossier’s Catalan and English URLs both still return 404. Architectural references to concrete “pantallas” at Balmes describe structural walls, not projection screens; the La Farga civic auditorium and Teatro del Bosque are different venues and their dimensions were excluded. Event listings without a measurement are not evidence of a missing or small screen.

## Evidence and remaining gaps

The JSON catalogue links every populated technical/capacity observation to a source registry. Booking layout sources include their exact public endpoint or performance URL and acquisition time. Maps retain position counts and row/seat labels, with no ticket availability, selection state, cookies or tokens. Layouts describe a particular published booking configuration, not a certified maximum occupancy.

The image manifest contains original URLs, referring pages, measured pixel dimensions, file size, SHA-256 hash, cached local paths and room-association confidence. 86 reference files were downloaded and decoded: 82 photos/promotional/detail images and four architectural drawings. There are 42 auditorium-interior references (including historical views, a promotional composite and a higher-resolution duplicate); six salas have source-identified numbered-room interiors. Two salas have numbered entrance photos, counted separately. The local cache is under `static/preview-data/auditoriums/images/` and remains ignored by Git. Image publication rights were not established; the source links and cache are research references. Four tour links were collected from official Mooby pages; the tours themselves were not navigated.

To fill the remaining gaps, request a **current technical sheet per sala** from the operators: screen width/height and aspect ratio; auditorium length/width/height; seat plan with accessibility and closed areas; projector, lens and server models; laser/xenon type; sound processor/channel configuration; seating model, row pitch and rake; photo date and room labels. Diagonal Mar additionally needs reconciliation of its room-guide capacities; Splau needs its Spanish/Catalan tables and historical dossier reconciled; Yelmo needs the dimensions of both XE screens, numbered interior photos, special-position definitions and the Sala 12 count discrepancy resolved. No messages have been sent to operators.

The dataset is a dated research snapshot. The application and its existing premium filters have not been changed by this research.

## Practical accessibility follow-up

The [practical cinema guide](cinema-practical-info.md) adds prices, transport, parking, accessibility and booking policies across the eight cinemas. IN-EDIT documents lift access, street-level accessible toilets and two wheelchair positions in each of Aribau rooms 1–4. Sala 5 uses a platform stairlift rated to 300 kg and accessible toilets in rooms 1–4 opposite. These observations are attached to the five room records; wheelchair positions are not added to existing seat totals. [IN-EDIT practical information](https://es.in-edit.org/informacion-practica-in-edit/).
