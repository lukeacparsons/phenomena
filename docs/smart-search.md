# Homepage smart search

Search combines three layers through the existing search box, in English, Spanish and Catalan:

1. Local parsing handles ratings (`rt > 80%`, `imdb >= 7`), review counts, genres (`funny movies`), production countries (`from France`), audio languages (`in French`), actual Certified Fresh badges, lengths, screening times, cinemas, chains and formats. The existing date parser handles relative dates. Unknown metadata never satisfies a factual filter.
2. A server-side interpreter turns more complex wording into validated conditions. GPT-6.2 Sol uses the `ultrafast` service tier with low reasoning and strict structured output. Existing deterministic constraints are preserved. It cannot invent film facts or screenings. Unsupported requests are displayed above the results.
3. `text-embedding-3-large` (3,072 dimensions) retrieves separate film, plot and topic passages. The same fast interpreter call uses retrieved evidence plus its film knowledge to select and order catalogue films for topics, moods, similarity and visual style such as black-and-white cinematography. A known reference film contributes its real catalogue description. Exact filters still apply to every selected film. AI match scores express ordering, not cosine similarity or factual confidence. Results are approximate and depend on metadata coverage.

Filter chips show the interpretation and can be removed. The original query and removed chips are shareable in the URL. Exact title/person and cinema-chain searches retain their existing behaviour and theatre labels.

Subjective source-qualified requests such as `highly rated on IMDb` go to the interpreter, without local RT defaults. That example becomes IMDb ≥7.5 and sorts by IMDb score. Numeric expressions such as `IMDb >7.5` remain local. The visible chip makes the inferred threshold explicit and removable.

Regional requests such as `from Catalunya` use AI-assisted discovery from retrieved descriptions and the model's reliable film knowledge. They are labelled `AI matches`, with a removable semantic interpretation, rather than claiming verified regional production metadata. The model may identify a film's connection to regional cinema but must not substitute a mandatory Spain or Catalan-language filter. `In Catalan` still uses exact audio-language metadata; separately requested ratings, countries and screening constraints remain mandatory. Setting or mentioning a region alone does not establish regional origin.

## Runtime configuration

Set `OPENAI_API_KEY` as a **runtime-only secret on the website application**, never as a build argument, browser variable or collector credential. Defaults are `SEARCH_MODEL=gpt-6.2-sol`, `SEARCH_SERVICE_TIER=ultrafast`, `SEARCH_EMBEDDING_MODEL=text-embedding-3-large`. The Sol interpreter uses low reasoning; other configured models use none and must support the strict schema. Without credentials, local search continues and semantic requests show a brief availability message.

For local development, `npm run dev` starts a private Node companion and forwards `/api/search` to the same engine. Set `OPENAI_API_KEY` in the shell or the ignored root `.env.local` file. Both public and legacy preview modes support it. Restart a running preview after Python/Node server changes; refreshing the browser alone does not reload server code.

`POST /api/search` accepts only `{query, language}`. It uses no-store responses, checks browser origin and JSON content type, bounds request/query sizes, validates model output, and returns generic provider errors. The key and embeddings are never served. Search text is sent to OpenAI with `store:false`; raw queries are not logged by this service.

The browser waits 350 ms after local search settles, cancels superseded requests and uses a 6-second deadline. Film/plot/topic embeddings warm on startup and catalogue refresh; content hashes reuse unchanged vectors; query vectors stay in memory to avoid rewriting the larger disk cache on every search. Startup also primes the interpreter with one generic mood search to reduce the first user's cold-start delay. A private cache defaults to `.site/search-cache/embeddings.json` (`SEARCH_CACHE_DIR` overrides it). This cache is rebuilt on container replacement unless mounted persistently. Identical requests are coalesced, and completed interpretations have bounded in-memory browser/server caches. Relative dates expire with the Madrid calendar day.

