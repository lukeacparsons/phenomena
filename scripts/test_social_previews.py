from html.parser import HTMLParser
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from social_previews import COPY, SIZE, SocialPreviews, film_copy, metadata, snippet, font, wrap, shared_session_language


class SocialPreviewTests(unittest.TestCase):
    def test_session_language_claims_require_complete_matching_evidence(self):
        self.assertEqual(shared_session_language([{'language': 'EN'}, {'language': 'Inglés'}], 'language'), 'English')
        for sessions in ([], [{}], [{'language': 'English'}, {}],
                         [{'language': 'English'}, {'language': 'Spanish'}],
                         [{'language': 'English, other languages'}], [{'version': 'VOSE'}]):
            self.assertIsNone(shared_session_language(sessions, 'language'))

    def test_copy_is_short_localized_and_does_not_infer_session_audio(self):
        film = {'title': 'Dune', 'sessions': [{}], 'details': {'languages': ['English']}}
        for lang in COPY:
            active = film_copy(film, lang, 'Dune')
            self.assertLessEqual(len(active['description']), 160)
            self.assertNotIn('English', active['description'])
            empty = film_copy({**film, 'sessions': []}, lang, 'Dune')
            self.assertEqual(empty['description'], COPY[lang]['film_empty'])
            self.assertNotEqual(empty['label'], active['label'])
        confirmed = film_copy(film, 'en', 'Dune', audio='English', subtitles='Spanish')
        self.assertIn('Audio: English.', confirmed['description'])
        self.assertIn('Subtitles: Spanish.', confirmed['description'])

    def test_snippets_keep_complete_sentences_or_whole_words(self):
        self.assertEqual(snippet('A short fact. ' + 'More information ' * 20), 'A short fact.')
        self.assertLessEqual(len(snippet('Long title ' * 40)), 160)
        self.assertEqual(snippet('Cine &amp; música\n a Barcelona'), 'Cine & música a Barcelona')
        # A missing word boundary still cannot exceed the limit.
        self.assertLessEqual(len(snippet('x' * 500)), 160)

    def test_long_titles_wrap_by_pixels_including_unbroken_words(self):
        face = font('B612-Bold.ttf', 34)
        for value in ('La pel·lícula més llarga: àudio, versió i subtítols ' * 8, 'W' * 200):
            lines = wrap(value, face, 704)
            self.assertTrue(all(face.getlength(line) <= 704 for line in lines))

    def test_jpeg_dimensions_artwork_fallback_and_content_addressed_reuse(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            generator = SocialPreviews(root / 'first')
            first = generator.create('en', 'Dune | VO Barna', 'A film.', film={'poster_url': 'https://example.com/poster.jpg'})
            image_path = root / 'first' / first['image'].lstrip('/')
            with Image.open(image_path) as image:
                self.assertEqual(image.size, SIZE)
                self.assertEqual(image.format, 'JPEG')
            self.assertLess(image_path.stat().st_size, 300_000)
            self.assertIn('mascot', first['alt'])
            reused = SocialPreviews(root / 'second', root / 'first')
            with patch.object(reused, 'render', side_effect=AssertionError('Unchanged cards should be reused')):
                second = reused.create('en', 'Dune | VO Barna', 'A film.')
            self.assertEqual(first['image'], second['image'])
            changed = reused.create('en', 'Dune | VO Barna', 'No upcoming screenings.')
            self.assertNotEqual(second['image'], changed['image'])

    def test_poster_is_local_uncropped_and_replaced_if_bytes_change(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            posters = root / 'preview-data/posters'
            posters.mkdir(parents=True)
            poster = posters / 'film.jpg'
            Image.new('RGB', (200, 300), 'red').save(poster)
            generator = SocialPreviews(root / 'out')
            film = {'poster_url': '/preview-data/posters/film.jpg'}
            with patch('social_previews.STATIC', root):
                digest, art = generator.poster(film)
                self.assertAlmostEqual(art.width / art.height, 2 / 3)
                self.assertEqual(art.getpixel((0, 0)), art.getpixel((art.width-1, art.height-1)))
                self.assertIsNone(generator.poster({'poster_url': '/preview-data/posters/../../../outside.jpg'}))
                poster.write_text('invalid image')
                generator.artwork.clear()
                self.assertIsNone(generator.poster(film))
                Image.new('RGB', (200, 300), 'blue').save(poster)
                generator.artwork.clear()
                self.assertNotEqual(digest, generator.poster(film)[0])

    def test_metadata_escapes_text_and_agrees_across_networks(self):
        class Meta(HTMLParser):
            def __init__(self):
                super().__init__()
                self.tags = {}
            def handle_starttag(self, tag, attrs):
                if tag == 'meta':
                    attrs = dict(attrs)
                    self.tags[attrs.get('property') or attrs.get('name')] = attrs['content']
        title = 'A "film" & <another>'
        card = dict(title=title, description='Short & accurate.', image='/social/' + 'a' * 64 + '.jpg', alt=title)
        html = metadata(card, 'https://vobarna.com', '/ca/pellicules/film/', 'ca', ['en', 'es', 'ca'])
        parsed = Meta(); parsed.feed(html)
        self.assertNotIn('<another>', html)
        self.assertEqual(parsed.tags['og:title'], title)
        self.assertEqual(parsed.tags['og:locale'], 'ca_ES')
        self.assertEqual(parsed.tags['og:image'], parsed.tags['twitter:image'])
        self.assertEqual(parsed.tags['og:description'], parsed.tags['twitter:description'])
        self.assertEqual(parsed.tags['twitter:card'], 'summary_large_image')
        self.assertEqual(parsed.tags['og:image:width'], '1200')


if __name__ == '__main__':
    unittest.main()
