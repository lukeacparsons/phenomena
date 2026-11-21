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
        'description': 'Search films and showtimes by title, cinema, date, language, rating or topic. Learn how filters and AI suggestions work, with examples you can try.',
        'intro': 'Use the search box to find films and showtimes. You can enter a title, actor, director, cinema, date, language or rating. You can also search by mood or topic, or ask for films similar to another film.',
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
            ('Subtitles', 'Audio and subtitles are separate. VOSI means English subtitles. Combine them to find a French-language screening with English subtitles.', ['English subtitles', 'foreign language films with English subtitles', 'in French with English subtitles']),
            ('Genre, length or rating', 'Choose a genre or length, or set a minimum rating. “IMDb >= 7.5” means at least 7.5 out of 10. “rt >= 80%” means a Rotten Tomatoes critics’ score of at least 80%.', ['comedy under two hours', 'IMDb >= 7.5', 'rt >= 80%']),
            ('Mood or topic', 'Enter a mood or subject. AI suggests films that may match.', ['something uplifting', 'films about friendship']),
            ('Similar films', 'Enter “something like” followed by a film title. That film does not need to be showing.', ['something like Dune', 'something like Amélie']),
        ],
        'how_title': 'How search works',
        'how': [
            ('Nearby results.', 'Films with the closest matching cinema appear first. Within each card’s day, cinemas are ordered by distance and show their distance from you or the chosen address. Showtimes stay in time order. Distances are approximate straight-line distances, not walking or driving routes. Cinemas without coordinates appear last with “Distance unavailable”.'),
            ('Location and sharing.', 'Device coordinates stay in this tab and are not included in shared links. A shared “near me” search uses the recipient’s location and permission. Typed addresses are sent to the address lookup service and remain in the search link. If location is blocked or unavailable, enter an address instead. Remove the location label to restore normal ordering.'),
            ('Film and screening details.', 'Search checks titles, names, dates, ratings and other details against the site’s film and screening data.'),
            ('AI suggestions.', 'AI interprets more complex requests and suggests films using descriptions, themes and its knowledge of films.'),
            ('Results.', 'Results show films with matching upcoming screenings. Filters such as language, rating and start time also apply to AI suggestions.'),
        ],
        'control_title': 'Change or share a search',
        'control': 'The labels below the search box show active filters. Select a label’s × button to remove that filter. Use the date and cinema controls to change those selections. Copy the page address to share the search.',
        'limits': 'AI suggestions may not match what you intended. Films with missing details may be excluded by filters. If you get no results, remove a filter or try another date.',
        'booking': 'Select a film to read its details. Select a showtime to see the cinema’s official ticket link.',
        'cta': 'Search films and showtimes',
    },
    'es': {
        'label': 'Cómo buscar',
        'title': 'Cómo buscar en VO Barna',
        'description': 'Busca películas y sesiones por título, cine, fecha, idioma, puntuación o tema. Consulta cómo funcionan los filtros y las sugerencias de IA, con ejemplos que puedes probar.',
        'intro': 'Usa el buscador para encontrar películas y sesiones. Puedes escribir un título, actor, director, cine, fecha, idioma o puntuación. También puedes buscar por estado de ánimo o tema, o pedir películas parecidas a otra.',
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
            ('Subtítulos', 'El audio y los subtítulos son datos distintos. VOSI indica subtítulos en inglés. Puedes combinar ambos idiomas.', ['subtítulos en inglés', 'en francés con subtítulos en inglés']),
            ('Género, duración o puntuación', 'Elige un género o una duración, o fija una puntuación mínima. «IMDb >= 7.5» significa al menos 7,5 sobre 10. «rt >= 80%» significa una puntuación de la crítica de Rotten Tomatoes de al menos el 80%.', ['comedia menos de dos horas', 'IMDb >= 7.5', 'rt >= 80%']),
            ('Estado de ánimo o tema', 'Escribe un estado de ánimo o un tema. La IA sugiere películas que pueden coincidir.', ['algo que me levante el ánimo', 'películas sobre la amistad']),
            ('Películas parecidas', 'Escribe «algo parecido a» seguido del título de una película. Esa película no tiene que estar en cartelera.', ['algo parecido a Dune', 'algo parecido a Amélie']),
        ],
        'how_title': 'Cómo funciona la búsqueda',
        'how': [
            ('Resultados cercanos.', 'Las películas con el cine más próximo que cumple los filtros aparecen primero. Dentro de cada día de la tarjeta, los cines se ordenan por distancia y muestran su distancia desde tu ubicación o la dirección elegida. Las sesiones siguen en orden horario. Son distancias aproximadas en línea recta, no rutas a pie ni en coche. Los cines sin coordenadas aparecen al final con «Distancia no disponible».'),
            ('Ubicación y enlaces.', 'Las coordenadas del dispositivo se quedan en esta pestaña y no se incluyen en los enlaces compartidos. Al compartir «cerca de mí», se utiliza la ubicación y el permiso de quien abre el enlace. Las direcciones escritas se envían al servicio de búsqueda de direcciones y quedan en el enlace. Si la ubicación está bloqueada o no está disponible, escribe una dirección. Quita la etiqueta de ubicación para recuperar el orden habitual.'),
            ('Datos de películas y sesiones.', 'La búsqueda compara títulos, nombres, fechas, puntuaciones y otros detalles con los datos del sitio.'),
            ('Sugerencias de IA.', 'La IA interpreta peticiones más complejas y sugiere películas a partir de descripciones, temas y sus conocimientos de cine.'),
            ('Resultados.', 'Los resultados muestran películas con próximas sesiones que cumplen la búsqueda. Los filtros de idioma, puntuación y hora de inicio también se aplican a las sugerencias de IA.'),
        ],
        'control_title': 'Cambiar o compartir una búsqueda',
        'control': 'Las etiquetas bajo el buscador muestran los filtros activos. Selecciona el botón × de una etiqueta para quitar ese filtro. Usa los controles de fecha y cine para cambiar esas selecciones. Copia la dirección de la página para compartir la búsqueda.',
        'limits': 'Las sugerencias de IA pueden no coincidir con lo que buscabas. Los filtros pueden excluir películas con datos incompletos. Si no hay resultados, quita un filtro o prueba otra fecha.',
        'booking': 'Selecciona una película para leer sus detalles. Selecciona una sesión para ver el enlace oficial de entradas del cine.',
        'cta': 'Buscar películas y sesiones',
    },
    'ca': {
        'label': 'Com cercar',
        'title': 'Com cercar a VO Barna',
        'description': 'Cerca pel·lícules i sessions per títol, cinema, data, idioma, puntuació o tema. Consulta com funcionen els filtres i els suggeriments d’IA, amb exemples que pots provar.',
        'intro': 'Fes servir el cercador per trobar pel·lícules i sessions. Pots escriure un títol, actor, director, cinema, data, idioma o puntuació. També pots cercar per estat d’ànim o tema, o demanar pel·lícules semblants a una altra.',
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
            ('Subtítols', 'L’àudio i els subtítols són dades diferents. VOSI indica subtítols en anglès. Pots combinar tots dos idiomes.', ['subtítols en anglès', 'en francès amb subtítols en anglès']),
            ('Gènere, durada o puntuació', 'Tria un gènere o una durada, o fixa una puntuació mínima. «IMDb >= 7.5» vol dir almenys 7,5 sobre 10. «rt >= 80%» vol dir una puntuació de la crítica de Rotten Tomatoes d’almenys el 80%.', ['comèdia menys de dues hores', 'IMDb >= 7.5', 'rt >= 80%']),
            ('Estat d’ànim o tema', 'Escriu un estat d’ànim o un tema. La IA suggereix pel·lícules que hi poden coincidir.', ['alguna cosa que m’animi', 'pel·lícules sobre l’amistat']),
            ('Pel·lícules semblants', 'Escriu «alguna cosa semblant a» seguit del títol d’una pel·lícula. Aquesta pel·lícula no ha de ser a la cartellera.', ['alguna cosa semblant a Dune', 'alguna cosa semblant a Amélie']),
        ],
        'how_title': 'Com funciona la cerca',
        'how': [
            ('Resultats propers.', 'Les pel·lícules amb el cinema més proper que compleix els filtres apareixen primer. Dins de cada dia de la targeta, els cinemes s’ordenen per distància i mostren la distància des de la teva ubicació o l’adreça triada. Les sessions segueixen en ordre horari. Són distàncies aproximades en línia recta, no rutes a peu ni en cotxe. Els cinemes sense coordenades apareixen al final amb «Distància no disponible».'),
            ('Ubicació i enllaços.', 'Les coordenades del dispositiu es queden en aquesta pestanya i no s’inclouen als enllaços compartits. En compartir «a prop meu», s’utilitzen la ubicació i el permís de qui obre l’enllaç. Les adreces escrites s’envien al servei de cerca d’adreces i queden a l’enllaç. Si la ubicació està bloquejada o no està disponible, escriu una adreça. Treu l’etiqueta d’ubicació per recuperar l’ordre habitual.'),
            ('Dades de pel·lícules i sessions.', 'La cerca compara títols, noms, dates, puntuacions i altres detalls amb les dades del lloc.'),
            ('Suggeriments d’IA.', 'La IA interpreta peticions més complexes i suggereix pel·lícules a partir de descripcions, temes i els seus coneixements de cinema.'),
            ('Resultats.', 'Els resultats mostren pel·lícules amb pròximes sessions que compleixen la cerca. Els filtres d’idioma, puntuació i hora d’inici també s’apliquen als suggeriments d’IA.'),
        ],
        'control_title': 'Canviar o compartir una cerca',
        'control': 'Les etiquetes sota el cercador mostren els filtres actius. Selecciona el botó × d’una etiqueta per treure aquell filtre. Fes servir els controls de data i cinema per canviar aquestes seleccions. Copia l’adreça de la pàgina per compartir la cerca.',
        'limits': 'Els suggeriments d’IA poden no coincidir amb el que cercaves. Els filtres poden excloure pel·lícules amb dades incompletes. Si no hi ha resultats, treu un filtre o prova una altra data.',
        'booking': 'Selecciona una pel·lícula per llegir-ne els detalls. Selecciona una sessió per veure l’enllaç oficial d’entrades del cinema.',
        'cta': 'Cercar pel·lícules i sessions',
    },
}


