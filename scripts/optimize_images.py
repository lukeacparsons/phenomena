"""Build cached, same-origin WebP sizes and inline previews with Pillow.

Original artwork stays untouched. This runs during publication/refresh, never
on a public image request. Content-derived names are safe to cache indefinitely.
"""
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import warnings

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
WIDTHS = (160, 320, 480, 640, 960)
RECIPE = b'webp-v1-q80-preview32-q35-exif'


def write_bytes(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def webp(image, width, quality):
    resized = image.resize((width, max(1, round(image.height * width / image.width))), Image.Resampling.LANCZOS)
    output = BytesIO()
    resized.save(output, format='WEBP', quality=quality, method=4)
    return output.getvalue()


def optimize_poster(url, static=ROOT / 'static'):
    static = Path(static)
    if not isinstance(url, str) or not url.startswith('/preview-data/posters/'):
        return None
    source = (static / url.lstrip('/')).resolve()
    if not source.is_relative_to((static / 'preview-data/posters').resolve()) or not source.is_file():
        return None
    body = source.read_bytes()
    key = hashlib.sha256(RECIPE + body).hexdigest()
    directory = static / 'preview-data/images'
    manifest = directory / (key + '.json')
    try:
        cached = json.loads(manifest.read_text())
        if all((static / item['url'].lstrip('/')).is_file() for item in cached['variants']):
            return {**cached, 'source': url}
    except (OSError, ValueError, KeyError):
        pass
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(BytesIO(body)) as original:
            image = ImageOps.exif_transpose(original).convert('RGBA' if 'A' in original.getbands() else 'RGB')
        widths = sorted({min(width, image.width) for width in WIDTHS})
        result = {'source': url, 'width': image.width, 'height': image.height,
                  'preview': 'data:image/webp;base64,' + base64.b64encode(webp(image, min(32, image.width), 35)).decode(),
                  'variants': []}
        for width in widths:
            encoded = webp(image, width, 80)
            filename = f'{key}-{width}.webp'
            write_bytes(directory / filename, encoded)
            result['variants'].append({'url': '/preview-data/images/' + filename, 'width': width, 'bytes': len(encoded)})
    write_bytes(manifest, json.dumps(result, separators=(',', ':')).encode())
    return result


def prepare_images(films, static=ROOT / 'static'):
    cached = {}
    for film in films:
        url = film.get('poster_url')
        if url not in cached:
            try:
                cached[url] = optimize_poster(url, static)
            except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                # A bad artwork file must not take the programme offline.
                cached[url] = None
        if cached[url]:
            film['poster_image'] = cached[url]
        else:
            film.pop('poster_image', None)


def refresh_programme_images(path):
    from programme_store import update_programme
    path = Path(path)
    snapshot = json.loads(path.read_text())
    prepare_images(snapshot['films'], path.parent.parent)
    images = {film['id']: film for film in snapshot['films']}
    def merge(latest):
        for film in latest['films']:
            prepared = images.get(film['id'])
            if prepared and film.get('poster_url') == prepared.get('poster_url'):
                if prepared.get('poster_image'):
                    film['poster_image'] = prepared['poster_image']
                else:
                    film.pop('poster_image', None)
        return latest
    return update_programme(path, merge)


def optimize_logo(static=ROOT / 'static'):
    with Image.open(static / 'clint.png') as original:
        body = webp(ImageOps.exif_transpose(original).convert('RGBA'), 160, 85)
    target = static / 'clint-logo.webp'
    if not target.exists() or target.read_bytes() != body:
        write_bytes(target, body)


def optimize_mascot_animation(static=ROOT / 'static'):
    # Use the refined scroll animation's first frame as its matching idle pose.
    scroll_name = 'barcelona-mascot-point-right-brow-refined.webp'
    with Image.open(ROOT / scroll_name) as original:
        still = ImageOps.pad(original.convert('RGBA'), (160, 160),
                             method=Image.Resampling.LANCZOS, color=(0, 0, 0, 0))
    idle = BytesIO()
    still.save(idle, format='WEBP', lossless=True, method=4)
    target = static / 'clint-idle.webp'
    if not target.exists() or target.read_bytes() != idle.getvalue():
        write_bytes(target, idle.getvalue())
    for name in (scroll_name, 'barcelona-mascot-poke.webp'):
        frames, durations = [], []
        with Image.open(ROOT / name) as original:
            for index in range(original.n_frames):
                original.seek(index)
                frame = original.convert('RGBA')
                frame.thumbnail((160, 160), Image.Resampling.LANCZOS)
                frames.append(frame)
                durations.append(original.info['duration'])
        output = BytesIO()
        frames[0].save(output, format='WEBP', save_all=True, append_images=frames[1:],
                       duration=durations, loop=1, lossless=True, quality=85, method=4)
        body = output.getvalue()
        target = static / name
        if not target.exists() or target.read_bytes() != body:
            write_bytes(target, body)


if __name__ == '__main__':
    optimize_logo()
    optimize_mascot_animation()
    data = refresh_programme_images(ROOT / 'static/preview-data/screenings.json')
    print(json.dumps({'optimized_posters': sum(bool(f.get('poster_image')) for f in data['films'])}))
