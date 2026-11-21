"""Reviewed collection membership and dated offers, independent of live stock.

Repertory matches use cinema + provider film ID + original year. A source
category never supplies a session's projection format, language or price.
"""
from datetime import timedelta

REVIEWED_ON = '2026-11-19'
REPERTORY_UNTIL = '2026-12-31'

SOURCES = {
    'phenomena-programme': {'title': 'Phenomena — programación', 'url': 'https://phenomena-experience.com/index?pag=cartelera'},
    'scorsese': {'title': 'Phenomena — Scorsese in 35', 'url': 'https://phenomena-experience.com/index?lst_sel=9d202a4bae750ba948d27f59&pag=ciclo'},
    'wong': {'title': 'Phenomena — Wong Kar-wai', 'url': 'https://phenomena-experience.com/index?lst_sel=587bfaafad84c7d13d152aa6&pag=ciclo'},
    'cyberpunk': {'title': 'Phenomena — Cyberpunk Is Here', 'url': 'https://phenomena-experience.com/index?lst_sel=ca101491cbfa69aeccb6c950&pag=ciclo'},
    'noir': {'title': 'Phenomena — Neo Noir 1990s', 'url': 'https://phenomena-experience.com/index?lst_sel=5b98e190f011c0bf39e2345f&pag=ciclo'},
    'icons': {'title': 'Mooby — ICONS', 'url': 'https://www.moobycinemas.com/icons-by-mooby'},
    'wilder': {'title': 'Renoir — Dr. Strangelove / Wilder Cinema', 'url': 'https://www.cinesrenoir.com/pelicula/telefono-rojo-volamos-hacia-moscu-wilder-cinema/'},
    'eix-phenomena': {'title': 'Ajuntament de Barcelona — Phenomena location', 'url': 'https://guia.barcelona.cat/ca/detall/13e-festival-internacional-de-series-de-barcelona-serializados-fest_99400370509.html'},
    'eix-girona': {'title': 'Ajuntament de Barcelona — Cinemes Girona', 'url': 'https://guia.barcelona.cat/ca/detall/cinemes-girona_75990332131.html'},
    'eix-aribau': {'title': 'Ajuntament de Barcelona — Mooby Aribau', 'url': 'https://guia.barcelona.cat/detall/cinema-mooby-aribau_75990017485.html'},
    'eix-renoir': {'title': 'Ajuntament de Barcelona — Renoir Floridablanca', 'url': 'https://guia.barcelona.cat/es/detall/cinemes-renoir-floridablanca_2086161222.html'},
    'eix-arenas': {'title': 'Ajuntament de Barcelona — Mooby Arenas', 'url': 'https://guia.barcelona.cat/en/detall/cinemes-mooby-arenas-arenas-de-barcelona_99400267342.html'},
    'aribau-rooms': {'title': 'Mooby — Aribau Cinema / Sala 5', 'url': 'https://www.moobycinemas.com/sobre-aribau'},
    'verdi-prices': {'title': 'Verdi — precios', 'url': 'https://barcelona.cines-verdi.com/precios'},
    'renoir-prices': {'title': 'Renoir — precios Barcelona', 'url': 'https://www.cinesrenoir.com/precios/barcelona/'},
    'mooby-prices': {'title': 'Mooby — preus', 'url': 'https://www.moobycinemas.com/preus'},
    'texas-prices': {'title': 'Espai Texas — informació pràctica', 'url': 'https://espaitexas.cat/informacio-practica/'},
    'malda-prices': {'title': 'Maldà — precios', 'url': 'https://www.cinemamalda.com/precios-cine-malda-barcelona-preus/'},
    'girona-prices': {'title': 'Girona — preus', 'url': 'https://www.cinemesgirona.cat/preus'},
    'zumzeig-prices': {'title': 'Zumzeig — tarifas', 'url': 'https://zumzeigcine.coop/es/mas-informacion/tarifes/'},
    'filmoteca-prices': {'title': 'Filmoteca — informació pràctica', 'url': 'https://www.filmoteca.cat/web/ca/informacio-practica'},
    'filmax-prices': {'title': 'Filmax — precios', 'url': 'https://cinesfilmax.com/precios'},
    'castellet-prices': {'title': 'Can Castellet — tarifas', 'url': 'https://www.cinemescancastellet.com/precios'},
    'cinebaix-prices': {'title': 'CineBaix — preus', 'url': 'https://www.cinebaix.cat/'},
    'montcada-prices': {'title': 'Montcada — preus', 'url': 'https://www.cinemesmontcada.com/preus'},
    'ocine-prices': {'title': 'OCINE Màgic — precios', 'url': 'https://ocinemagic.es/precios-y-promociones'},
    'kinepolis-mataro-prices': {'title': 'Kinépolis Mataró — tarifas', 'url': 'https://kinepolis.es/cines/kinepolis-mataro-parc/info/'},
}
for _source in SOURCES.values():
    _source['checked_on'] = REVIEWED_ON

