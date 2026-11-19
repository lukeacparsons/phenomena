from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageOps
from optimize_images import ROOT, optimize_mascot_animation, optimize_poster, prepare_images


class ImageOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.static = Path(self.temp.name)
        self.path = self.static / 'preview-data/posters/example.jpg'
        self.path.parent.mkdir(parents=True)
        self.url = '/preview-data/posters/example.jpg'

    def test_sizes_decode_preserve_ratio_and_reuse_cache(self):
        Image.new('RGB', (800, 1200), '#c47438').save(self.path)
        result = optimize_poster(self.url, self.static)
        self.assertEqual([v['width'] for v in result['variants']], [160, 320, 480, 640, 800])
        for item in result['variants']:
            path = self.static / item['url'].lstrip('/')
            with Image.open(path) as image:
                self.assertEqual(image.size, (item['width'], item['width'] * 3 // 2))
                self.assertEqual(image.format, 'WEBP')
        with patch('optimize_images.webp', side_effect=AssertionError('Unnecessary re-encode')):
            self.assertEqual(optimize_poster(self.url, self.static), result)
        # A missing derivative is repaired before a manifest can be published.
        (self.static / result['variants'][0]['url'].lstrip('/')).unlink()
        self.assertEqual(optimize_poster(self.url, self.static), result)
        Image.new('RGB', (800, 1200), '#114466').save(self.path)
        self.assertNotEqual(optimize_poster(self.url, self.static)['variants'], result['variants'])

    def test_small_image_is_never_enlarged_and_exif_orientation_is_applied(self):
        exif = Image.Exif()
        exif[274] = 6
        Image.new('RGB', (90, 60)).save(self.path, exif=exif)
        result = optimize_poster(self.url, self.static)
        self.assertEqual((result['width'], result['height']), (60, 90))
        self.assertEqual([v['width'] for v in result['variants']], [60])

    def test_corrupt_missing_and_escaping_sources_do_not_break_programme(self):
        self.path.write_bytes(b'not an image')
        films = [{'poster_url': self.url, 'poster_image': {'source': 'old'}},
                 {'poster_url': '/preview-data/posters/../../clint.png'},
                 {'poster_url': 'https://example.com/image.jpg'}, {}]
        prepare_images(films, self.static)
        self.assertTrue(all('poster_image' not in film for film in films))

    def test_mascot_preserves_supplied_rest_pose_and_gesture_timing(self):
        optimize_mascot_animation(self.static)
        with Image.open(self.static / 'clint-idle.webp') as idle:
            still = idle.convert('RGBA')
        with Image.open(ROOT / 'barcelona-mascot-point-right-brow-refined.webp') as original:
            expected = ImageOps.pad(original.convert('RGBA'), (160, 160),
                                    method=Image.Resampling.LANCZOS, color=(0, 0, 0, 0))
        for colour in ('white', 'black'):
            background = Image.new('RGBA', still.size, colour)
            self.assertEqual(Image.alpha_composite(background, still).tobytes(),
                             Image.alpha_composite(background, expected).tobytes())
        for name, expected_duration in [('point-right-brow-refined', 4700), ('poke', 760)]:
            with Image.open(self.static / f'barcelona-mascot-{name}.webp') as animation:
                self.assertEqual(animation.info['loop'], 1)
                self.assertEqual(animation.size, still.size)
                duration = 0
                for index in range(animation.n_frames):
                    animation.seek(index)
                    animation.load()
                    duration += animation.info['duration']
                self.assertEqual(duration, expected_duration)
                if name == 'point-right-brow-refined':
                    for index in (0, animation.n_frames - 1):
                        animation.seek(index)
                        for colour in ('white', 'black'):
                            background = Image.new('RGBA', still.size, colour)
                            self.assertEqual(Image.alpha_composite(background, animation.convert('RGBA')).tobytes(),
                                             Image.alpha_composite(background, still).tobytes())


if __name__ == '__main__':
    unittest.main()
