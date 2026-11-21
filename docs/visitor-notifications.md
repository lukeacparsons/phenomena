# VO Barna visitor notifications

[VO Barna New Users](https://t.me/c/3773662180/43418) receives new and returning
visitor alerts. Chat `-1003773662180`, topic `43418`, existing `@gp_steve_bot`.
The [PostHog destination](https://us.posthog.com/project/751818/pipeline/destinations/hog-01a1f5aa-cc52-0000-498a-5fc483f4203e)
belongs to VO Barna project `751818` and follows Ojo de Tortuga's session-based
notification flow. Its definition is in `scripts/posthog/`.

One alert is sent for the first eligible pageview, screening open, ticket click,
or search-results event in a browser session. A 24-hour masking key combines the
anonymous browser ID with the session ID, so reloads and subsequent interactions
in that session do not send more messages. PostHog starts another session after
30 minutes of inactivity or 24 hours.

New means there is no earlier recorded session for that anonymous browser ID.
Returning means there is at least one earlier session, including on the same day.
Returning alerts add total visits, 7/30-day counts, first/previous visits, past
pageviews and elapsed recorded session time. This time can include idle periods;
it is not a measure of attention. Both types show source, landing path,
approximate location, device/browser, language, and a PostHog event link.
No email address or raw IP address is included in messages.

`static/analytics.js` uses local storage for an anonymous PostHog identity,
replacing the previous daily cookieless identity. There are no analytics cookies,
identified person profiles or autocapture. Session replay is enabled with inputs
masked, search summaries and ticket links blocked, and query strings/fragments
removed from recorded page URLs. Console logs and network request/response bodies
and headers are disabled. Previous
cookieless visits cannot be linked retroactively. Clearing storage or using
another browser/device creates a new identity. When storage is blocked, the SDK
uses memory and the alert explicitly leaves the visitor unclassified. Failed
history queries also produce an unclassified alert rather than a false new-user
claim. The version filter excludes events from tabs using the old analytics code.

Do Not Track and Global Privacy Control prevent loading analytics. Only
`vobarna.com` and `www.vobarna.com` are tracked. Add `?internal=1` to any public
page to mark a browser internal persistently; `?internal=0` clears the marker.
Internal events and PostHog's test-account filter are excluded from delivery.
Search text, URL query strings, fragments and full referrer paths remain excluded
from analytics payloads.

## Browser instrumentation

The November 2026 instrumentation update adds `analytics_version=2` and a
locale-independent `page_type` (`home`, `film`, `cinema`, `guide`, their indexes,
`about`, or `other`). All events, including SDK-generated leaves and Web Vitals,
carry the internal-user and identity-persistence flags.

| Event | Meaning and useful properties |
| --- | --- |
| `$pageview` | Initial view or pathname change, including language navigation and back-cache restoration. Filter queries and fragments do not create additional views. Queued events retain their original timestamps. |
| `$pageleave` | PostHog's native document-leave event, flushed with a beacon on `pagehide`. Includes `$prev_pageview_id`, `$prev_pageview_pathname`, `$prev_pageview_duration` (seconds), and scroll/content-depth properties. |
| `ticket_click` | Existing handoff to the cinema operator, with film, screening, cinema and placement. It does not prove a purchase. |
| `screening_open` | Existing screening/detail interaction, with film, screening and placement. |
| `search_results` | Existing local result counts, now also with `has_query` and `has_results`. These counts can precede asynchronous smart-search/location refinement. |
| `smart_search_completed` | Smart-search outcome (`success`, `unsupported`, `no_semantic_results`, `unavailable`, `timeout`), duration in milliseconds, query length, semantic candidate count, unsupported count and cache-hit flag. Superseded/cancelled requests are omitted. This is not the final filtered screening count. |
| `language_switch` | Language-choice click, with `from_language` and `to_language`. Measures intent; the subsequent pageview confirms navigation. |
| `outbound_click` | Non-ticket HTTP(S) link click, including middle-click, with destination hostname and header/footer/content placement. No link text, destination path or query is sent. |

For in-document navigation, PostHog attaches the previous view's duration and
scroll data to the next `$pageview`; it does not need an extra `$pageleave`.
Match `$prev_pageview_id` to the original view's `$pageview_id`. Back-cache
restores start a new view and discard the SDK's stale previous-view metrics,
so time spent away is not counted again. Duration is elapsed time, not attention.
Short visits that end before the deferred SDK loads, blocked analytics and mobile
process termination can still miss leave events. Existing masked replay and Web
Vitals capture remain enabled. New search metrics contain no query text, intent,
address, coordinates or provider error messages.

Lifecycle configuration follows the [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
and [SDK pageview accounting](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/page-view.ts).

## Operations

Credentials live in ignored `.deploy-secrets/posthog.env` and
`.deploy-secrets/visitor-telegram.env` (mode 0600). PostHog stores the Telegram URL
and query Authorization header as secret inputs. Never include these values in
Git, browser assets or logs. A query-only `POSTHOG_QUERY_API_KEY` can be supplied
separately; otherwise the sync uses `POSTHOG_API_KEY` for history requests.
Required PostHog scopes include `project:read`, `query:read`,
`hog_function:read` and `hog_function:write` for project 751818.

```sh
node --env-file=.deploy-secrets/posthog.env scripts/posthog/sync-visitors.mjs --status
# Stage changes with delivery disabled; include the bot env for initial creation.
node --env-file=.deploy-secrets/posthog.env --env-file=.deploy-secrets/visitor-telegram.env scripts/posthog/sync-visitors.mjs --apply
node --env-file=.deploy-secrets/posthog.env scripts/posthog/check-visitors.mjs
node --env-file=.deploy-secrets/posthog.env scripts/posthog/sync-visitors.mjs --enable
node --env-file=.deploy-secrets/posthog.env scripts/posthog/sync-visitors.mjs --disable
```

The sync checks the public project token before writing, finds this destination
by exact name, and rejects duplicate definitions. Updating without the bot env
preserves the stored Telegram secret. Disabling this destination pauses alerts;
analytics and other sites' alerts continue independently. No historical backfill
is enabled.

PostHog durably queues destination fetches. The Hog code makes at most four
delivery requests, stops on a Telegram receipt, and does not retry permanent 4xx
errors. Check `DELIVERY_RECEIPT`, `DELIVERY_RETRY` and `DELIVERY_FAILED` in its logs.
A lost response after Telegram acceptance can still cause a duplicate; delivery
is not an exactly-once guarantee.

## Verification

`node --test scripts/test_analytics.mjs` tests event sanitization, internal marking,
privacy preferences and memory fallback. `scripts/test_visitor_analytics_browser.mjs`
uses the real SDK with all requests intercepted to test stable identity, session
expiry, reloads, cleared/blocked storage, preview exclusion, blocked SDK, leave
beacon payloads, scroll/duration properties, language/outbound clicks and a simulated
back-cache lifecycle. SDK bot filtering is disabled only in this intercepted
fixture because Chromium reveals its automation identity during pagehide. It
never ingests production events or sends notifications.
Set `PLAYWRIGHT_MODULE` to an installed Playwright module and download the SDK to
`output/visitor-notifications/posthog-sdk.js` (or set `POSTHOG_SDK_FILE`).
`scripts/test_session_replay_browser.mjs` uses the real SDK and recorder with every
request intercepted. It checks that snapshots contain the public page while
excluding typed input, search summaries, booking links, URL queries/fragments and
console messages. Set `POSTHOG_TEST_ASSET_PREFIX` to downloaded fixture files named
`<prefix>-sdk.js` (`/static/array.js`), `<prefix>-posthog-recorder.js` (the SDK's
matching versioned recorder), and `<prefix>-remote-config.json` / `.js` (the
project's `/array/<public-token>/config` and `config.js`). The default prefix is
`output/session-replay/posthog`. `PLAYWRIGHT_MODULE` can point to Playwright's
`index.mjs` when it is installed outside this repository.
`check-visitors.mjs` runs live PostHog previews without sending Telegram messages
or ingesting events. Delivery tests must use `notification_test=true`, a synthetic
identity and a `TEST` heading.

References: [PostHog destinations](https://posthog.com/docs/data-pipelines/destinations),
[Hog functions API](https://posthog.com/docs/api/hog-functions),
[cookieless identity limitations](https://posthog.com/tutorials/cookieless-tracking),
[Telegram Bot API](https://core.telegram.org/bots/api).