# District and sub-neighbourhoods checked in the city's venue directory.
EIXAMPLE_VENUES = {
    'phenomena': ('sagrada-familia', 'Carrer de Sant Antoni Maria Claret, 168', 'eix-phenomena'),
    'cinemes-girona': ('dreta', 'Carrer de Girona, 175', 'eix-girona'),
    'mooby-aribau': ('antiga-esquerra', 'Carrer d’Aribau, 8–10', 'eix-aribau'),
    'renoir-floridablanca': ('sant-antoni', 'Carrer de Floridablanca, 135', 'eix-renoir'),
    'mooby-arenas': ('nova-esquerra', 'Gran Via de les Corts Catalanes, 373–385', 'eix-arenas'),
}

# Each explicit selection was reviewed in an operator programme. No title/year
# heuristic can admit other films, remakes, venues or double bills.
REPERTORY = {
    ('phenomena', '3045'): (1984, 'revivals', 'phenomena-programme'),
    ('phenomena', '3019'): (1971, 'revivals', 'phenomena-programme'),
    ('phenomena', '2800'): (1996, 'revivals', 'phenomena-programme'),
    ('phenomena', '2697'): (1986, 'revivals', 'phenomena-programme'),
    ('phenomena', '687'): (1995, 'scorsese', 'scorsese'),
    ('phenomena', '1523'): (2006, 'scorsese', 'scorsese'),
    ('phenomena', '923'): (2004, 'scorsese', 'scorsese'),
    ('phenomena', '415'): (2004, 'wong', 'wong'),
    ('phenomena', '706'): (1994, 'wong', 'wong'),
    ('phenomena', '2241'): (1990, 'cyberpunk', 'cyberpunk'),
    ('phenomena', '1557'): (1995, 'cyberpunk', 'cyberpunk'),
    ('phenomena', '459'): (1988, 'cyberpunk', 'cyberpunk'),
    ('phenomena', '1593'): (1997, 'noir', 'noir'),
    ('phenomena', '2635'): (1995, 'noir', 'noir'),
    ('mooby-aribau', 'tt0166924'): (2001, 'icons', 'icons'),
    ('renoir-floridablanca', '/pelicula/telefono-rojo-volamos-hacia-moscu-wilder-cinema/'): (1964, 'wilder', 'wilder'),
}
REPERTORY_GROUPS = ('revivals', 'scorsese', 'wong', 'cyberpunk', 'noir', 'icons', 'wilder')


def repertory_match(film, session):
    record = REPERTORY.get((session.get('cinema_id'), str(session.get('film_id', ''))))
    year = film.get('release_year') or film.get('details', {}).get('release_year')
    return record if record and year == record[0] else None


