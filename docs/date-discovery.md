# Date discovery pages

VO Barna publishes indexable, localized Today and Tomorrow pages using the normal film grid. The existing This Weekend guide remains indexable.

| Language | Today | Tomorrow |
| --- | --- | --- |
| English | `/en/showtimes/today/` | `/en/showtimes/tomorrow/` |
| Spanish | `/es/cartelera/hoy/` | `/es/cartelera/manana/` |
| Catalan | `/ca/cartellera/avui/` | `/ca/cartellera/dema/` |

Each page has its own canonical URL, reciprocal language alternates, dated title and description, WebPage data, sitemap entry and footer links. The absolute date and Europe/Madrid timezone are visible. All collected upcoming sessions for the chosen date are readable in HTML: the first film-card batch is followed by an expandable complete listing. No JavaScript is required to read the screenings or follow film, venue and ticket links.

`/{language}/?date=YYYY-MM-DD` returns the selected day's HTML with a self-referencing canonical and `noindex,follow`. These filter URLs are excluded from the sitemap. Other filter combinations remain noindex. A valid date without collected upcoming sessions gives an explicit, dated empty state; it does not claim that cinemas have no screenings. Invalid or repeated `date` parameters return 404. Additional filters on a relative-day route temporarily redirect to the ordinary programme with the resolved calendar date.

The build generates bounded date fragments and three reusable page shells per locale. Node, the local Python server and the legacy Cloudflare handler compose them from the same atomic publication. No request collects cinema data. The internal `/date-views/` assets are not public routes. Full static copies of Today and Tomorrow are generated for build validation and publication manifests; the routers resolve the actual Madrid date on every request so midnight does not depend on a rebuild. A missing date uses the honest empty fragment. Programme collection timestamps remain visible and distinct from the current date.

HTML caching is limited to 60 seconds and cannot cross Madrid midnight. Dynamic responses have content-based ETags at the Node origin. The browser refreshes an open relative-date page after midnight or when restoring a stale tab. Choosing another date or applying other filters uses the ordinary programme URL; opening and closing a film retains the original relative-day view when its filters are unchanged.

Validation:

```sh
npm run site:check
npm run site:build
VOBARNA_PUBLIC_URL=http://127.0.0.1:8808 node scripts/test_date_browser.cjs
```

The browser check accepts `PLAYWRIGHT_MODULE`, as do the existing browser checks. Tests cover localized metadata, the full HTML listing beyond the first card batch, empty and invalid dates, Madrid midnight and both DST changes, request-time rollover without a rebuild, HTTP caching/indexing isolation, modal return, language/date navigation, mobile width and stale-tab refresh.
