# Complete programme in the homepage HTML

The EN, ES and CA homepages include a native, closed **Complete programme** disclosure at the bottom of `main`, before the footer. It contains every collected upcoming film and screening in the initial response. It remains available when JavaScript is disabled, the catalogue request fails, or the visitor filters the poster grid.

`scripts/complete_programme.py` renders compact text grouped by film, local date, cinema, room, audio, subtitles, version and format. Missing session languages stay unconfirmed; film-level language metadata is not used to fill them. Expired sessions are omitted during publication. The section displays its snapshot date and the Barcelona time zone.

Screening links use the canonical film URL and screening fragment. With the catalogue loaded, the existing homepage click handler resolves that fragment and opens the selected session in the film modal. Without JavaScript, the same link opens the static film page. Modified clicks retain normal browser behaviour.

The poster grid, its batch sizes, image loading and collapsed footer navigation remain independent. The disclosure adds no images, JavaScript module or stylesheet request. Its small stylesheet is inlined on homepages only. Native `details` keeps the content collapsed; `content-visibility: auto` defers layout of offscreen film sections when expanded. The programme is identical for human visitors and crawlers.

Validation:

```sh
.venv/bin/python -m unittest discover -s scripts -p test_complete_programme.py
.venv/bin/python -m unittest discover -s scripts -p test_public_site.py
VOBARNA_PUBLIC_URL=http://127.0.0.1:8795 node scripts/test_complete_programme_browser.cjs
```

The browser check covers the closed state, complete DOM content, JavaScript failure, native keyboard expansion, mobile overflow, search preservation and selection of the correct screening with keyboard access to Tickets. Availability in HTML does not control whether an external AI reader truncates or filters its extraction.

The initial acceptance snapshot included 296 films and 2,990 unique screening links in every locale. Compressed homepage HTML was about 125 KB, an increase of about 95 KB; no image or asset requests were added. A controlled mobile comparison (390 px, 4× CPU slowdown, Fast 4G, two cold runs per variant) measured average LCP of 1.87 s before and 1.91 s after, with zero layout shift in all runs. These are lab observations, not field guarantees. Detailed evidence is in `homepage-complete-programme-checks-2026-11-19.json`.