Limits per process: four active AI requests, 30 uncached queries per connection IP per minute, and `SEARCH_DAILY_LIMIT=1000` uncached interpretations per Madrid day. The IP limit is conservative behind a shared proxy. These reset on restart and are not an account spending limit. Standard filters and cache hits do not use the AI quota.

Certified Fresh is read from Rotten Tomatoes' critics scorecard, independently of its numeric score and audience badge. Existing ratings missing that field refresh on the next metadata cycle. Publisher descriptions also refresh into the film metadata cache; no model-generated descriptions are stored as facts.

## Validation and latency

`node --test scripts/test_smart_search.mjs scripts/test_public_server.mjs` covers comparisons, missing data, language/origin distinction, badges, screening constraints, filter removal, semantic ranking, validation, caching, quotas, endpoint boundaries and stale responses. `npm run site:check` covers publication and serving. `node scripts/test_smart_search_browser.cjs` exercises the rendered interface with deterministic responses; set `VOBARNA_PUBLIC_URL` and `PLAYWRIGHT_MODULE` as needed.

`node scripts/benchmark_search.mjs` is an opt-in live benchmark that uses `OPENAI_API_KEY` and writes timings/plans to ignored `output/smart-search/model-benchmark.json`. On 20 November 2026, all three multilingual samples passed for both Luna fast (848–1668 ms) and Sol ultrafast (1050–1631 ms). Luna initially had comparable latency with lower cost. It was subsequently replaced by Sol ultrafast after film-knowledge checks showed colour films incorrectly included in black-and-white searches. These are small-sample API observations, not a latency guarantee; complete searches also include network and embedding work. Local search makes no model call. Qualified producer requests, including `produced by Brad Pitt`, use producing credits separately from acting credits.

Search indexes plot text for literal subject names as well as vectors. Topic phrases such as `civil war` go to the interpreter without a mandatory War genre. Keyword hits no longer suppress semantic retrieval. Publisher SEO descriptions are rejected; actual RT synopses and FilmAffinity story topics are refreshed with search-content version 2. Available complementary synopses and cast/crew beyond the first eight are retained. Changing the embedding model or dimension invalidates the old vector cache.

Release years use original film metadata: `70’s released` becomes Released ≥1970 and ≤1979, including both boundaries and excluding unknown years. Story settings such as `set in the 1970s` remain semantic. Unsupported requested constraints produce no matches instead of expanding to unrelated catalogue results.

Black-and-white searches use the verified Wikidata P462 colour attribute as a hard filter. Colour and unknown-format films do not satisfy it; model recollection cannot override that fact. Metadata schema version 3 refreshes this property. Semantic knowledge remains useful for themes and descriptions not represented by exact fields.

## Production-country evidence and company searches

Country filters include co-productions and show the matching production countries with a source link on each result. FilmAffinity's explicit co-production list is collected as well as its main country; distributors are stored separately from production studios and individual producers. Wikidata country additions require a supporting reference URL or stated source. Unreferenced claims are retained as reports for inspection but cannot satisfy a country filter or leak back through keyword aliases. Reviewed complete production lists in `scripts/film_country_evidence.json` take precedence over conflicting aggregator claims; each records its source and review date. Missing evidence remains unknown. Metadata versions 3 (publishers) and 4 (Wikidata) refresh these fields.

A bare known company such as `A24` matches production **or** distribution credits (`company`). `produced by A24` requires a production credit, while `distributed by A24` requires distribution. Cinema chains retain priority for an unqualified overlapping name such as Filmax. These known-company searches run locally; the interpreter uses the same distinctions for other wording. Company credits refer to a film's association with the company, not necessarily its Spanish distributor.

`new releases`, `latest releases`, `estrenos` and `novetats` mean films whose original release year is the current Madrid calendar year, shown explicitly as a Released YEAR chip. This is a broad year-based interpretation, not a claim that a film opened recently in Spain. It requires no AI call or exact theatrical date. Specific release-period requests still require territory/date evidence. Cached local interpretations expire at the Madrid day boundary.
