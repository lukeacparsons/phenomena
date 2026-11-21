"""Local, deterministic share cards. No crawler-time rendering or remote artwork."""
from functools import lru_cache
import hashlib
from html import escape, unescape
import json
from pathlib import Path
import re
import shutil

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError
from language_names import LANGUAGE_NAMES, parse_languages, without_language_placeholder

STATIC = Path(__file__).resolve().parents[1] / 'static'
SIZE = (1200, 630)
LOCALES = {'en': 'en_GB', 'es': 'es_ES', 'ca': 'ca_ES'}
COPY = {
    'en': {
        'home': 'Original version cinema in Barcelona',
        'intro': 'Find original-version films in Barcelona and nearby cinemas. Compare showtimes, audio and subtitles, with official ticket links.',
        'home_detail': 'Showtimes, audio, subtitles and official ticket links.',
        'film': 'Film', 'cinema': 'Cinema', 'guide': 'Cinema guide', 'page': '',
        'live': 'Original-version showtimes', 'archive': 'Film details',
        'film_description': 'Original-version screenings in Barcelona and nearby cinemas. Compare showtimes and official ticket links.',
        'film_empty': 'No upcoming screenings listed in our Barcelona-area programme. Explore the film details.',
        'venue_description': 'Original-version showtimes, venue information and official ticket links.',
        'venue_empty': 'Venue information and official programme. No upcoming screenings listed in our programme.',
        'audio': 'Audio: {value}.', 'subtitles': 'Subtitles: {value}.',
        'poster_alt': '{title} poster alongside its film details and the VO Barna wordmark.',
        'brand_alt': '{title} with the VO Barna wordmark and Clint, the cinema mascot.',
    },
    'es': {
        'home': 'Cine en versión original en Barcelona',
        'intro': 'Encuentra cine en versión original en Barcelona y alrededores. Compara horarios, audio y subtítulos, con enlaces oficiales de entradas.',
        'home_detail': 'Horarios, audio, subtítulos y enlaces oficiales de entradas.',
        'film': 'Película', 'cinema': 'Cine', 'guide': 'Guía de cine', 'page': '',
        'live': 'Cartelera en versión original', 'archive': 'Ficha de la película',
        'film_description': 'Sesiones en versión original en Barcelona y cines cercanos. Compara horarios y enlaces oficiales de entradas.',
        'film_empty': 'No hay próximas sesiones en nuestra cartelera de Barcelona y alrededores. Consulta la ficha de la película.',
        'venue_description': 'Cartelera en versión original, información del cine y enlaces oficiales de entradas.',
        'venue_empty': 'Información del espacio y programación oficial. No hay próximas sesiones en nuestra cartelera.',
        'audio': 'Audio: {value}.', 'subtitles': 'Subtítulos: {value}.',
        'poster_alt': 'Cartel de {title} junto a su ficha y el logotipo de VO Barna.',
        'brand_alt': '{title} con el logotipo de VO Barna y Clint, la mascota de cine.',
    },
    'ca': {
        'home': 'Cinema en versió original a Barcelona',
        'intro': 'Troba cinema en versió original a Barcelona i rodalia. Compara horaris, àudio i subtítols, amb enllaços oficials d’entrades.',
        'home_detail': 'Horaris, àudio, subtítols i enllaços oficials d’entrades.',
        'film': 'Pel·lícula', 'cinema': 'Cinema', 'guide': 'Guia de cinema', 'page': '',
        'live': 'Cartellera en versió original', 'archive': 'Fitxa de la pel·lícula',
        'film_description': 'Sessions en versió original a Barcelona i cinemes propers. Compara horaris i enllaços oficials d’entrades.',
        'film_empty': 'No hi ha pròximes sessions a la nostra cartellera de Barcelona i rodalia. Consulta la fitxa de la pel·lícula.',
        'venue_description': 'Cartellera en versió original, informació del cinema i enllaços oficials d’entrades.',
        'venue_empty': 'Informació de l’espai i programació oficial. No hi ha pròximes sessions a la nostra cartellera.',
        'audio': 'Àudio: {value}.', 'subtitles': 'Subtítols: {value}.',
        'poster_alt': 'Cartell de {title} amb la seva fitxa i el logotip de VO Barna.',
        'brand_alt': '{title} amb el logotip de VO Barna i el Clint, la mascota de cinema.',
    },
}


def plain(value):
    return ' '.join(unescape(str(value or '')).split())