# (key, ISO weekdays, venues, source, amount). Weekday 0 means every day.
# Every row is a general-admission tariff read on the operator's own price page.
# A dated tariff says when an offer is published; it never prices a session.
OFFERS_REVIEWED_ON = '2026-11-21'
OFFERS = (
    ('cinebaix-monday', (1,), ('cinebaix',), 'cinebaix-prices', '5.00'),
    ('renoir-days', (1, 3), ('renoir-floridablanca',), 'renoir-prices', '5.50'),
    ('verdi-monday', (1,), ('verdi', 'verdi-park'), 'verdi-prices', '5.90'),
    ('malda-days', (1, 3), ('cinema-malda',), 'malda-prices', '5.90'),
    ('girona-wednesday', (3,), ('cinemes-girona',), 'girona-prices', '5.00'),
    ('zumzeig-wednesday', (3,), ('zumzeig',), 'zumzeig-prices', '5.50'),
    ('castellet-wednesday', (3,), ('can-castellet',), 'castellet-prices', '5.50'),
    ('montcada-wednesday', (3,), ('cinemes-montcada',), 'montcada-prices', '5.90'),
    ('mooby-wednesday', (3,), ('mooby-aribau', 'mooby-balmes', 'mooby-bosque', 'mooby-arenas', 'mooby-glories'), 'mooby-prices', '6.50'),
    ('filmax-wednesday', (3,), ('filmax-gran-via',), 'filmax-prices', '6.70'),
    ('ocine-wednesday', (3,), ('ocine-magic',), 'ocine-prices', '6.90'),
    ('mataro-wednesday', (3,), ('kinepolis-mataro',), 'kinepolis-mataro-prices', '6.99'),
    ('sarria-wednesday', (3,), ('mooby-sarria',), 'mooby-prices', '8.00'),
    ('texas-thursday', (4,), ('espai-texas',), 'texas-prices', '4.00'),
    ('filmax-thursday', (4,), ('filmax-gran-via',), 'filmax-prices', '4.90'),
    ('mooby-thursday', (4,), ('mooby-arenas', 'mooby-glories'), 'mooby-prices', '6.50'),
    ('filmoteca-daily', (0,), ('filmoteca-catalunya',), 'filmoteca-prices', '4.00'),
    ('bosque-vose', (0,), ('mooby-bosque',), 'mooby-prices', '6.50'),
)
# Catalonia-wide and Barcelona public holidays. Review every year: a weekday
# offer is never listed on a holiday, nor on its eve where the tariff says so.
HOLIDAYS = frozenset({
    '2026-12-08', '2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06', '2027-03-26', '2027-03-29',
    '2027-05-01', '2027-05-17', '2027-06-24', '2027-08-15', '2027-09-11', '2027-09-24', '2027-10-12',
    '2027-11-01', '2027-12-06', '2027-12-08', '2027-12-25', '2027-12-26',
})
EVE_EXCLUDED = frozenset({'cinebaix-monday', 'girona-wednesday', 'montcada-wednesday', 'ocine-wednesday', 'mataro-wednesday'})
SUBTITLED_ONLY = frozenset({'bosque-vose'})


def discount_offer(session, day):
    """The published offer a session falls under on its local date, or None."""
    price = session.get('price_data') or {}
    lowest = price.get('amount', price.get('minimum'))
    for key, days, venues, _, amount in OFFERS:
        if session.get('cinema_id') not in venues:
            continue
        if 0 not in days:
            if day.isoweekday() not in days or day.isoformat() in HOLIDAYS:
                continue
            if key in EVE_EXCLUDED and (day + timedelta(days=1)).isoformat() in HOLIDAYS:
                continue
        if key in SUBTITLED_ONLY and not str(session.get('version') or '').upper().startswith('VOS'):
            continue
        # A collected price well above the tariff marks an event or premium format outside the offer.
        if lowest is not None and float(lowest) > float(amount) + 3:
            continue
        return key
    return None


for _offer in OFFERS:
    SOURCES[_offer[3]]['checked_on'] = OFFERS_REVIEWED_ON
# (brand, name, place). A row of several cinemas under one brand is named by the
# brand; the place is shown when every venue in the row shares it.
OFFER_VENUES = {
    'verdi': ('', 'Verdi', 'Gràcia'), 'verdi-park': ('', 'Verdi Park', 'Gràcia'),
    'renoir-floridablanca': ('', 'Renoir Floridablanca', 'Eixample'),
    'mooby-aribau': ('Mooby', 'Aribau', 'Eixample'), 'mooby-balmes': ('Mooby', 'Balmes', 'Sant Gervasi'),
    'mooby-bosque': ('Mooby', 'Bosque', 'Gràcia'), 'mooby-arenas': ('Mooby', 'Arenas', 'Eixample'),
    'mooby-glories': ('Mooby', 'Glòries', 'Sant Martí'), 'mooby-sarria': ('Mooby', 'Gran Sarrià', 'Sarrià'),
    'espai-texas': ('', 'Espai Texas', 'Gràcia'), 'cinema-malda': ('', 'Cinema Maldà', 'Ciutat Vella'),
    'cinemes-girona': ('', 'Cinemes Girona', 'Eixample'), 'zumzeig': ('', 'Zumzeig', 'Sants'),
    'filmoteca-catalunya': ('', 'Filmoteca', 'El Raval'),
    'cinebaix': ('', 'CineBaix', 'Sant Feliu de Llobregat'), 'can-castellet': ('', 'Can Castellet', 'Sant Boi de Llobregat'),
    'cinemes-montcada': ('', 'Cinemes Montcada', 'Montcada i Reixac'),
    'filmax-gran-via': ('', 'Filmax Gran Via', 'L’Hospitalet de Llobregat'),
    'ocine-magic': ('', 'OCINE Màgic', 'Badalona'), 'kinepolis-mataro': ('', 'Kinépolis Mataró', 'Mataró'),
}

