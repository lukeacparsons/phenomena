"""Public, localized search guide. Examples use the listing's shareable query URL."""
from html import escape
from urllib.parse import urlencode


PATHS = {
    'en': '/en/guides/how-to-search/',
    'es': '/es/guias/como-buscar/',
    'ca': '/ca/guies/com-cercar/',
}

COPY = {
    'en': {
        'label': 'How to search',
        'title': 'How to search VO Barna',
        'description': 'Find films by time, language, subtitles, rating, budget or location. Try searches for nearby cinemas, available seats and a two-film outing.',
        'intro': 'Describe the film or cinema visit you want. Combine a title, mood or topic with your language, dates, available time, budget and location. You can also compare alternatives, ask a cinema question or plan two films in one visit.',
        'feature_title': 'Combine filters',
        'feature_query': 'comedy in English tomorrow after 20:00 under two hours',
        'feature_body': 'This search finds comedies with English audio, under two hours long, showing tomorrow after 20:00.',
        'try': 'Try this search',
        'examples_title': 'Search examples',
        'examples_intro': 'Select an example to run it, then edit the search text if needed. You can write in English, Spanish or Catalan.',
        'examples': [
            ('Title, actor or director', 'Enter a film title or the name of an actor or director.', ['Dune', 'Pedro Almodóvar']),
            ('Cinema, date or format', 'Limit results to a cinema, a day or a format such as IMAX.', ['Balmes tomorrow', 'IMAX this weekend']),
            ('Nearby cinemas or an address', 'Enter “near me” and allow location access when your browser asks. You can also enter “near” followed by an address, or just the address. You can also type a Barcelona neighbourhood or landmark, such as “poblesec”; AI recognizes the place and starts a nearby search. Include the city for addresses; choose a place if several match.', ['near me', 'poblesec', 'near this address: Carrer de Balmes 422, Barcelona', 'Carrer de Girona 175, Barcelona', 'comedy tomorrow near me']),
            ('Audio language or country', '“In French” searches for French audio. “From France” searches for French productions, including co-productions.', ['in French', 'from France']),
            ('Subtitles', 'Audio and subtitles are separate. VOSI means English subtitles. “Foreign language films” requires non-English dialogue, but can include multilingual films with English. “No subtitles” needs an explicit source label; missing information is not enough.', ['English subtitles', 'foreign language films with English subtitles', 'in French with English subtitles', 'no subtitles']),
            ('Genre, length or rating', 'Choose a genre or length, or set a minimum rating. “IMDb >= 7.5” means at least 7.5 out of 10. “rt >= 80%” means a Rotten Tomatoes critics’ score of at least 80%.', ['comedy under two hours', 'IMDb >= 7.5', 'rt >= 80%']),
            ('Mood or topic', 'Enter a mood or subject. AI suggests films that may match.', ['something uplifting', 'films about friendship']),
            ('Similar films', 'Enter “something like” followed by a film title. That film does not need to be showing.', ['something like Dune', 'something like Amélie']),
        ],
        'how_title': 'How search works',
        'how': [
            ('Nearby results.', 'Films with the closest matching cinema appear first. Within each card’s day, cinemas are ordered by distance and show their distance from you or the chosen address. Showtimes stay in time order. Distances are approximate straight-line distances, not walking or driving routes. Cinemas without coordinates appear last with “Distance unavailable”.'),
            ('Location and sharing.', 'Device coordinates stay in this tab and are not included in shared links. A shared “near me” search uses the recipient’s location and permission. Typed addresses are sent to the address lookup service and remain in the search link. If location is blocked or unavailable, enter an address instead. Remove the location label to restore normal ordering.'),
            ('One matching screening.', 'Every required condition must apply to the same screening. Each alternative is checked as a complete group. Preferences change the order of eligible results without dropping required conditions.'),
            ('AI suggestions.', 'AI interprets more complex requests and suggests films using descriptions, themes and its knowledge of films. Required language, rating, time and other conditions still apply.'),
            ('Results and history.', 'Results normally show upcoming screenings. An explicit request such as “what played yesterday” searches retained past schedules instead. History is incomplete and past screenings have no ticket action. Search cannot predict a film’s return or when booking will open.'),
        ],
        'control_title': 'Change or share a search',
        'control': 'The labels below the search box show the interpretation, including filters, alternatives, preferences and outing plans. Select a label’s × button to remove it. Use the date and cinema controls to change those selections. Copy the page address to share the search, including removed filters.',
        'limits': 'AI suggestions are approximate. Required facts need evidence: missing prices, subtitle information, age classifications, content warnings or room facilities do not establish a match. Search explains missing coverage and may offer an alternative with a clearly removed condition; it never relaxes your search silently. If there are no matches, remove a filter or try another date.',
        'booking': 'Select a film to read its details. Select a showtime to see the cinema’s official ticket link.',
        'cta': 'Search films and showtimes',
    },
    'es': {
        'label': 'Cómo buscar',
        'title': 'Cómo buscar en VO Barna',
        'description': 'Busca cine por horario, idioma, subtítulos, puntuación, presupuesto o ubicación. Prueba ejemplos para encontrar plazas y combinar dos películas.',
        'intro': 'Describe la película o la salida al cine que buscas. Combina un título, estado de ánimo o tema con el idioma, las fechas, tu horario, presupuesto y ubicación. También puedes comparar alternativas, preguntar sobre un cine o planear dos películas en una visita.',
        'feature_title': 'Combinar filtros',
        'feature_query': 'comedia en inglés mañana después de las 20:00 menos de dos horas',
        'feature_body': 'Esta búsqueda encuentra comedias con audio en inglés, de menos de dos horas, con sesiones mañana después de las 20:00.',
        'try': 'Probar esta búsqueda',
        'examples_title': 'Ejemplos de búsqueda',
        'examples_intro': 'Selecciona un ejemplo para buscar y modifica el texto si lo necesitas. Puedes escribir en castellano, catalán o inglés.',
        'examples': [
            ('Título, actor o director', 'Escribe el título de una película o el nombre de un actor o director.', ['Dune', 'Pedro Almodóvar']),
            ('Cine, fecha o formato', 'Limita los resultados a un cine, un día o un formato como IMAX.', ['Balmes mañana', 'IMAX este fin de semana']),
            ('Cines cercanos o una dirección', 'Escribe «cerca de mí» y permite el acceso a tu ubicación cuando el navegador lo solicite. También puedes escribir «cerca de» seguido de una dirección, o solo la dirección. También puedes escribir un barrio o lugar de Barcelona, como «poblesec»; la IA lo reconoce e inicia una búsqueda cercana. Incluye la ciudad en las direcciones; elige un lugar si hay varias coincidencias.', ['cerca de mí', 'poblesec', 'cerca de esta dirección: Carrer de Balmes 422, Barcelona', 'Carrer de Girona 175, Barcelona', 'comedia mañana cerca de mí']),
            ('Idioma del audio o país', '«En francés» busca audio en francés. «De Francia» busca producciones francesas, incluidas las coproducciones.', ['en francés', 'de Francia']),
            ('Subtítulos', 'El audio y los subtítulos son datos distintos. VOSI indica subtítulos en inglés. “Idiomas distintos del inglés” requiere diálogo en otro idioma, aunque también puede haber inglés. “Sin subtítulos” necesita una indicación explícita de la fuente; la falta de datos no basta.', ['subtítulos en inglés', 'en francés con subtítulos en inglés', 'sin subtítulos']),
            ('Género, duración o puntuación', 'Elige un género o una duración, o fija una puntuación mínima. «IMDb >= 7.5» significa al menos 7,5 sobre 10. «rt >= 80%» significa una puntuación de la crítica de Rotten Tomatoes de al menos el 80%.', ['comedia menos de dos horas', 'IMDb >= 7.5', 'rt >= 80%']),
            ('Estado de ánimo o tema', 'Escribe un estado de ánimo o un tema. La IA sugiere películas que pueden coincidir.', ['algo que me levante el ánimo', 'películas sobre la amistad']),
            ('Películas parecidas', 'Escribe «algo parecido a» seguido del título de una película. Esa película no tiene que estar en cartelera.', ['algo parecido a Dune', 'algo parecido a Amélie']),
        ],
        'how_title': 'Cómo funciona la búsqueda',
        'how': [
            ('Resultados cercanos.', 'Las películas con el cine más próximo que cumple los filtros aparecen primero. Dentro de cada día de la tarjeta, los cines se ordenan por distancia y muestran su distancia desde tu ubicación o la dirección elegida. Las sesiones siguen en orden horario. Son distancias aproximadas en línea recta, no rutas a pie ni en coche. Los cines sin coordenadas aparecen al final con «Distancia no disponible».'),
            ('Ubicación y enlaces.', 'Las coordenadas del dispositivo se quedan en esta pestaña y no se incluyen en los enlaces compartidos. Al compartir «cerca de mí», se utiliza la ubicación y el permiso de quien abre el enlace. Las direcciones escritas se envían al servicio de búsqueda de direcciones y quedan en el enlace. Si la ubicación está bloqueada o no está disponible, escribe una dirección. Quita la etiqueta de ubicación para recuperar el orden habitual.'),
            ('Una misma sesión.', 'Todas las condiciones obligatorias deben cumplirse en una misma sesión. Cada alternativa se comprueba como un grupo completo. Las preferencias ordenan los resultados válidos sin eliminar condiciones obligatorias.'),
            ('Sugerencias de IA.', 'La IA interpreta peticiones más complejas y sugiere películas a partir de descripciones, temas y sus conocimientos de cine. Las condiciones obligatorias de idioma, puntuación, horario y otros datos siguen aplicándose.'),
            ('Resultados e historial.', 'Normalmente se muestran próximas sesiones. Una petición explícita como «qué proyectaron ayer» busca en los horarios pasados conservados. El historial es incompleto y las sesiones pasadas no ofrecen compra de entradas. No se predicen reposiciones ni fechas de apertura de ventas.'),
        ],
        'control_title': 'Cambiar o compartir una búsqueda',
        'control': 'Las etiquetas bajo el buscador muestran la interpretación: filtros, alternativas, preferencias y planes de cine. Selecciona el botón × de una etiqueta para quitarla. Usa los controles de fecha y cine para cambiar esas selecciones. Copia la dirección de la página para compartir la búsqueda, incluidos los filtros eliminados.',
        'limits': 'Las sugerencias de IA son aproximadas. Las condiciones obligatorias requieren datos: la falta de precios, subtítulos, clasificación por edad, advertencias de contenido o instalaciones de la sala no confirma una coincidencia. El buscador explica los datos que faltan y puede ofrecer una alternativa indicando qué condición elimina; nunca la elimina sin avisar. Si no hay resultados, quita un filtro o prueba otra fecha.',
        'booking': 'Selecciona una película para leer sus detalles. Selecciona una sesión para ver el enlace oficial de entradas del cine.',
        'cta': 'Buscar películas y sesiones',
    },
    'ca': {
        'label': 'Com cercar',
        'title': 'Com cercar a VO Barna',
        'description': 'Cerca cinema per horari, idioma, subtítols, puntuació, pressupost o ubicació. Prova exemples per trobar places i combinar dues pel·lícules.',
        'intro': 'Descriu la pel·lícula o la sortida al cinema que busques. Combina un títol, estat d’ànim o tema amb l’idioma, les dates, el teu horari, pressupost i ubicació. També pots comparar alternatives, preguntar sobre un cinema o planificar dues pel·lícules en una visita.',
        'feature_title': 'Combinar filtres',
        'feature_query': 'comèdia en anglès demà després de les 20:00 menys de dues hores',
        'feature_body': 'Aquesta cerca troba comèdies amb àudio en anglès, de menys de dues hores, amb sessions demà després de les 20:00.',
        'try': 'Prova aquesta cerca',
        'examples_title': 'Exemples de cerca',
        'examples_intro': 'Selecciona un exemple per cercar i modifica el text si cal. Pots escriure en català, castellà o anglès.',
        'examples': [
            ('Títol, actor o director', 'Escriu el títol d’una pel·lícula o el nom d’un actor o director.', ['Dune', 'Pedro Almodóvar']),
            ('Cinema, data o format', 'Limita els resultats a un cinema, un dia o un format com IMAX.', ['Balmes demà', 'IMAX aquest cap de setmana']),
            ('Cinemes propers o una adreça', 'Escriu «a prop meu» i permet l’accés a la ubicació quan el navegador ho demani. També pots escriure «a prop de» seguit d’una adreça, o només l’adreça. També pots escriure un barri o lloc de Barcelona, com «poblesec»; la IA el reconeix i inicia una cerca propera. Inclou la ciutat a les adreces; tria un lloc si hi ha diverses coincidències.', ['a prop meu', 'poblesec', 'a prop d’aquesta adreça: Carrer de Balmes 422, Barcelona', 'Carrer de Girona 175, Barcelona', 'comèdia demà a prop meu']),
            ('Idioma de l’àudio o país', '«En francès» cerca àudio en francès. «De França» cerca produccions franceses, incloses les coproduccions.', ['en francès', 'de França']),
            ('Subtítols', 'L’àudio i els subtítols són dades diferents. VOSI indica subtítols en anglès. “Idiomes diferents de l’anglès” requereix diàleg en un altre idioma, encara que també hi pot haver anglès. “Sense subtítols” necessita una indicació explícita de la font; la manca de dades no és suficient.', ['subtítols en anglès', 'en francès amb subtítols en anglès', 'sense subtítols']),
            ('Gènere, durada o puntuació', 'Tria un gènere o una durada, o fixa una puntuació mínima. «IMDb >= 7.5» vol dir almenys 7,5 sobre 10. «rt >= 80%» vol dir una puntuació de la crítica de Rotten Tomatoes d’almenys el 80%.', ['comèdia menys de dues hores', 'IMDb >= 7.5', 'rt >= 80%']),
            ('Estat d’ànim o tema', 'Escriu un estat d’ànim o un tema. La IA suggereix pel·lícules que hi poden coincidir.', ['alguna cosa que m’animi', 'pel·lícules sobre l’amistat']),
            ('Pel·lícules semblants', 'Escriu «alguna cosa semblant a» seguit del títol d’una pel·lícula. Aquesta pel·lícula no ha de ser a la cartellera.', ['alguna cosa semblant a Dune', 'alguna cosa semblant a Amélie']),
        ],
        'how_title': 'Com funciona la cerca',
        'how': [
            ('Resultats propers.', 'Les pel·lícules amb el cinema més proper que compleix els filtres apareixen primer. Dins de cada dia de la targeta, els cinemes s’ordenen per distància i mostren la distància des de la teva ubicació o l’adreça triada. Les sessions segueixen en ordre horari. Són distàncies aproximades en línia recta, no rutes a peu ni en cotxe. Els cinemes sense coordenades apareixen al final amb «Distància no disponible».'),
            ('Ubicació i enllaços.', 'Les coordenades del dispositiu es queden en aquesta pestanya i no s’inclouen als enllaços compartits. En compartir «a prop meu», s’utilitzen la ubicació i el permís de qui obre l’enllaç. Les adreces escrites s’envien al servei de cerca d’adreces i queden a l’enllaç. Si la ubicació està bloquejada o no està disponible, escriu una adreça. Treu l’etiqueta d’ubicació per recuperar l’ordre habitual.'),
            ('Una mateixa sessió.', 'Totes les condicions obligatòries s’han de complir en una mateixa sessió. Cada alternativa es comprova com un grup complet. Les preferències ordenen els resultats vàlids sense eliminar condicions obligatòries.'),
            ('Suggeriments d’IA.', 'La IA interpreta peticions més complexes i suggereix pel·lícules a partir de descripcions, temes i els seus coneixements de cinema. Les condicions obligatòries d’idioma, puntuació, horari i altres dades continuen aplicant-se.'),
            ('Resultats i historial.', 'Normalment es mostren pròximes sessions. Una petició explícita com «què es va projectar ahir» cerca en els horaris passats conservats. L’historial és incomplet i les sessions passades no ofereixen compra d’entrades. No es prediuen reposicions ni dates d’obertura de vendes.'),
        ],
        'control_title': 'Canviar o compartir una cerca',
        'control': 'Les etiquetes sota el cercador mostren la interpretació: filtres, alternatives, preferències i plans de cinema. Selecciona el botó × d’una etiqueta per treure-la. Fes servir els controls de data i cinema per canviar aquestes seleccions. Copia l’adreça de la pàgina per compartir la cerca, inclosos els filtres eliminats.',
        'limits': 'Els suggeriments d’IA són aproximats. Les condicions obligatòries requereixen dades: la manca de preus, subtítols, classificació per edat, advertiments de contingut o instal·lacions de la sala no confirma una coincidència. El cercador explica les dades que falten i pot oferir una alternativa indicant quina condició elimina; mai no l’elimina sense avisar. Si no hi ha resultats, treu un filtre o prova una altra data.',
        'booking': 'Selecciona una pel·lícula per llegir-ne els detalls. Selecciona una sessió per veure l’enllaç oficial d’entrades del cinema.',
        'cta': 'Cercar pel·lícules i sessions',
    },
}