EXPANDED_EXAMPLES = {
    'en': [
        ('Fit your available time', 'Finish times add the running time and a 20-minute allowance to the advertised start. Events can take longer.', ['finishes before 22:00', 'starts in the next 45 minutes']),
        ('Alternatives and preferences', 'Each alternative must match one screening. Preferences put your preferred choices first.', ['Friday at Verdi or Saturday at Phenomena', 'English preferred, Spanish acceptable']),
        ('Budget and seats', 'Budget filters use comparable published admission before unconfirmed fees. Seat counts must be recent. A total count cannot confirm seats together.', ['under €10', 'free screenings', 'not sold out']),
        ('Distance limits', 'A distance limit uses your location and measures a straight line. It is not a walking or driving time.', ['within 2 km']),
        ('Events, credits and editions', 'These searches require published event labels or sourced film credits. Missing evidence is explained.', ['director Q&A', 'restored version', 'Palme d’Or winners', 'other films by the director of Amélie']),
        ('Cinema questions and past screenings', 'Venue answers include sources and remaining checks. Historical searches cover retained schedules only.', ['Can I bring a backpack to Verdi?', 'what played yesterday']),
        ('Plan a film outing', 'Find two or three different films at one cinema with time between them. Finish times remain estimates.', ['two films Sunday with a dinner break']),
    ],
    'es': [
        ('Encajar en tu horario', 'El final suma la duración y un margen de 20 minutos a la hora anunciada. Los eventos pueden durar más.', ['termina antes de las 22:00', 'dentro de 45 minutos']),
        ('Alternativas y preferencias', 'Cada alternativa debe cumplirse en una misma sesión. Las preferencias ordenan las opciones.', ['viernes en Verdi o sábado en Phenomena', 'prefiero inglés pero español está bien']),
        ('Presupuesto y plazas', 'Se comparan precios publicados de entrada antes de gastos no confirmados. Las plazas deben tener una observación reciente; un total no confirma asientos juntos.', ['menos de 10 euros', 'entrada gratuita', 'con entradas disponibles']),
        ('Límite de distancia', 'La distancia usa tu ubicación y se mide en línea recta. No es tiempo de viaje.', ['a menos de 2 km']),
        ('Eventos, créditos y ediciones', 'Estas búsquedas requieren datos publicados de la sesión o créditos con fuentes.', ['coloquio', 'restaurada', 'ganadoras de la Palma de Oro']),
        ('Preguntas del cine e historial', 'Las respuestas incluyen fuentes y comprobaciones pendientes. El historial solo contiene horarios conservados.', ['¿Puedo llevar una mochila a Verdi?', 'qué proyectaron ayer']),
        ('Planear una salida', 'Busca dos o tres películas distintas en un mismo cine, con una pausa entre ellas. El final es estimado.', ['dos películas domingo con una pausa para cenar']),
    ],
    'ca': [
        ('Encaixar en el teu horari', 'El final suma la durada i un marge de 20 minuts a l’hora anunciada. Els esdeveniments poden durar més.', ['acaba abans de les 22:00', 'en els propers 45 minuts']),
        ('Alternatives i preferències', 'Cada alternativa s’ha de complir en una mateixa sessió. Les preferències ordenen les opcions.', ['divendres a Verdi o dissabte a Phenomena', 'preferiblement anglès però castellà també va bé']),
        ('Pressupost i places', 'Es comparen preus publicats d’entrada abans de despeses no confirmades. Les places han de tenir una observació recent; un total no confirma seients junts.', ['menys de 10 euros', 'entrada gratuïta', 'amb entrades disponibles']),
        ('Límit de distància', 'La distància fa servir la teva ubicació i es mesura en línia recta. No és temps de viatge.', ['a menys de 2 km']),
        ('Esdeveniments, crèdits i edicions', 'Aquestes cerques requereixen dades publicades de la sessió o crèdits amb fonts.', ['col·loqui', 'restaurada', 'guanyadores de la Palma d’Or']),
        ('Preguntes del cinema i historial', 'Les respostes inclouen fonts i comprovacions pendents. L’historial només conté horaris conservats.', ['Puc portar una motxilla a Verdi?', 'què es va projectar ahir']),
        ('Planificar una sortida', 'Cerca dues o tres pel·lícules diferents en un mateix cinema, amb una pausa entre elles. El final és estimat.', ['dues pel·lícules diumenge amb una pausa per sopar']),
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
