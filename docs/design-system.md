# VO Barna visual system

The programme, film pages, cinema profiles, directories and guides use the same flat visual language. The decorative pattern remains visible. Typography, alignment and spacing group content. Cards and information sections have no enclosing border or solid panel; a feathered wash behind film text improves readability.

This describes the design agreed on 20 November 2026. It applies to the generated VO Barna site and `/webmcp/`. The separate original Phenomena booking application in `static/index.html` is outside this system.

## Ownership and reusable components

| Concern | Owner | How to reuse it |
| --- | --- | --- |
| Light/dark colours and pattern contrast | `static/theme.css` | Use `--bg`, `--tx`, `--tx2`, `--tx3`, `--red`, `--focus` and the background variables. Do not introduce local palettes. |
| Dimensions, spacing, corners and link treatment | `static/ui-components.css` | Use the tokens in its `:root` block. |
| Flat information sections | `.content-block` in `ui-components.css` | Add to a semantic section/article. Used by cinema rooms, comparisons, discount offers and agent-guide tools. |
| Reading wash | `.reading-wash` and `.card-body` in `ui-components.css`, `--reading-wash` in `theme.css` | A shared feathered, theme-coloured layer behind film-card text, film-page information and schedules, and focused modal content. `film-view.js` applies the component in both generated HTML and browser views. |
| Secondary text actions | `.text-action` in `ui-components.css` | Underlined link with a 44px target; used for the cinema website action. |
| Film ratings | `.film-ratings`, `.film-rating`, `.rating-*` in `ui-components.css` | Markup comes from `film-view.js`. Contexts may set `--rating-columns` or `--ratings-gap`; do not duplicate rating styles. |
| Full schedules | `.showtimes-summary`, `.schedule-*` in `ui-components.css` | `film-view.js` renders the same date/cinema/time groups for the film page and showtimes modal. |
| Listing cards | `static/listing-view.js`, `static/cinemas.css` | `createListingView()` supplies both generated HTML and the enhanced listing. Avoid separate page-specific card implementations. |
| Film details and screening views | `static/film-view.js` | `filmMarkup()` renders `film`, `showtimes`, `screening` and standalone-page contexts. |
| Modal interaction | `static/film-dialog.js`, `static/cinemas.js` | One dialog with focused views; use `getDialogScroller()` to read or restore its scroll. |
| Poster markup and loading | `static/progressive-images.js`, `Builder.poster()` in `scripts/build_public_site.py` | Both output dimensions, `--poster-ratio`, aspect ratio and optimized-image metadata. Keep the server/no-script path compatible with the browser renderer. |
| Page composition | `scripts/build_public_site.py`, `static/site.css` | Page-specific layout only; reuse shared components for their contents. |
| Complete programme and agent guide | `static/complete-programme.css`, `static/webmcp-guide.css` | Local composition, shared colours/tokens/content sections. |

Every VO Barna entry point loads `cinemas.css`, `theme.css`, then `ui-components.css`. Generated pages add `site.css`; the agent guide adds `webmcp-guide.css`. The legacy VO Barna development shell also loads the components. Add new public assets to the builder's publication list.

## Layout and hierarchy

- Desktop listings have a 1,240px maximum outer width, four columns from 1,200px, and 32px column gaps. That leaves 276px-wide poster frames at maximum width. Tablet layouts use two or three columns; phones use one column with 300px-wide movie content.
- Full film pages use a 760px maximum outer width. The desktop poster is 200px wide beside the film information. On mobile, the poster and information share a centred column up to 320px wide.
- General pages use the 1,160px content token, growing only up to the same 1,240px site maximum on large screens. Agent-guide reading content uses 920px. Long prose is constrained independently of wide data layouts.
- B612 is the body font; Bungee is reserved for the brand. Film-card titles are 18px, film-page titles 22px on mobile and 28px on desktop, and general page titles up to 32px. Metadata and attribution remain quieter than titles and dates.
- Listing dates are 14px; full-schedule dates are 16px. Cinema labels and times form stable side-by-side columns. Use 24px between mobile date groups and 32px on desktop. Within a day, keep each cinema's times together and use the shared 6px `--space-cinema` gap between cinema groups, in cards, film pages and showtimes modals.
- Time links use the primary text colour and a persistent underline; cinema names use the quieter secondary text colour. Dates retain the stronger weight. Time links turn accent-coloured on hover, keyboard focus and press, with a stronger underline. “More showtimes” and primary booking actions retain their accent treatment. This applies to listing cards, film-page and modal schedules, and the complete programme. Keep visible keyboard focus; colour alone must not identify an action.
- Touch targets are at least 44px. Tight desktop listing rows may be 40px on fine pointers, with 44px on coarse pointers. Paragraph links need not be turned into oversized blocks.

The homepage has no introductory prose above the filters. Navigation and explanatory material remain in the footer and relevant information pages. Film pages have no extra “Films” breadcrumb above the poster.

## Posters and surfaces

All poster artwork has the same 6px corner radius, provided by `--poster-radius`. Keep the entire image visible. Round the actual image bounds, including posters whose proportions differ from the frame. The `--poster-ratio` emitted by both renderers lets CSS size the image without depending on a tiny preview's natural dimensions.