EXPANDED_EXAMPLES = {
    'en': [
        ('Fit your available time', 'A published end time takes priority. Otherwise, the finish estimate adds the running time and 20 minutes for trailers and adverts to the advertised start. Unknown runtimes cannot meet a finish limit. “Tonight” means starts from 18:00.', ['finishes before 22:00', 'starts in the next 45 minutes']),
        ('Alternatives and preferences', 'Each alternative must match one screening. Preferences put your preferred choices first.', ['Friday at Verdi or Saturday at Phenomena', 'English preferred, Spanish acceptable']),
        ('Budget and seats', 'Budgets use published general admission, an event price or explicitly free entry. Member discounts and unlabelled minimum prices do not qualify; fees may be unknown. Seat counts must be recent. Adjacent seats cannot currently be confirmed.', ['under €10', 'free screenings', 'not sold out']),
        ('Distance limits', 'A distance limit needs your location or a chosen address and measures a straight line, not a walking or driving time.', ['within 2 km']),
        ('Production and distribution', 'A company name matches production or distribution credits. Specify the role when it matters; these credits do not necessarily identify the Spanish distributor.', ['A24', 'produced by A24', 'distributed by A24']),
        ('Release years and black-and-white films', 'Release years refer to the original film, not its story setting. “New releases” means this calendar year, not a recent opening in Spain. Black-and-white searches require verified colour information.', ['70s released', 'new releases', 'black and white']),
        ('Events, credits and editions', 'These searches require published event labels or sourced film credits. Missing evidence is explained.', ['director Q&A', 'restored version', 'Palme d’Or winners', 'other films by the director of Amélie']),
        ('Cinema questions and past screenings', 'Venue answers include sources, review dates and remaining checks. Building information does not guarantee a particular room’s accessibility. Historical searches cover retained schedules only.', ['Can I bring a backpack to Verdi?', 'what played yesterday']),
        ('Plan a film outing', 'Find two or three different films on the same day at one cinema. Plans allow at least 30 minutes between films, or 90 minutes for dinner, and at most three hours. Estimated finishes already include 20 minutes for trailers and adverts; the break is separate. Trips between cinemas are not planned.', ['two films Sunday with a dinner break']),
    ],
    'es': [
        ('Encajar en tu horario', 'Se prioriza una hora de final publicada. Si no existe, se estima sumando la duración y 20 minutos para tráileres y anuncios a la hora anunciada. Sin duración conocida no se cumple un límite de final. «Esta noche» significa desde las 18:00.', ['termina antes de las 22:00', 'dentro de 45 minutos']),
        ('Alternativas y preferencias', 'Cada alternativa debe cumplirse en una misma sesión. Las preferencias ordenan las opciones.', ['viernes en Verdi o sábado en Phenomena', 'prefiero inglés pero español está bien']),
        ('Presupuesto y plazas', 'Se usa la entrada general publicada, un precio del evento o una entrada explícitamente gratuita. Los descuentos de socios y mínimos sin identificar no bastan; los gastos pueden ser desconocidos. Las plazas deben tener una observación reciente. Actualmente no se pueden confirmar asientos juntos.', ['menos de 10 euros', 'entrada gratuita', 'con entradas disponibles']),
        ('Límite de distancia', 'Necesita tu ubicación o una dirección elegida. Se mide en línea recta, no en tiempo a pie o en coche.', ['a menos de 2 km']),
        ('Producción y distribución', 'El nombre de una empresa busca créditos de producción o distribución. Indica el papel si es relevante; estos créditos no identifican necesariamente al distribuidor en España.', ['A24', 'producida por A24', 'distribuida por A24']),
        ('Año de estreno y blanco y negro', 'El año es el del estreno original, no la época de la historia. «Estrenos» significa este año natural, no un estreno reciente en España. El blanco y negro requiere datos verificados de color.', ['estrenos', 'blanco y negro']),
        ('Eventos, créditos y ediciones', 'Estas búsquedas requieren datos publicados de la sesión o créditos con fuentes.', ['coloquio', 'restaurada', 'ganadoras de la Palma de Oro']),
        ('Preguntas del cine e historial', 'Las respuestas incluyen fuentes, fechas de revisión y comprobaciones pendientes. La información del edificio no garantiza la accesibilidad de una sala concreta. El historial solo contiene horarios conservados.', ['¿Puedo llevar una mochila a Verdi?', 'qué proyectaron ayer']),
        ('Planear una salida', 'Busca dos o tres películas distintas el mismo día en un cine. Se dejan al menos 30 minutos entre películas, o 90 para cenar, y como máximo tres horas. El final estimado ya incluye 20 minutos para tráileres y anuncios; la pausa es aparte. No se planean viajes entre cines.', ['dos películas domingo con una pausa para cenar']),
    ],
    'ca': [
        ('Encaixar en el teu horari', 'Es prioritza una hora de final publicada. Si no n’hi ha, s’estima sumant la durada i 20 minuts per a tràilers i anuncis a l’hora anunciada. Sense durada coneguda no es compleix un límit de final. «Aquesta nit» significa des de les 18:00.', ['acaba abans de les 22:00', 'en els propers 45 minuts']),
        ('Alternatives i preferències', 'Cada alternativa s’ha de complir en una mateixa sessió. Les preferències ordenen les opcions.', ['divendres a Verdi o dissabte a Phenomena', 'preferiblement anglès però castellà també va bé']),
        ('Pressupost i places', 'Es fa servir l’entrada general publicada, un preu de l’esdeveniment o una entrada explícitament gratuïta. Els descomptes de socis i mínims sense identificar no són suficients; les despeses poden ser desconegudes. Les places han de tenir una observació recent. Actualment no es poden confirmar seients junts.', ['menys de 10 euros', 'entrada gratuïta', 'amb entrades disponibles']),
        ('Límit de distància', 'Necessita la teva ubicació o una adreça triada. Es mesura en línia recta, no en temps a peu o en cotxe.', ['a menys de 2 km']),
        ('Producció i distribució', 'El nom d’una empresa cerca crèdits de producció o distribució. Indica el paper si és rellevant; aquests crèdits no identifiquen necessàriament el distribuïdor a Espanya.', ['A24', 'produïda per A24', 'distribuïda per A24']),
        ('Any d’estrena i blanc i negre', 'L’any és el de l’estrena original, no l’època de la història. «Novetats» significa aquest any natural, no una estrena recent a Espanya. El blanc i negre requereix dades verificades de color.', ['novetats', 'blanc i negre']),
        ('Esdeveniments, crèdits i edicions', 'Aquestes cerques requereixen dades publicades de la sessió o crèdits amb fonts.', ['col·loqui', 'restaurada', 'guanyadores de la Palma d’Or']),
        ('Preguntes del cinema i historial', 'Les respostes inclouen fonts, dates de revisió i comprovacions pendents. La informació de l’edifici no garanteix l’accessibilitat d’una sala concreta. L’historial només conté horaris conservats.', ['Puc portar una motxilla a Verdi?', 'què es va projectar ahir']),
        ('Planificar una sortida', 'Cerca dues o tres pel·lícules diferents el mateix dia en un cinema. Es deixen almenys 30 minuts entre pel·lícules, o 90 per sopar, i com a màxim tres hores. El final estimat ja inclou 20 minuts per a tràilers i anuncis; la pausa és a part. No es planifiquen viatges entre cinemes.', ['dues pel·lícules diumenge amb una pausa per sopar']),
    ],
}
for _language, _examples in EXPANDED_EXAMPLES.items():
    COPY[_language]['examples'].extend(_examples)


