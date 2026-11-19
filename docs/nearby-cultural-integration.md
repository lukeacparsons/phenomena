# Nearby cinemas and regular cultural programmes

Integrated on 19 November 2026. The collected directory now has 38 entries: 31 cinemas and seven cultural venues. The nine nearby cinemas and six cultural venues below are included in the normal refresh and in the independent `npm run preview:nearby` command.

The live refresh added **181 verified original-audio screenings**, preserving all **2,806** previously collected rows. The snapshot contains 2,987 rows; the interface hides sessions as their start time passes. New rows: CineBaix 54, Capri 1, Sant Cugat Cinemas 22, Montcada 3, Can Castellet 9, Barnasud 21, Yelmo Castelldefels 25, Yelmo Sant Cugat 14, OCINE Màgic 16, Institut Français 13, Casa Elizalde 2 and CaixaForum 1. The three new programme monitors add no unverified showtimes.

## Nearby cinemas

| Cinema | Public programme source | Import rule |
| --- | --- | --- |
| CineBaix | [Official programme](https://www.cinebaix.cat/) | Each dated session's VOSE/VOE/VOC label; dubbing excluded |
| Cinema Capri | [Municipal venue agenda](https://quefer.elprat.cat/equipaments/cinema-capri) | Exact date/time plus original-audio evidence; generic announcements held for review |
| Sant Cugat Cinemas | [Official booking catalogue](https://www.onlinecinematickets.com/?s=SANTCUGAT) | Labelled original variants and exact-matched editorial language evidence when available |
| Cinemes Montcada | [Official booking catalogue](https://www.onlinecinematickets.com/?s=MONTCADA) | Same rule, with a distinct theatre identity |
| Cinemes Can Castellet | [Official booking catalogue](https://www.onlinecinematickets.com/?s=SANTBOI) | Same rule, including advance cineclub bookings |
| Cinesa LUXE Barnasud | [Cinesa programme](https://www.cinesa.es/cines/barnasud/) | Site 040; all advertised dates; original-version attributes |
| Yelmo Premium Castelldefels | [Yelmo programme](https://yelmocines.es/cartelera/barcelona/premium-castelldefels) | Cinema 814; per-variant language and exact session identity |
| Yelmo Premium Sant Cugat | [Yelmo programme](https://yelmocines.es/cartelera/barcelona/premium-sant-cugat) | Cinema 784; same per-variant checks |
| OCINE Màgic Badalona | [Official booking programme](https://tickets.ocinemagic.es/) | Current, release and advance sections; qualify each child variant independently |

Sant Cugat, Montcada and Can Castellet's editorial APIs recovered on 19 November through the authenticated source reader when direct requests return a recognized browser check. Their booking catalogues supply dated variants, and the editorial APIs supply original-language evidence. Unmarked native-language films remain excluded whenever that evidence cannot be retrieved. See [provider collection repairs](provider-collection-repairs.md).

Capri's municipal listing specifies English audio for **Ernest Cole: Lost and found, 16 December at 19:30**. Its title, director and year match the [distributor's original-language record](https://mk2films.com/en/film/ernest-cole-lost-and-found/). This narrow reviewed match does not qualify other Capri films. The municipal page's visible time is used; its contradictory ICS encoding is not.

OCINE's bare `versio: O` occurs on dubbed films too. The collector therefore uses the child variant's explicit VO description and never spreads a parent film's aggregate VO attribute to all its sessions.

## Cultural venues

| Venue and permanent programme | Integration |
| --- | --- |
| [Institut Français](https://www.institutfrancais.es/barcelona/eventos/nuestros-eventos/) | Main official agenda restored: dated cinema events with on-site venue and version proof. If unavailable, the [official Ohlalà festival grid](https://www.ohlalafilmfestival.com/es/parrilla/) supplies explicitly partial coverage, with version labels checked on each film page |
| [CCCB / Xcèntric](https://www.cccb.org/es/w/proyectos/xcentric) | Programme link and discovery monitor. Current listings do not provide reliable original-audio evidence; no showtimes guessed |
| [CaixaForum Barcelona](https://caixaforum.org/es/barcelona/actividades) | Film activity/cycle discovery; exact single-date events with explicit original-version labels. Multi-day ranges and unverified versions held for review |
| [La Casa Elizalde](https://www.casaelizalde.com/cinema/) | Dated film pages with VOSE/VOSC; a double bill remains one event. Performative sessions are excluded |
| [Centre Cultural Albareda](https://albareda.inscripcionscc.com/MiramModular/buscador/buscador.jsp?c=13&f=15&g=1&t=CE) | Programme link and discovery monitor. Audio versions unverified; a combined live-music/film event does not establish the film's precise start |
| [Can Carol](https://cancarol.cat/tag/cinema/) | Programme link and discovery monitor. WordPress publication dates are not screening dates; Catalan titles alone do not prove original audio |

Discovery lists can include past events, installations and workshops. They are review candidates, not an upcoming film schedule. The directory's generated cinema pages link directly to these permanent programmes.

## Refresh and availability

Both refresh commands now validate and publish each cinema independently. Failed cinemas and untouched sources retain their rows and original collection timestamps; successful sources update even when Verdi/Girona or another operator is unavailable. Film metadata survives the merge, and optional poster/metadata work happens after programme publication. Metadata or poster failures do not qualify a film or invent availability. See the [robustness audit](crawler-robustness-audit.md).

Barnasud reuses Cinesa's existing read-only seat adapter. Other newly added providers currently retain unknown seat counts and official booking/programme links. OCINE links to the film's booking page, CineBaix to its official ticket office, and Capri to its box-office event page. No ticket selection, reservation or purchase is made.

Regression checks cover date-table parsing, venue identity, original Spanish versus dubbed Spanish, OCINE parent/child variants, cultural date and language evidence, and preservation of other catalogues. Run `npm test`.
