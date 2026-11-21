"""Portrait selection and the shared 20% height range."""

import unittest

from poster_policy import is_portrait, meets_target, usable_poster, prefer_poster


class PosterPolicyTests(unittest.TestCase):
    def test_height_range_includes_both_boundaries_and_standard_posters(self):
        for size in ((600, 800), (600, 900), (600, 960)):
            self.assertTrue(is_portrait(*size), size)
        for size in ((600, 799), (600, 961), (600, 600), (1200, 630), (0, 900)):
            self.assertFalse(is_portrait(*size), size)

    def test_portrait_quality_takes_priority_over_pixel_count(self):
        portrait = dict(poster_url='/portrait.jpg', poster_width=500, poster_height=721)
        banner = dict(poster_url='/banner.jpg', poster_width=2560, poster_height=1440)
        self.assertFalse(meets_target(500, 721))
        self.assertTrue(prefer_poster(portrait, banner))
        self.assertFalse(prefer_poster(banner, portrait))

    def test_target_shape_preferred_to_larger_short_portrait(self):
        poster = dict(poster_url='/poster.jpg', poster_width=600, poster_height=900)
        short = dict(poster_url='/short.jpg', poster_width=2000, poster_height=2500)
        self.assertTrue(prefer_poster(poster, short))

    def test_wider_festival_poster_replaces_still_but_not_standard_poster(self):
        festival = dict(poster_url='/festival.jpg', poster_width=2650, poster_height=3001)
        still = dict(poster_url='/still.jpg', poster_width=2560, poster_height=1085)
        standard = dict(poster_url='/standard.jpg', poster_width=600, poster_height=900)
        self.assertTrue(usable_poster(2650, 3001))
        self.assertTrue(prefer_poster(festival, still))
        self.assertTrue(prefer_poster(standard, festival))
        for size in ((900, 1000), (901, 1000), (1000, 1000), (1920, 1080)):
            self.assertEqual(usable_poster(*size), size == (900, 1000), size)


if __name__ == '__main__':
    unittest.main()