def snippet(value, limit=160):
    """Prefer complete sentences; otherwise stop at a word, never inside markup."""
    value = plain(value)
    if len(value) <= limit:
        return value
    sentences = re.split(r'(?<=[.!?])\s+', value)
    complete = ''
    for sentence in sentences:
        candidate = (complete + ' ' + sentence).strip()
        if len(candidate) > limit:
            break
        complete = candidate
    if complete:
        return complete
    cut = value[:limit - 1].rsplit(' ', 1)[0]
    return cut.rstrip(' ,;:–—-') + '…'


def shared_session_language(sessions, field):
    """A share-wide claim needs complete, matching evidence from every session."""
    values = [parse_languages(without_language_placeholder(s.get(field))) for s in sessions]
    if not values or any(not value['complete'] or len(value['codes']) != 1 for value in values):
        return None
    codes = {value['codes'][0] for value in values}
    return LANGUAGE_NAMES[next(iter(codes))] if len(codes) == 1 else None


def film_copy(film, lang, display_title, *, audio=None, subtitles=None):
    """Caller supplies only shared, verified session languages, never film audio guesses."""
    t = COPY[lang]
    active = bool(film.get('sessions'))
    description = t['film_description' if active else 'film_empty']
    if active:
        for field, value in [('audio', audio), ('subtitles', subtitles)]:
            if value:
                fact = t[field].format(value=plain(value))
                if len(description) + len(fact) + 1 <= 160:
                    description += ' ' + fact
    details = film.get('details') or {}
    facts = []
    year = film.get('release_year') or details.get('release_year')
    if year and str(year) not in display_title:
        facts.append(str(year))
    if details.get('runtime_minutes'):
        facts.append(str(details['runtime_minutes']) + ' min')
    if details.get('directors'):
        facts.append(', '.join(details['directors']))
    return dict(title=display_title + ' | VO Barna', heading=display_title,
                description=description, label=t['live' if active else 'archive'],
                detail=snippet(' · '.join(facts), 110), film=film)


@lru_cache(maxsize=64)
def font(name, size):
    return ImageFont.truetype(str(STATIC / 'fonts' / name), size)


def wrap(value, face, width):
    """Measured wrapping also handles an unusually long unbroken title."""
    lines, line = [], ''
    for word in plain(value).split():
        if line and face.getlength(line + ' ' + word) > width:
            lines.append(line)
            line = ''
        while face.getlength(word) > width:
            n = 1
            while n < len(word) and face.getlength(word[:n + 1]) <= width:
                n += 1
            if line:
                lines.append(line)
                line = ''
            lines.append(word[:n])
            word = word[n:]
        line = (line + ' ' + word).strip()
    if line:
        lines.append(line)
    return lines