SUGGESTION_HELP = {
    'en': 'Select a suggested search below the box, or use Randomise for more ideas. Suggestions follow the site language and your browser language preferences. As you type, choose a menu suggestion or pause briefly to search automatically; Enter searches immediately. The × clears the query while keeping your selected dates, and Reset clears the filters.',
    'es': 'Selecciona una búsqueda sugerida debajo del cuadro o usa el botón aleatorio para ver más ideas. Las sugerencias siguen el idioma del sitio y las preferencias de idioma del navegador. Mientras escribes, elige una opción del menú o haz una breve pausa para buscar automáticamente; Intro busca al momento. La × borra la consulta conservando las fechas seleccionadas y Restablecer borra los filtros.',
    'ca': 'Selecciona una cerca suggerida sota el quadre o fes servir el botó aleatori per veure més idees. Els suggeriments segueixen l’idioma del lloc i les preferències d’idioma del navegador. Mentre escrius, tria una opció del menú o fes una pausa breu per cercar automàticament; Retorn cerca al moment. La × esborra la consulta conservant les dates seleccionades i Reinicia esborra els filtres.',
}


def render(lang):
    c = COPY[lang]

    def query_link(query, label=None, css='search-guide-query'):
        url = f'/{lang}/?' + urlencode({'q': query})
        return f'<a class="{css}" href="{escape(url, quote=True)}">{escape(label or query)}</a>'

    body = f'<article class="search-guide"><div class="search-guide-intro reading-wash"><h1>{escape(c["title"])}</h1><p class="site-intro">{escape(c["intro"])}</p><p>{escape(SUGGESTION_HELP[lang])}</p></div>'
    body += f'<section class="search-guide-feature reading-wash" aria-labelledby="search-plan"><h2 id="search-plan">{escape(c["feature_title"])}</h2>'
    body += query_link(c['feature_query']) + f'<p>{escape(c["feature_body"])}</p>'
    body += query_link(c['feature_query'], c['try'], 'text-action') + '</section>'
    body += f'<section aria-labelledby="search-examples"><h2 id="search-examples">{escape(c["examples_title"])}</h2><p>{escape(c["examples_intro"])}</p><div class="search-guide-examples">'
    for title, description, queries in c['examples']:
        body += f'<section class="content-block reading-wash"><h3>{escape(title)}</h3><p>{escape(description)}</p><ul>'
        body += ''.join('<li>' + query_link(query) + '</li>' for query in queries) + '</ul></section>'
    body += '</div></section>'
    body += f'<section class="search-guide-prose reading-wash" aria-labelledby="search-how"><h2 id="search-how">{escape(c["how_title"])}</h2>'
    body += ''.join(f'<p><strong>{escape(title)}</strong> {escape(description)}</p>' for title, description in c['how']) + '</section>'
    body += '<p class="source-note">© <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">OpenStreetMap</a></p>'
    body += f'<section class="search-guide-prose reading-wash" aria-labelledby="search-control"><h2 id="search-control">{escape(c["control_title"])}</h2>'
    body += ''.join(f'<p>{escape(c[key])}</p>' for key in ('control', 'limits', 'booking'))
    body += f'<a class="text-action" href="/{lang}/">{escape(c["cta"])}</a></section></article>'
    return body
