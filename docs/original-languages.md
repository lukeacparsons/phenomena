# Original-language collection

Run `npm run preview:languages` to refresh language metadata and its review queue without changing screening times or availability. The regular film-metadata enrichment also runs this pipeline. It uses the same atomic programme update mechanism as other metadata writers.

## Credentials

TMDB accepts `TMDB_READ_ACCESS_TOKEN` (or `TMDB_ACCESS_TOKEN`) through an environment variable, with `TMDB_API_KEY` as an alternative. The local runner also reads `.env.tmdb` at the repository root; this file is ignored by Git and should have mode `0600`. Put credentials in the scheduler's secret environment on other machines. They are never written into programme data, caches, URLs in reports, or error messages. Without a credential, cinema and existing publisher evidence still work.

## Evidence and resolution

- Preserve explicitly labelled originals from cinema APIs, cinema film pages, Rotten Tomatoes and TMDB. Keep raw wording, source URL, source film identity, observation date and any unrecognised labels.
- Preserve screening audio and subtitles separately. VOSE alone does not identify the original language. An explicitly named language on a verified original-version session is supporting evidence with its own evidence type.
- Never infer language from nationality, title spelling, interface language or subtitle language. Originals inherited from our own registry do not count as independent confirmation.
- TMDB lookup uses exact IMDb identity and confirms that identity in the returned movie details. For films without IMDb, a cinema-page title, director and release year must corroborate one unique movie; runtime contradictions reject candidates. Title-only searches and individual components of double bills cannot establish identity.
- `details.languages` is the selected display/search value. `details.original_languages` contains its language codes; `details.spoken_languages` is a separate, broader TMDB list, not an original-language replacement.
- Conflicting lists remain separate in `language_reports`; the resolver never unions them. An existing supported explicit value is retained when appropriate. Source priority chooses a provisional value, not proof that the disagreement is resolved. The modal labels conflicting values “Languages” rather than asserting “Original language”.
- Language normalisation distinguishes Mandarin, Cantonese and generic Chinese. Unrecognised labels make a claim incomplete and require review; recognised portions cannot silently masquerade as a complete list.
- Explicit “no dialogue” is represented by `zxx` / “No spoken language”. Mystery previews, mixed programmes and other events without enough evidence stay unresolved. Do not invent one language for every programme entry merely to reach 100% coverage.

## Caches and review

All files are under `static/preview-data/`:

| File | Purpose |
| --- | --- |
| `language-review.json` | Per-provider coverage, unresolved/conflicting entries, raw evidence, next action and coverage regressions |
| `cinema-languages.json` | Parsed cinema pages and last supported film language metadata |
| `language-sources.json` | Discovered film links and original-language claims from native feeds |
| `tmdb-languages.json` | Exact-identity TMDB results and corroborated source-page matches |

Cinema pages and successful TMDB records refresh daily. Native feeds/indexes refresh every six hours; failed native/TMDB lookups become eligible after an hour. The regular metadata runner checks new films and refreshes daily; `preview:languages` can run independently whenever needed. Cached observations retain their real timestamp through outages. Each enrichment run regenerates the review queue, including source conflicts and unfamiliar language labels. A disappearing previously known language is recorded as a regression.

The current language-name table is intentionally explicit and extensible, not a probabilistic language detector. New labels require a reviewed mapping in `scripts/language_names.py` and a regression test. Use exact source URLs in `scripts/cinema_language_sources.json` to repair discovery gaps, with film identity still checked against the page.