Desktop card frames have a consistent 2:3 ratio. The image fits within that frame and aligns to its bottom, so posters of different proportions share the same bottom edge and 18px gap to the title. Artwork is not cropped or stretched. The progressive-image fade also aligns to the bottom. Mobile artwork stays within the established width and height limit, with a 20px gap to the title. Preserve these dimensions during progressive loading.

When changing listing geometry, also update `LISTING_POSTER_SIZES` in `build_public_site.py`; its first-poster `sizes` attribute must match the rendered widths and the loader's 2× density cap. Run the image-loading checks after a sizing change.

Cards, empty-result states, room descriptions and guide sections are flat. Functional controls may retain borders or surfaces: search fields, selected dates, menus, primary booking actions, and code samples. Fine table/disclosure separators may clarify structure. Do not add a decorative box around an ordinary content group.

Film-card text uses a soft wash at 78% of the theme's background colour. It covers the title, metadata, screenings and more-showtimes link, fading out on all four sides. It starts below the poster and preserves existing widths, spacing and alignment. The pattern remains visible through the wash and between films. Use the shared `.card-body` component rather than adding local panels or text shadows. Its decorative layer ignores pointer events and sits behind the text; it must not obscure keyboard focus or introduce horizontal scrolling. The side feather narrows from 20px to 14px on phones at or below 360px.

Film-page information and schedules use the same treatment through `.reading-wash`. Film details, showtimes and screening modals also use it, inset to their content gutters. Contexts can adjust the wash's top, bottom and side insets without changing the common colour or feathering. The component uses `::after`, leaving the showtimes header's opaque `::before` shield intact; the title stays readable and scrolling text remains hidden beneath it. Apply the wash once per reading section, not to nested ratings, individual dates or every row.

The pattern is fixed behind scrolling content. Light mode keeps a 65% paper-colour wash; dark mode uses the existing filtered artwork and palette. Check text against the actual pattern in both themes, especially secondary labels and links.

## Film navigation and motion

- On the homepage and date listings, show the earliest matching day, with up to three cinemas and the first two matching times at each. When that day has at least four cinemas or twelve matching screenings, expand the preview to four cinemas and three times each. This lets broad availability remain visible while bounding the longest lists. Judge breadth within the current filters and preview day. `HOME_CARD_PREVIEW` in `listing-view.js` is the single policy used by the publisher and browser renderer. Preserve chronological ordering and the existing date labels. The cinema-profile listing retains its two-day preview.
- Whenever the preview omits any matching session, retain the localized “N more showtimes →” link. The count communicates the breadth of remaining availability and includes omitted sessions from the previewed day as well as later days. The focused showtimes modal includes all matching sessions. Preview limits must never truncate the underlying schedule. There is no inline date picker or expanded schedule inside the card.
- When a displayed cinema has additional matching times on that day, append a quieter, underlined “+N more” link within its time group. This local count excludes other cinemas and dates; those screenings remain included in the film-wide total. The link opens the full schedule and reveals/focuses the first omitted time, retaining the date and cinema context when it fits. Without JavaScript, it links to the film page's complete schedule. Do not add the cue when that cinema's displayed day is complete.
- The poster/title opens film details; a time opens one screening with its booking action. The showtimes title links to film details within the same dialog. All three views share the same 640px desktop maximum width and top anchor.
- The dialog's outer surface owns the background; only `.dialog-surface` scrolls. The showtimes header remains fixed. Its mask is fully opaque behind the title and poster, fading only through the bottom 20px of padding. It must not dim the first date at rest.
- Same-film detail/showtime changes animate the title, poster and dialog height over 280ms and crossfade surrounding content. Respect reduced motion. Cancel safely on close, resize and repeated navigation.
- Returning to showtimes restores its scroll. Closing the dialog restores the originating listing/page position and focus. The floating back-to-top button is intentionally absent.
- Standalone film pages contain the complete schedule in their initial HTML. `#showtimes` scrolls to that schedule; `#screening-…` opens one screening. Without JavaScript, page time links go directly to the operator's booking destination.

## Verification and extension

Build before inspecting the public preview: it serves `.site/current/public`, not the source directory.

```sh
npm run site:build
npm run site:check
npm run site:test:styles
node scripts/test_film_sheet_browser.cjs
npm run site:test:browser
npm run images:test:browser
```

Browser commands accept `VOBARNA_PUBLIC_URL`; set it to the running preview. `PLAYWRIGHT_MODULE` can point to an existing Playwright installation. The style audit defaults to port 8811 and writes screenshots plus `report.json` under ignored `output/style-audit/`.

The style audit checks every generated document for the shared stylesheet, then visits representative homepage, today/tomorrow, archive, film, cinema, directory, guide, discovery, discounts, programme, about, agent-guide and 404 pages. It covers desktop/mobile, light/dark and additional localized routes. It checks overflow, poster radii, flat surfaces, component adoption and mobile action sizes. Review the screenshots as well as the assertions.

For a new page, reuse an existing renderer and shared component first. Keep page-specific CSS focused on composition. A reusable appearance rule belongs in `ui-components.css`; theme colours belong in `theme.css`. Add the new page family to the style audit when it introduces a different layout. Maintain ordinary HTML, keyboard operation, deep links and no-JavaScript fallbacks.