def text_block(draw, value, xy, width, height, *, size, minimum, bold=False, fill='#29251f'):
    name = 'B612-Bold.ttf' if bold else 'B612-Regular.ttf'
    for chosen in range(size, minimum - 1, -2):
        face = font(name, chosen)
        lines = wrap(value, face, width)
        line_height = round(chosen * 1.24)
        if len(lines) * line_height <= height:
            break
    max_lines = max(1, height // line_height)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while face.getlength(lines[-1] + '…') > width:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip(' ,;:–—-') + '…'
    for i, line in enumerate(lines):
        draw.text((xy[0], xy[1] + i * line_height), line, font=face, fill=fill, anchor='lt')
    return len(lines) * line_height


class SocialPreviews:
    def __init__(self, destination, previous=None):
        self.dest = Path(destination)
        self.previous = Path(previous) if previous else None
        self.artwork = {}
        inputs = [Path(__file__), STATIC / 'theme.css', STATIC / 'barcelona-cinema-background.webp',
                  STATIC / 'clint.png', *(STATIC / 'fonts' / f for f in
                  ('Bungee-Regular.ttf', 'B612-Regular.ttf', 'B612-Bold.ttf'))]
        self.version = hashlib.sha256(b''.join(p.read_bytes() for p in inputs)).hexdigest()
        self.background = ImageOps.fit(Image.open(STATIC / 'barcelona-cinema-background.webp').convert('RGB'), SIZE)
        self.background = Image.blend(self.background, Image.new('RGB', SIZE, '#f7f2e8'), .88)
        self.mascot = Image.open(STATIC / 'clint.png').convert('RGBA')
        self.mascot = self.mascot.crop(self.mascot.getbbox())

    def poster(self, film):
        image = (film or {}).get('poster_image') or {}
        variants = sorted(image.get('variants', []), key=lambda v: abs(v.get('width', 0) - 480))
        urls = [v.get('url', '') for v in variants] + [(film or {}).get('poster_url', '')]
        for url in urls:
            if not isinstance(url, str) or not url.startswith(('/preview-data/images/', '/preview-data/posters/')):
                continue
            path = (STATIC / url.lstrip('/')).resolve()
            if not any(path.is_relative_to((STATIC / folder).resolve()) for folder in ('preview-data/images', 'preview-data/posters')):
                continue
            if path not in self.artwork:
                try:
                    data = path.read_bytes()
                    with Image.open(path) as source:
                        art = ImageOps.exif_transpose(source).convert('RGB')
                        art.thumbnail((298, 388), Image.Resampling.LANCZOS)
                    self.artwork[path] = (hashlib.sha256(data).hexdigest(), art)
                except (OSError, ValueError, UnidentifiedImageError):
                    self.artwork[path] = None
            if self.artwork[path]:
                return self.artwork[path]
        return None

    def create(self, lang, title, description, *, kind='page', heading=None, label=None, detail=None, film=None):
        t = COPY[lang]
        heading = plain(heading or title.removesuffix(' | VO Barna'))
        description = snippet(description)
        label = plain(label or t.get(kind, t['page']))
        detail = plain(detail if detail is not None else description)
        poster = self.poster(film)
        spec = [self.version, lang, heading, label, detail, poster[0] if poster else None]
        digest = hashlib.sha256(json.dumps(spec, ensure_ascii=False).encode()).hexdigest()
        url = f'/social/{digest}.jpg'
        target = self.dest / url.lstrip('/')
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            previous = self.previous / url.lstrip('/') if self.previous else None
            if previous and previous.is_file():
                shutil.copy2(previous, target)
            else:
                self.render(target, heading, label, detail, poster)
        alt = snippet(t['poster_alt' if poster else 'brand_alt'].format(title=heading), 300)
        return dict(title=plain(title), description=description, image=url, alt=alt)

    def render(self, target, heading, label, detail, poster):
        card = self.background.copy().convert('RGBA')
        # Leave generous margins so the same artwork stays readable in compact previews.
        mark = ImageOps.contain(self.mascot, (68, 68), Image.Resampling.LANCZOS)
        card.alpha_composite(mark, (66, 53))
        draw = ImageDraw.Draw(card)
        draw.text((150, 65), 'VO BARNA', font=font('Bungee-Regular.ttf', 38), fill='#29251f', anchor='lt')
        draw.line((72, 147, 1128, 147), fill='#d5c8b5', width=2)
        text_block(draw, label, (72, 184), 704, 34, size=24, minimum=22, fill='#a52a36')
        title_height = text_block(draw, heading, (72, 239), 704, 214, size=62, minimum=34, bold=True)
        detail_y = 239 + title_height + 28
        text_block(draw, detail, (72, detail_y), 704, 551 - detail_y, size=27, minimum=23, fill='#514a40')
        draw.text((72, 574), 'vobarna.com', font=font('B612-Regular.ttf', 22), fill='#665d50', anchor='lt')
        if poster:
            art = poster[1]
            mask = Image.new('L', art.size)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, art.width - 1, art.height - 1), radius=6, fill=255)
            card.paste(art, (828 + (300 - art.width) // 2, 170 + (388 - art.height) // 2), mask)
        else:
            art = ImageOps.contain(self.mascot, (300, 330), Image.Resampling.LANCZOS)
            card.alpha_composite(art, (828 + (300 - art.width) // 2, 220 + (330 - art.height) // 2))
        card.convert('RGB').save(target, 'JPEG', quality=88, optimize=True, progressive=True)


def metadata(card, origin, path, lang, alternatives=()):
    values = [('og:type', 'website'), ('og:site_name', 'VO Barna'), ('og:title', card['title']),
              ('og:description', card['description']), ('og:url', origin + path), ('og:locale', LOCALES[lang])]
    values += [('og:locale:alternate', LOCALES[l]) for l in alternatives if l != lang]
    values += [('og:image', origin + card['image']), ('og:image:secure_url', origin + card['image']),
               ('og:image:type', 'image/jpeg'), ('og:image:width', SIZE[0]), ('og:image:height', SIZE[1]),
               ('og:image:alt', card['alt'])]
    twitter = [('twitter:card', 'summary_large_image'), ('twitter:title', card['title']),
               ('twitter:description', card['description']), ('twitter:image', origin + card['image']),
               ('twitter:image:alt', card['alt'])]
    return '\n'.join(f'<meta {attribute}="{key}" content="{escape(str(value), quote=True)}">'
                     for attribute, pairs in [('property', values), ('name', twitter)] for key, value in pairs)
