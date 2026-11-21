"""English-subtitle page sections, rebuilt from every collected programme."""
import re
from language_names import parse_languages
from screening_languages import screening_audio, has_non_english_audio

GROUPS = ('subtitles-foreign', 'subtitles-multilingual', 'subtitles-other', 'subtitles-events')


def subtitle_group(film, session):
    if 'en' not in parse_languages(session.get('subtitles'))['codes']:
        return None
    # Explicit event-format labels; a musical or a documentary is still a film.
    genres = {str(g).casefold() for g in film.get('details', {}).get('genres', [])}
    if genres & {'concert', 'concierto', 'opera', 'ópera', 'òpera', 'ballet'} or re.search(
            r'world tour.+live viewing|\broyal (?:ballet|opera)\b|^RBO\s', film.get('title', ''), re.I):
        return 'subtitles-events'
    audio = screening_audio(film, session)
    if has_non_english_audio(audio):
        return 'subtitles-foreign' if audio['complete'] and 'en' not in audio['codes'] else 'subtitles-multilingual'
    return 'subtitles-other'


COPY = {
    'en': {
        'subtitles': 'Foreign-language films with English subtitles in Barcelona',
        'subtitles_intro': 'Find non-English films with English subtitles in Barcelona and nearby towns. These upcoming screenings explicitly list English subtitles. Films with non-English audio come first, followed by multilingual films and other confirmed English-subtitled sessions. Concerts and stage broadcasts have their own section. All times are local to Barcelona.',
        'subtitles_description': 'Find foreign-language films with English subtitles in Barcelona: current VOSI screenings, audio languages, dates, cinemas and official tickets.',
        'subtitles-foreign': 'Non-English films with English subtitles',
        'subtitles-multilingual': 'Multilingual films with English subtitles',
        'subtitles-multilingual_note': 'These films include non-English dialogue. They may also include English dialogue or an incompletely specified soundtrack; each screening lists the available language evidence.',
        'subtitles-other': 'Other screenings with confirmed English subtitles',
        'subtitles-other_note': 'The audio is English-only or not sufficiently confirmed to include these screenings in the non-English film sections.',
        'subtitles-events': 'Concerts and stage broadcasts with English subtitles',
        'subtitles-foreign_none': 'No confirmed non-English film screenings with English subtitles are currently listed. Check the multilingual films and other sections below, or return after the programme updates.',
        'subtitles_method': 'English subtitles must be confirmed on the individual screening. Audio comes from that screening, the same cinema’s explicit original-language film listing, or a verified original-language source for an original-version screening. Conflicting or missing evidence stays unconfirmed. Non-English means a spoken language other than English, including Spanish and Catalan; it does not describe the production country. These pages rebuild automatically as the programme changes and exclude screenings that have started.',
        'derived_audio': 'Original audio verified from the film listing',
        'subtitle_search': 'Search all English-subtitled screenings',
        'subtitle_search_query': 'English subtitles',
    },
    'es': {
        'subtitles': 'Películas en otros idiomas con subtítulos en inglés en Barcelona',
        'subtitles_intro': 'Encuentra películas en idiomas distintos del inglés con subtítulos en inglés en Barcelona y localidades cercanas. Estas próximas sesiones indican subtítulos en inglés. Primero aparecen las películas sin audio en inglés, después las multilingües y otras sesiones confirmadas. Los conciertos y las retransmisiones escénicas tienen su propio apartado. Todos los horarios son de Barcelona.',
        'subtitles_description': 'Películas en otros idiomas con subtítulos en inglés en Barcelona: sesiones VOSI, idiomas del audio, horarios, cines y entradas oficiales.',
        'subtitles-foreign': 'Películas sin audio en inglés y con subtítulos en inglés',
        'subtitles-multilingual': 'Películas multilingües con subtítulos en inglés',
        'subtitles-multilingual_note': 'Estas películas incluyen diálogo en otros idiomas. También pueden incluir inglés o un audio no completamente especificado; cada sesión muestra los idiomas confirmados.',
        'subtitles-other': 'Otras sesiones con subtítulos en inglés confirmados',
        'subtitles-other_note': 'El audio es solo en inglés o no está suficientemente confirmado para incluir estas sesiones entre las películas en otros idiomas.',
        'subtitles-events': 'Conciertos y retransmisiones escénicas con subtítulos en inglés',
        'subtitles-foreign_none': 'No hay sesiones confirmadas de películas sin audio en inglés y con subtítulos en inglés. Consulta las películas multilingües y los demás apartados, o vuelve cuando se actualice la programación.',
        'subtitles_method': 'Los subtítulos en inglés deben estar confirmados para la sesión concreta. El audio procede de esa sesión, de la ficha de idioma original del mismo cine o de una fuente verificada del idioma original para una sesión en versión original. Los datos contradictorios o ausentes quedan sin confirmar. Otros idiomas incluye el castellano y el catalán; no indica el país de producción. Estas páginas se regeneran automáticamente con la programación y excluyen las sesiones que ya han empezado.',
        'derived_audio': 'Audio original verificado en la ficha de la película',
        'subtitle_search': 'Buscar todas las sesiones con subtítulos en inglés',
        'subtitle_search_query': 'subtítulos en inglés',
    },
    'ca': {
        'subtitles': 'Pel·lícules en altres idiomes amb subtítols en anglès a Barcelona',
        'subtitles_intro': 'Troba pel·lícules en idiomes diferents de l’anglès amb subtítols en anglès a Barcelona i poblacions properes. Aquestes pròximes sessions indiquen subtítols en anglès. Primer hi ha les pel·lícules sense àudio en anglès, després les multilingües i altres sessions confirmades. Els concerts i les retransmissions escèniques tenen un apartat propi. Tots els horaris són de Barcelona.',
        'subtitles_description': 'Pel·lícules en altres idiomes amb subtítols en anglès a Barcelona: sessions VOSI, idiomes de l’àudio, horaris, cinemes i entrades oficials.',
        'subtitles-foreign': 'Pel·lícules sense àudio en anglès i amb subtítols en anglès',
        'subtitles-multilingual': 'Pel·lícules multilingües amb subtítols en anglès',
        'subtitles-multilingual_note': 'Aquestes pel·lícules inclouen diàleg en altres idiomes. També poden incloure anglès o un àudio no completament especificat; cada sessió mostra els idiomes confirmats.',
        'subtitles-other': 'Altres sessions amb subtítols en anglès confirmats',
        'subtitles-other_note': 'L’àudio és només en anglès o no està prou confirmat per incloure aquestes sessions entre les pel·lícules en altres idiomes.',
        'subtitles-events': 'Concerts i retransmissions escèniques amb subtítols en anglès',
        'subtitles-foreign_none': 'No hi ha sessions confirmades de pel·lícules sense àudio en anglès i amb subtítols en anglès. Consulta les pel·lícules multilingües i els altres apartats, o torna quan s’actualitzi la programació.',
        'subtitles_method': 'Els subtítols en anglès han d’estar confirmats per a la sessió concreta. L’àudio prové d’aquella sessió, de la fitxa d’idioma original del mateix cinema o d’una font verificada de l’idioma original per a una sessió en versió original. Les dades contradictòries o absents queden sense confirmar. Altres idiomes inclou el castellà i el català; no indica el país de producció. Aquestes pàgines es regeneren automàticament amb la programació i exclouen les sessions que ja han començat.',
        'derived_audio': 'Àudio original verificat a la fitxa de la pel·lícula',
        'subtitle_search': 'Cerca totes les sessions amb subtítols en anglès',
        'subtitle_search_query': 'subtítols en anglès',
    },
}
