# Crawlable complete programme

The EN, ES and CA homepages include a native, closed **Complete programme** disclosure at the bottom of `main`, before the footer. Its initial HTML links directly to every programme page: `/en/programme/`, `/es/cartelera/` and `/ca/cartellera/`, followed by `/page/2/` and subsequent pages. Each page contains ordinary, visible HTML screenings, a self-canonical URL, localized hreflang links and previous/next links. All programme pages are included in the sitemap and IndexNow manifest. JavaScript is not required to discover or read any screening.

`scripts/complete_programme.py` partitions all upcoming screenings alphabetically by film, in batches of at most 1,000 sessions. Batches that exceed 600,000 UTF-8 bytes in any locale are split again, including oversized single films. Locale boundaries match. Every future screening appears exactly once per locale. The renderer groups by film, local date, cinema, room, audio, subtitles, version and format. Missing session languages stay unconfirmed; film-level language metadata never fills them. Pages show the collection time and Barcelona time zone.

Opening the homepage disclosure optionally fetches these same HTML pages, with at most three concurrent requests, and inserts their screening entries. Nothing is fetched while the disclosure remains closed. Completed content is reused on reopening. If a request fails or the programme has changed since the homepage loaded, the original links remain available; reopening retries. A shared version hash prevents combining different snapshots. The script is independent of the search catalogue, so a failed catalogue fetch does not prevent reading the programme. Humans and crawlers receive the same HTML.

The homepage retains its usual 24 initial film cards and interactive batch size. The full programme remains linked regardless of grid filtering. Screening links use canonical film URLs and screening fragments; when the search catalogue is available, the existing click handler opens the exact screening modal. Otherwise they navigate normally to static film pages.

The small programme stylesheet is inlined on the homepages and programme pages. The mascot has localized descriptive alt text; its button retains its action label, and the animation overlay remains hidden from assistive technology.

Validation:

```sh
.venv/bin/python -m unittest discover -s scripts -p test_complete_programme.py
.venv/bin/python -m unittest discover -s scripts -p test_public_site.py
VOBARNA_PUBLIC_URL=http://127.0.0.1:8795 node scripts/test_complete_programme_browser.cjs
```

The browser check covers no-JavaScript navigation, delayed loading, reuse, failed catalogue and programme requests, keyboard disclosure activation, mobile overflow, grid preservation and selection of the exact screening modal. Python checks cover lossless pagination, byte limits, localization, unconfirmed audio, expired screenings, sitemap inclusion and HTML fallbacks.

This replaces the original all-in-one homepage response, which was about 1.29 MB uncompressed. The original performance measurements in `homepage-complete-programme-checks-2026-11-19.json` describe that earlier implementation.