COPY = {
 'en': {
    'classics': 'Classic films and repertory screenings in Barcelona',
    'classics_intro': 'Revisit a film on the big screen through this reviewed selection of revivals, director seasons and anniversary screenings. The lists update from the collected original-language programme. Each title keeps its original year; open its screenings to check the edition, audio, subtitles and advertised format.',
    'classics_description': 'Find classic-film revivals and repertory screenings in Barcelona, with reviewed seasons, original years, session formats and official tickets.',
    'classics_method': 'We review operator programmes and select specific film editions at specific cinemas. This selection was reviewed on 2026-11-19 for programmes through 2026-12-31. An old release year, a venue name or a 4K label alone cannot add a film. Only upcoming sessions for those reviewed identities appear; the selection is not exhaustive. New seasons and editions need editorial review. A combined double bill remains one bookable event rather than two inferred sessions.',
    'revivals': 'Selected revivals at Phenomena',
    'revivals_note': 'Return to Lynch’s Dune and Blue Velvet, Friedkin’s The Devils and Boyle’s Trainspotting. These are individually reviewed returning titles; a 4K session label alone does not establish a restoration.',
    'scorsese': 'Scorsese in 35', 'scorsese_note': 'Casino, The Departed and The Aviator appear in Phenomena’s Scorsese season. Check the format on the particular session.',
    'wong': 'Afternoons with Wong Kar-wai', 'wong_note': 'Phenomena’s season brings 2046 and Chungking Express back to the cinema.',
    'cyberpunk': 'Cyberpunk Is Here', 'cyberpunk_note': 'Hardware, Johnny Mnemonic and Akira are part of Phenomena’s cyberpunk programme.',
    'noir': 'Neo Noir 1990s', 'noir_note': 'The Usual Suspects and L.A. Confidential feature in Phenomena’s return to 1990s crime cinema.',
    'icons': 'Anniversary screenings at Mooby', 'icons_note': 'Mooby’s ICONS programme includes a 25th-anniversary presentation of Mulholland Drive at Aribau.',
    'wilder': 'Wilder Cinema at Renoir', 'wilder_note': 'Renoir lists Dr. Strangelove in its Wilder Cinema programme.',
    'classics_edition_title': 'Restoration, re-release or film print?',
    'classics_edition_body': 'A re-release brings a film back to cinemas. A restoration concerns the work done on its picture or sound. A 4K label describes presentation resolution; 35mm and 70mm describe film formats. They are not interchangeable. We show the operator’s session labels and do not promise a particular restoration, cut or print unless the source identifies it.',
    'classics_plan_title': 'Choosing a repertory screening',
    'classics_plan_body': 'Start with the original year to distinguish remakes, then compare audio and subtitles. Check whether the programme includes an introduction, discussion or double bill before planning your evening. A cinema’s announced season can include films without confirmed dates; only collected future sessions are bookable choices here.',
    'eixample': 'Original-language cinema in Eixample: cinemas and showtimes',
    'eixample_intro': 'Find original-language screenings at five reviewed Eixample cinemas from {date} to {end}, Europe/Madrid. Browse by neighbourhood: Sagrada Família, Dreta de l’Eixample, Antiga Esquerra, Sant Antoni and Nova Esquerra. Audio and subtitles are listed separately for every screening.',
    'eixample_description': 'Compare Phenomena, Cinemes Girona, Aribau, Renoir Floridablanca and Arenas, with Eixample neighbourhoods, addresses and original-language screenings.',
    'sagrada-familia': 'Sagrada Família · Phenomena', 'dreta': 'Dreta de l’Eixample · Cinemes Girona',
    'antiga-esquerra': 'Antiga Esquerra · Mooby Aribau', 'sant-antoni': 'Sant Antoni · Renoir Floridablanca',
    'nova-esquerra': 'Nova Esquerra · Mooby Arenas',
    'eixample_venues': 'Five cinemas across Eixample',
    'eixample_places': 'These are different parts of a large district. Use the exact address and the venue’s directions before choosing a session; district membership is not a walking-time estimate.',
    'eixample_aribau': 'Aribau Cinema is Sala 5 within Mooby Aribau. A screening elsewhere in the complex does not inherit Sala 5’s equipment.',
    'eixample_method': 'Venue membership and neighbourhood names are checked against Barcelona City Council listings. This page selects seven local calendar days at those five venues from our original-audio catalogue. A nearby landmark or an address containing “Barcelona” does not qualify another cinema. Unknown audio remains unknown; VOSE does not mean English.',
    'discounts': 'Cinema discount days in Barcelona: offers, fees and conditions',
    'discounts_heading': 'Cinema discount days',
    'discounts_intro': 'Monday, Wednesday and Thursday are the cheap days: tickets from €4.00.',
    'discounts_description': 'Compare Barcelona cinema discount days, booking fees, membership conditions and selected original-language programmes with dated operator sources.',
    'offers_reviewed': 'Reviewed', 'offer_sources': 'Sources', 'offer_programme': 'Showtimes',
    'offer_days': ('Every day', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
    'offer_months': ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'),
    'cinebaix-monday_body': 'Not on public holidays or their eves.',
    'renoir-days_body': '€5.40 online. Not on public holidays.',
    'verdi-monday_body': 'Amics del Verdi members: €5.40.',
    'malda-days_body': 'Valid for every film that day. Box office only.',
    'girona-wednesday_body': 'Not on public holidays or their eves.',
    'zumzeig-wednesday_body': 'Not on public holidays.',
    'castellet-wednesday_body': '',
    'montcada-wednesday_body': '',
    'mooby-wednesday_body': 'Not on public holidays. 3D +€2; Atmos and Infinity Vision +€1.',
    'filmax-wednesday_body': '',
    'ocine-wednesday_body': '',
    'mataro-wednesday_body': 'Online; €7.99 at the box office. Not on public holidays or their eves.',
    'sarria-wednesday_body': 'Not on public holidays.',
    'texas-thursday_body': '+€1 booking fee.',
    'filmax-thursday_body': 'Not on public holidays, 4DX or ScreenX.',
    'mooby-thursday_body': 'Not on public holidays.',
    'filmoteca-daily_body': '',
    'bosque-vose_body': 'VOSE screenings only.',
    'discount-screenings': 'Screenings on discount days',
    'discount-screenings_note': 'The next seven days, at the cinemas and days above.',
    'discounts_method': 'Tariffs come from each cinema’s price page. We list each cinema’s screenings on its discount day, leaving out public holidays and their eves.',
 },
 'es': {
    'classics': 'Cine clásico y de repertorio en Barcelona: próximas sesiones',
    'classics_intro': 'Redescubre películas en pantalla grande con esta selección revisada de reposiciones, ciclos de directores y aniversarios. Las listas se actualizan con la programación recogida en versión original. Cada título conserva su año original; abre las sesiones para comprobar edición, audio, subtítulos y formato anunciado.',
    'classics_description': 'Encuentra reposiciones y cine de repertorio en Barcelona, con ciclos revisados, años originales, formatos de sesión y entradas oficiales.',
    'classics_method': 'Revisamos programas oficiales y seleccionamos ediciones concretas en cines concretos. Esta selección se revisó el 2026-11-19 para programas hasta el 2026-12-31. Un año antiguo, el nombre de un cine o una etiqueta 4K no bastan. Solo aparecen sesiones futuras de las identidades revisadas; la selección no es exhaustiva. Los ciclos y ediciones nuevos requieren revisión editorial. Un programa doble sigue siendo un único evento reservable, sin inventar dos sesiones.',
    'revivals': 'Reposiciones seleccionadas en Phenomena',
    'revivals_note': 'Vuelve a Dune y Blue Velvet de Lynch, The Devils de Friedkin y Trainspotting de Boyle. Son reposiciones revisadas individualmente; una etiqueta 4K no demuestra una restauración.',
    'scorsese': 'Scorsese in 35', 'scorsese_note': 'Casino, The Departed y The Aviator figuran en el ciclo de Scorsese de Phenomena. Comprueba el formato de la sesión concreta.',
    'wong': 'Sobremesas con Wong Kar-wai', 'wong_note': 'El ciclo de Phenomena devuelve 2046 y Chungking Express a la sala de cine.',
    'cyberpunk': 'Cyberpunk Is Here', 'cyberpunk_note': 'Hardware, Johnny Mnemonic y Akira forman parte del ciclo de ciberpunk de Phenomena.',
    'noir': 'Neo Noir 1990s', 'noir_note': 'The Usual Suspects y L.A. Confidential figuran en el regreso de Phenomena al cine negro de los noventa.',
    'icons': 'Aniversarios en Mooby', 'icons_note': 'El programa ICONS de Mooby incluye una sesión del 25.º aniversario de Mulholland Drive en Aribau.',
    'wilder': 'Wilder Cinema en Renoir', 'wilder_note': 'Renoir incluye Dr. Strangelove en su programa Wilder Cinema.',
    'classics_edition_title': '¿Restauración, reestreno o copia fotoquímica?',
    'classics_edition_body': 'Un reestreno devuelve una película a los cines. Una restauración se refiere al trabajo sobre su imagen o sonido. La etiqueta 4K describe la resolución de presentación; 35mm y 70mm describen formatos fotoquímicos. No son equivalentes. Mostramos las etiquetas de cada sesión y no prometemos una restauración, montaje o copia concretos sin una fuente que los identifique.',
    'classics_plan_title': 'Cómo elegir una sesión de repertorio',
    'classics_plan_body': 'Empieza por el año original para distinguir remakes y comprueba audio y subtítulos. Consulta si hay presentación, coloquio o programa doble antes de organizar la tarde. Un ciclo anunciado puede incluir películas sin fecha confirmada; aquí solo se ofrecen como opciones las sesiones futuras recogidas.',
    'eixample': 'Cine en versión original en el Eixample: cines y cartelera',
    'eixample_intro': 'Consulta sesiones en versión original en cinco cines del Eixample revisados del {date} al {end}, Europe/Madrid. Explora por barrio: Sagrada Família, Dreta de l’Eixample, Antiga Esquerra, Sant Antoni y Nova Esquerra. Cada sesión muestra por separado audio y subtítulos.',
    'eixample_description': 'Compara Phenomena, Cinemes Girona, Aribau, Renoir Floridablanca y Arenas, con barrios del Eixample, direcciones y sesiones en versión original.',
    'sagrada-familia': 'Sagrada Família · Phenomena', 'dreta': 'Dreta de l’Eixample · Cinemes Girona',
    'antiga-esquerra': 'Antiga Esquerra · Mooby Aribau', 'sant-antoni': 'Sant Antoni · Renoir Floridablanca',
    'nova-esquerra': 'Nova Esquerra · Mooby Arenas',
    'eixample_venues': 'Cinco cines repartidos por el Eixample',
    'eixample_places': 'Son zonas distintas de un distrito amplio. Consulta la dirección exacta y las indicaciones del cine antes de elegir sesión; pertenecer al mismo distrito no permite calcular un trayecto a pie.',
    'eixample_aribau': 'Aribau Cinema es la sala 5 de Mooby Aribau. Una sesión en otra sala del complejo no hereda el equipamiento de la sala 5.',
    'eixample_method': 'La pertenencia al distrito y los nombres de los barrios se verifican en las fichas del Ayuntamiento de Barcelona. Seleccionamos siete días naturales locales en estos cinco cines a partir del catálogo de audio original. Un monumento cercano o una dirección con «Barcelona» no permiten incluir otro cine. El audio desconocido sigue sin confirmar; VOSE no significa inglés.',
    'discounts': 'Días de descuento en los cines de Barcelona: ofertas y condiciones',
    'discounts_heading': 'Días de descuento en el cine',
    'discounts_intro': 'Lunes, miércoles y jueves son los días baratos: entradas desde 4,00 €.',
    'discounts_description': 'Compara días de descuento, gastos de gestión y condiciones de socio en cines de Barcelona, con fuentes oficiales fechadas y programación en versión original.',
    'offers_reviewed': 'Revisado el', 'offer_sources': 'Fuentes', 'offer_programme': 'Cartelera',
    'offer_days': ('Todos los días', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'),
    'offer_months': ('ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'),
    'cinebaix-monday_body': 'No festivos ni vísperas.',
    'renoir-days_body': '5,40 € online. No festivos.',
    'verdi-monday_body': 'Socios de Amics del Verdi: 5,40 €.',
    'malda-days_body': 'Vale para todas las películas del día. Solo en taquilla.',
    'girona-wednesday_body': 'No festivos ni vísperas.',
    'zumzeig-wednesday_body': 'No festivos.',
    'castellet-wednesday_body': '',
    'montcada-wednesday_body': '',
    'mooby-wednesday_body': 'No festivos. 3D +2 €; Atmos e Infinity Vision +1 €.',
    'filmax-wednesday_body': '',
    'ocine-wednesday_body': '',
    'mataro-wednesday_body': 'Online; 7,99 € en taquilla. No festivos ni vísperas.',
    'sarria-wednesday_body': 'No festivos.',
    'texas-thursday_body': '+1 € de gestión.',
    'filmax-thursday_body': 'No festivos, 4DX ni ScreenX.',
    'mooby-thursday_body': 'No festivos.',
    'filmoteca-daily_body': '',
    'bosque-vose_body': 'Solo sesiones VOSE.',
    'discount-screenings': 'Sesiones en día de descuento',
    'discount-screenings_note': 'Los próximos siete días, en los cines y días de arriba.',
    'discounts_method': 'Las tarifas salen de la página de precios de cada cine. Mostramos las sesiones de cada cine en su día de descuento, sin festivos ni vísperas.',
 },
 'ca': {
    'classics': 'Cinema clàssic i de repertori a Barcelona: pròximes sessions',
    'classics_intro': 'Redescobreix pel·lícules en pantalla gran amb aquesta selecció revisada de reposicions, cicles de directors i aniversaris. Les llistes s’actualitzen amb la programació recollida en versió original. Cada títol conserva l’any original; obre les sessions per comprovar edició, àudio, subtítols i format anunciat.',
    'classics_description': 'Troba reposicions i cinema de repertori a Barcelona, amb cicles revisats, anys originals, formats de sessió i entrades oficials.',
    'classics_method': 'Revisem programes oficials i seleccionem edicions concretes en cinemes concrets. Aquesta selecció es va revisar el 2026-11-19 per a programes fins al 2026-12-31. Un any antic, el nom d’un cinema o una etiqueta 4K no són suficients. Només hi ha sessions futures de les identitats revisades; la selecció no és exhaustiva. Els cicles i edicions nous necessiten revisió editorial. Un programa doble continua sent un únic esdeveniment reservable, sense inventar dues sessions.',
    'revivals': 'Reposicions seleccionades a Phenomena',
    'revivals_note': 'Torna a Dune i Blue Velvet de Lynch, The Devils de Friedkin i Trainspotting de Boyle. Són reposicions revisades individualment; una etiqueta 4K no demostra una restauració.',
    'scorsese': 'Scorsese in 35', 'scorsese_note': 'Casino, The Departed i The Aviator figuren al cicle de Scorsese de Phenomena. Comprova el format de la sessió concreta.',
    'wong': 'Sobretaules amb Wong Kar-wai', 'wong_note': 'El cicle de Phenomena retorna 2046 i Chungking Express a la sala de cinema.',
    'cyberpunk': 'Cyberpunk Is Here', 'cyberpunk_note': 'Hardware, Johnny Mnemonic i Akira formen part del cicle de ciberpunk de Phenomena.',
    'noir': 'Neo Noir 1990s', 'noir_note': 'The Usual Suspects i L.A. Confidential figuren en el retorn de Phenomena al cinema negre dels noranta.',
    'icons': 'Aniversaris a Mooby', 'icons_note': 'El programa ICONS de Mooby inclou una sessió del 25è aniversari de Mulholland Drive a Aribau.',
    'wilder': 'Wilder Cinema a Renoir', 'wilder_note': 'Renoir inclou Dr. Strangelove al programa Wilder Cinema.',
    'classics_edition_title': 'Restauració, reestrena o còpia fotoquímica?',
    'classics_edition_body': 'Una reestrena retorna una pel·lícula als cinemes. Una restauració es refereix al treball sobre la imatge o el so. L’etiqueta 4K descriu la resolució de presentació; 35mm i 70mm descriuen formats fotoquímics. No són equivalents. Mostrem les etiquetes de cada sessió i no prometem una restauració, muntatge o còpia concrets sense una font que els identifiqui.',
    'classics_plan_title': 'Com triar una sessió de repertori',
    'classics_plan_body': 'Comença per l’any original per distingir remakes i comprova àudio i subtítols. Consulta si hi ha presentació, col·loqui o programa doble abans d’organitzar la tarda. Un cicle anunciat pot incloure pel·lícules sense data confirmada; aquí només s’ofereixen com a opcions les sessions futures recollides.',
    'eixample': 'Cinema en versió original a l’Eixample: cinemes i cartellera',
    'eixample_intro': 'Consulta sessions en versió original en cinc cinemes de l’Eixample revisats del {date} al {end}, Europe/Madrid. Explora per barri: Sagrada Família, Dreta de l’Eixample, Antiga Esquerra, Sant Antoni i Nova Esquerra. Cada sessió mostra per separat àudio i subtítols.',
    'eixample_description': 'Compara Phenomena, Cinemes Girona, Aribau, Renoir Floridablanca i Arenas, amb barris de l’Eixample, adreces i sessions en versió original.',
    'sagrada-familia': 'Sagrada Família · Phenomena', 'dreta': 'Dreta de l’Eixample · Cinemes Girona',
    'antiga-esquerra': 'Antiga Esquerra · Mooby Aribau', 'sant-antoni': 'Sant Antoni · Renoir Floridablanca',
    'nova-esquerra': 'Nova Esquerra · Mooby Arenas',
    'eixample_venues': 'Cinc cinemes repartits per l’Eixample',
    'eixample_places': 'Són zones diferents d’un districte ampli. Consulta l’adreça exacta i les indicacions del cinema abans de triar sessió; pertànyer al mateix districte no permet calcular un trajecte a peu.',
    'eixample_aribau': 'Aribau Cinema és la sala 5 de Mooby Aribau. Una sessió en una altra sala del complex no hereta l’equipament de la sala 5.',
    'eixample_method': 'La pertinença al districte i els noms dels barris es verifiquen a les fitxes de l’Ajuntament de Barcelona. Seleccionem set dies naturals locals en aquests cinc cinemes a partir del catàleg d’àudio original. Un monument proper o una adreça amb «Barcelona» no permeten incloure un altre cinema. L’àudio desconegut continua sense confirmar; VOSE no vol dir anglès.',
    'discounts': 'Dies de descompte als cinemes de Barcelona: ofertes i condicions',
    'discounts_heading': 'Dies de descompte al cinema',
    'discounts_intro': 'Dilluns, dimecres i dijous són els dies barats: entrades des de 4,00 €.',
    'discounts_description': 'Compara dies de descompte, despeses de gestió i condicions de soci als cinemes de Barcelona, amb fonts oficials datades i programació en versió original.',
    'offers_reviewed': 'Revisat el', 'offer_sources': 'Fonts', 'offer_programme': 'Cartellera',
    'offer_days': ('Cada dia', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte', 'Diumenge'),
    'offer_months': ('gen', 'febr', 'març', 'abr', 'maig', 'juny', 'jul', 'ag', 'set', 'oct', 'nov', 'des'),
    'cinebaix-monday_body': 'No festius ni vigílies.',
    'renoir-days_body': '5,40 € en línia. No festius.',
    'verdi-monday_body': 'Socis d’Amics del Verdi: 5,40 €.',
    'malda-days_body': 'Val per a totes les pel·lícules del dia. Només a taquilla.',
    'girona-wednesday_body': 'No festius ni vigílies.',
    'zumzeig-wednesday_body': 'No festius.',
    'castellet-wednesday_body': '',
    'montcada-wednesday_body': '',
    'mooby-wednesday_body': 'No festius. 3D +2 €; Atmos i Infinity Vision +1 €.',
    'filmax-wednesday_body': '',
    'ocine-wednesday_body': '',
    'mataro-wednesday_body': 'En línia; 7,99 € a taquilla. No festius ni vigílies.',
    'sarria-wednesday_body': 'No festius.',
    'texas-thursday_body': '+1 € de gestió.',
    'filmax-thursday_body': 'No festius, 4DX ni ScreenX.',
    'mooby-thursday_body': 'No festius.',
    'filmoteca-daily_body': '',
    'bosque-vose_body': 'Només sessions VOSE.',
    'discount-screenings': 'Sessions en dia de descompte',
    'discount-screenings_note': 'Els pròxims set dies, als cinemes i dies de dalt.',
    'discounts_method': 'Les tarifes surten de la pàgina de preus de cada cinema. Mostrem les sessions de cada cinema en el seu dia de descompte, sense festius ni vigílies.',
 },
}
