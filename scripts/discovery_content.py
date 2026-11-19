"""Reviewed routes, copy and conservative selections for discovery pages.

Language selection uses the session's audio/subtitle fields, independently.
Film nationality, titles, VO labels and unverified film metadata cannot qualify
an English-audio result. Preserve the source labels in the displayed facts.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from language_names import parse_languages, without_language_placeholder
from discovery_guides import COPY as GUIDE_COPY
from discovery_local import COPY as LOCAL_COPY, GRACIA_VENUES

MADRID = ZoneInfo('Europe/Madrid')
TODAY_PATHS = {'en': '/en/showtimes/today/', 'es': '/es/cartelera/hoy/', 'ca': '/ca/cartellera/avui/'}
PATHS = {
    'english': {'en': '/en/showtimes/english-language/', 'es': '/es/cartelera/peliculas-en-ingles/', 'ca': '/ca/cartellera/pellicules-en-angles/'},
    'subtitles': {'en': '/en/guides/english-subtitles-barcelona/', 'es': '/es/guias/cine-subtitulos-ingles-barcelona/', 'ca': '/ca/guies/cinema-subtitols-angles-barcelona/'},
    'weekend': {'en': '/en/showtimes/this-weekend/', 'es': '/es/cartelera/este-fin-de-semana/', 'ca': '/ca/cartellera/aquest-cap-de-setmana/'},
    'imax': {'en': '/en/guides/imax-original-version-barcelona/', 'es': '/es/guias/imax-version-original-barcelona/', 'ca': '/ca/guies/imax-versio-original-barcelona/'},
    'film': {'en': '/en/guides/35mm-70mm-barcelona/', 'es': '/es/guias/cine-35mm-70mm-barcelona/', 'ca': '/ca/guies/cinema-35mm-70mm-barcelona/'},
    'vosc': {'en': '/en/showtimes/catalan-subtitles/', 'es': '/es/cartelera/subtitulos-catalan/', 'ca': '/ca/cartellera/subtitols-catala/'},
    'gracia': {'en': '/en/guides/original-version-cinema-gracia/', 'es': '/es/guias/cine-version-original-gracia/', 'ca': '/ca/guies/cinema-versio-original-gracia/'},
}


def weekend_dates(now):
    """Friday–Sunday containing today, or the next Friday–Sunday on Mon–Thu."""
    today = now.astimezone(MADRID).date()
    friday = today + timedelta(days=4 - today.weekday())
    return tuple(friday + timedelta(days=i) for i in range(3))


def select_sessions(programme, kind, now):
    """Select from the validated original-audio programme, never venue equipment.

    One result set owns counts, visible facts and action destinations. Format
    tags must belong to the same session; film titles and room research do not
    qualify a result. Dual film-format sessions get one explicitly mixed group.
    """
    if kind not in (*PATHS, 'today'):
        raise ValueError(f'Unknown discovery kind: {kind}')
    today = now.astimezone(MADRID).date()
    end = today + timedelta(days=7)
    weekend = dict(zip(weekend_dates(now), ('friday', 'saturday', 'sunday')))
    keys = {'today': ('daytime', 'tonight'), 'english': ('english', 'multilingual'),
            'subtitles': ('subtitles',), 'weekend': ('friday', 'saturday', 'sunday'),
            'imax': ('imax',), 'film': ('35mm', '70mm', 'mixed-film'),
            'vosc': ('vosc',), 'gracia': ('gracia-english', 'gracia-multilingual', 'gracia-other')}[kind]
    groups = {key: [] for key in keys}
    for film in programme['films']:
        for session in film['sessions']:
            starts = datetime.fromisoformat(session['starts_at']).astimezone(MADRID)
            if starts <= now:
                continue
            if kind == 'today':
                if starts.date() == today:
                    groups['tonight' if starts.hour >= 18 else 'daytime'].append((film, session))
            elif kind == 'weekend':
                if starts.date() in weekend:
                    groups[weekend[starts.date()]].append((film, session))
            elif kind == 'gracia':
                if session.get('cinema_id') not in GRACIA_VENUES or starts.date() >= end:
                    continue
                audio = parse_languages(without_language_placeholder(session.get('language')))
                group = 'gracia-other'
                if starts.hour >= 20 and 'en' in audio['codes']:
                    group = 'gracia-english' if audio['codes'] == ['en'] and audio['complete'] else 'gracia-multilingual'
                groups[group].append((film, session))
            elif kind in ('imax', 'film'):
                formats = {str(value).strip().casefold() for value in session.get('formats') or []}
                if kind == 'imax':
                    if 'imax' in formats:
                        groups['imax'].append((film, session))
                else:
                    matched = formats & {'35mm', '70mm'}
                    if matched:
                        group = 'mixed-film' if len(matched) == 2 else next(iter(matched))
                        groups[group].append((film, session))
            else:
                field = 'language' if kind == 'english' else 'subtitles'
                evidence = parse_languages(without_language_placeholder(session.get(field)))
                if ('ca' if kind == 'vosc' else 'en') not in evidence['codes']:
                    continue
                if kind == 'english':
                    if starts.date() >= end:
                        continue
                    group = 'english' if evidence['codes'] == ['en'] and evidence['complete'] else 'multilingual'
                else:
                    group = kind
                groups[group].append((film, session))
    return {key: sorted(pairs, key=lambda pair: (datetime.fromisoformat(pair[1]['starts_at']).timestamp(), pair[1]['id'])) for key, pairs in groups.items()}


COPY = {
    'en': {
        'footer': 'Find showtimes by date and language',
        'today': 'Original-language cinema today and tonight in Barcelona',
        'english': 'Films in English in Barcelona: showtimes and tickets',
        'subtitles': 'Cinema with English subtitles in Barcelona: VOSI screenings',
        'today_intro': 'Find the remaining original-language screenings for {date} at the cinemas we cover in Barcelona and nearby towns. Tonight means 18:00 to midnight, Europe/Madrid. Check each session’s audio and subtitles separately.',
        'english_intro': 'These sessions list English in their audio field. The next seven calendar days run from {date} to {end}, Europe/Madrid; screenings that have started are excluded. Multilingual films with English dialogue are listed separately. Cinemas include Barcelona and nearby towns.',
        'subtitles_intro': 'For cinema with English subtitles, check the session’s subtitle field or an explicit VOSI label. English audio alone does not promise English subtitles. Below are the upcoming sessions with English subtitles in our collected programme for Barcelona and nearby towns.',
        'daytime': 'Before 18:00 today', 'tonight': 'Tonight: 18:00 to midnight',
        'english_group': 'Sessions listing English audio',
        'multilingual': 'Multilingual films with English dialogue',
        'multilingual_note': 'English is one of the reported audio languages. These films may contain substantial dialogue in other languages; check the full language and subtitle fields below.',
        'subtitles_group': 'Upcoming sessions with English subtitles',
        'count': '{films} films or events · {sessions} screenings',
        'none': 'No confirmed upcoming matches in this collected programme. This does not establish that no cinema is showing one; unpublished sessions and missing language details remain unknown.',
        'method_title': 'How these sessions are selected',
        'method': 'Audio and subtitles come from separate session fields supplied by the cinema. Missing or generic language labels are not treated as English. VOSE, a film’s title and its country of production do not establish English audio. We retain the operator’s labels, source link and collection time beside each screening. Coverage and booking availability can change; the cinema confirms the final details.',
        'snapshot': 'Programme collected', 'built': 'Page updated',
        'show_sessions': 'Show screenings',
        'stale': 'This list was prepared for {date}. Reload to see today’s updated programme.',
        'reload': 'Reload programme',
        'version_question': 'What do VO, VOSE, VOSC and VOSI mean?',
        'version_answer': 'These labels describe original audio and, when specified, subtitle language. They do not identify the audio language by themselves. VO alone does not confirm whether subtitles are present.',
        'version_audio': 'Original audio; language depends on the film',
        'version_unknown': 'Not specified by this label',
        'spanish': 'Spanish', 'catalan': 'Catalan', 'english_language': 'English',
        'examples': 'A film with French original audio in VOSE has French audio and Spanish subtitles. A film with English original audio in VOSC has English audio and Catalan subtitles. A film with Spanish original audio in VOSI has Spanish audio and English subtitles.',
        'subtitle_question': 'Does “in English” mean “with English subtitles”?',
        'subtitle_answer': 'No. “In English” describes the soundtrack. “With English subtitles” describes the written translation. A session can have one, both or neither. Check the same session’s two fields before booking.',
        'booking_question': 'How do I book the matching screening?',
        'booking_answer': 'Choose Select screening to open the film with that exact session selected, then choose Tickets to continue to the cinema. The source and collection date show what the operator reported. If the session has expired, the film page explains that it is no longer available.',
    },
    'es': {
        'footer': 'Buscar sesiones por fecha e idioma',
        'today': 'Cine en versión original hoy en Barcelona: tarde y noche',
        'english': 'Películas en inglés en Barcelona: cartelera y entradas',
        'subtitles': 'Cine con subtítulos en inglés en Barcelona: sesiones VOSI',
        'today_intro': 'Consulta las sesiones en versión original que quedan para el {date} en los cines que cubrimos de Barcelona y localidades cercanas. El apartado de tarde y noche abarca de las 18:00 a medianoche, Europe/Madrid. Comprueba por separado el audio y los subtítulos de cada sesión.',
        'english_intro': 'Estas sesiones indican inglés en el campo de audio. Los próximos siete días naturales van del {date} al {end}, Europe/Madrid; se excluyen las sesiones que ya han empezado. Las películas multilingües con diálogo en inglés aparecen por separado. Incluimos cines de Barcelona y localidades cercanas.',
        'subtitles_intro': 'Para ver cine con subtítulos en inglés, comprueba el campo de subtítulos de la sesión o una etiqueta VOSI explícita. Que el audio sea en inglés no garantiza subtítulos en inglés. Estas son las próximas sesiones con subtítulos en inglés de la programación recogida en Barcelona y localidades cercanas.',
        'daytime': 'Hoy antes de las 18:00', 'tonight': 'Tarde y noche: de las 18:00 a medianoche',
        'english_group': 'Sesiones que indican audio en inglés',
        'multilingual': 'Películas multilingües con diálogo en inglés',
        'multilingual_note': 'El inglés es uno de los idiomas de audio indicados. Estas películas pueden incluir una parte importante del diálogo en otros idiomas; consulta todos los idiomas y los subtítulos de cada sesión.',
        'subtitles_group': 'Próximas sesiones con subtítulos en inglés',
        'count': '{films} películas o eventos · {sessions} sesiones',
        'none': 'No hay próximas sesiones confirmadas que coincidan en la programación recogida. Esto no significa que ningún cine las ofrezca: las sesiones no publicadas y los idiomas sin confirmar siguen siendo desconocidos.',
        'method_title': 'Cómo seleccionamos estas sesiones',
        'method': 'El audio y los subtítulos proceden de campos separados de cada sesión proporcionados por el cine. Los idiomas ausentes o genéricos no se consideran inglés. VOSE, el título y el país de producción no demuestran audio en inglés. Cada sesión conserva las etiquetas del operador, el enlace a la fuente y la fecha de consulta. La cobertura y la disponibilidad pueden cambiar; el cine confirma los detalles finales.',
        'snapshot': 'Programación consultada', 'built': 'Página actualizada',
        'show_sessions': 'Ver sesiones',
        'stale': 'Esta lista se preparó para el {date}. Recarga para consultar la programación actualizada de hoy.',
        'reload': 'Recargar programación',
        'version_question': '¿Qué significan VO, VOSE, VOSC y VOSI?',
        'version_answer': 'Estas etiquetas describen el audio original y, cuando se especifica, el idioma de los subtítulos. Por sí solas no identifican el idioma del audio. VO no confirma si hay subtítulos.',
        'version_audio': 'Audio original; el idioma depende de la película',
        'version_unknown': 'La etiqueta no lo especifica',
        'spanish': 'Español', 'catalan': 'Catalán', 'english_language': 'Inglés',
        'examples': 'Una película con audio original en francés en VOSE tiene audio en francés y subtítulos en español. Con audio original en inglés y versión VOSC, tiene audio en inglés y subtítulos en catalán. Con audio original en español y versión VOSI, tiene audio en español y subtítulos en inglés.',
        'subtitle_question': '¿«En inglés» significa «con subtítulos en inglés»?',
        'subtitle_answer': 'No. «En inglés» describe el audio; «con subtítulos en inglés», la traducción escrita. Una sesión puede tener uno, ambos o ninguno. Comprueba los dos campos de la misma sesión antes de reservar.',
        'booking_question': '¿Cómo compro entradas para la sesión que me interesa?',
        'booking_answer': 'Pulsa Seleccionar sesión para abrir la película con esa sesión seleccionada y después Entradas para continuar en la web del cine. La fuente y la fecha de consulta indican lo que publicó el operador. Si la sesión ha caducado, la página de la película indica que ya no está disponible.',
    },
    'ca': {
        'footer': 'Troba sessions per data i idioma',
        'today': 'Cinema en versió original avui a Barcelona: tarda i nit',
        'english': 'Pel·lícules en anglès a Barcelona: cartellera i entrades',
        'subtitles': 'Cinema amb subtítols en anglès a Barcelona: sessions VOSI',
        'today_intro': 'Consulta les sessions en versió original que queden per al {date} als cinemes que cobrim de Barcelona i poblacions properes. L’apartat de tarda i nit va de les 18:00 a mitjanit, Europe/Madrid. Comprova per separat l’àudio i els subtítols de cada sessió.',
        'english_intro': 'Aquestes sessions indiquen anglès al camp d’àudio. Els pròxims set dies naturals van del {date} al {end}, Europe/Madrid; se n’exclouen les sessions que ja han començat. Les pel·lícules multilingües amb diàleg en anglès apareixen per separat. Incloem cinemes de Barcelona i poblacions properes.',
        'subtitles_intro': 'Per veure cinema amb subtítols en anglès, comprova el camp de subtítols de la sessió o una etiqueta VOSI explícita. L’àudio en anglès no garanteix subtítols en anglès. Aquestes són les pròximes sessions amb subtítols en anglès de la programació recollida a Barcelona i poblacions properes.',
        'daytime': 'Avui abans de les 18:00', 'tonight': 'Tarda i nit: de les 18:00 a mitjanit',
        'english_group': 'Sessions que indiquen àudio en anglès',
        'multilingual': 'Pel·lícules multilingües amb diàleg en anglès',
        'multilingual_note': 'L’anglès és un dels idiomes d’àudio indicats. Aquestes pel·lícules poden incloure una part important del diàleg en altres idiomes; consulta tots els idiomes i els subtítols de cada sessió.',
        'subtitles_group': 'Pròximes sessions amb subtítols en anglès',
        'count': '{films} pel·lícules o esdeveniments · {sessions} sessions',
        'none': 'No hi ha pròximes sessions confirmades que coincideixin a la programació recollida. Això no vol dir que cap cinema n’ofereixi: les sessions no publicades i els idiomes sense confirmar continuen sent desconeguts.',
        'method_title': 'Com seleccionem aquestes sessions',
        'method': 'L’àudio i els subtítols provenen de camps separats de cada sessió facilitats pel cinema. Els idiomes absents o genèrics no es consideren anglès. VOSE, el títol i el país de producció no demostren àudio en anglès. Cada sessió conserva les etiquetes de l’operador, l’enllaç a la font i la data de consulta. La cobertura i la disponibilitat poden canviar; el cinema confirma els detalls finals.',
        'snapshot': 'Programació consultada', 'built': 'Pàgina actualitzada',
        'show_sessions': 'Veure sessions',
        'stale': 'Aquesta llista es va preparar per al {date}. Torna a carregar per consultar la programació actualitzada d’avui.',
        'reload': 'Torna a carregar la programació',
        'version_question': 'Què volen dir VO, VOSE, VOSC i VOSI?',
        'version_answer': 'Aquestes etiquetes descriuen l’àudio original i, quan s’especifica, l’idioma dels subtítols. Per si soles no identifiquen l’idioma de l’àudio. VO no confirma si hi ha subtítols.',
        'version_audio': 'Àudio original; l’idioma depèn de la pel·lícula',
        'version_unknown': 'L’etiqueta no ho especifica',
        'spanish': 'Castellà', 'catalan': 'Català', 'english_language': 'Anglès',
        'examples': 'Una pel·lícula amb àudio original en francès en VOSE té àudio en francès i subtítols en castellà. Amb àudio original en anglès i versió VOSC, té àudio en anglès i subtítols en català. Amb àudio original en castellà i versió VOSI, té àudio en castellà i subtítols en anglès.',
        'subtitle_question': '«En anglès» vol dir «amb subtítols en anglès»?',
        'subtitle_answer': 'No. «En anglès» descriu l’àudio; «amb subtítols en anglès», la traducció escrita. Una sessió pot tenir-ne un, tots dos o cap. Comprova els dos camps de la mateixa sessió abans de reservar.',
        'booking_question': 'Com compro entrades per a la sessió que m’interessa?',
        'booking_answer': 'Prem Selecciona sessió per obrir la pel·lícula amb aquella sessió seleccionada i després Entrades per continuar al web del cinema. La font i la data de consulta indiquen què va publicar l’operador. Si la sessió ha caducat, la pàgina de la pel·lícula indica que ja no està disponible.',
    },
}

for _lang, _copy in GUIDE_COPY.items():
    COPY[_lang].update(_copy)
for _lang, _copy in LOCAL_COPY.items():
    COPY[_lang].update(_copy)
