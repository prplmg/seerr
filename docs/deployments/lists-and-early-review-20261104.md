# Lists and early viewing release — 2026-11-04

## Verified diagnosis

Public imports previously held the POST open while reading pages and serially matching films, then fell back to the anonymous browser worker. The UI flattened transport errors and the one-minute repeat-attempt cooldown into a generic failure. Live logs show repeated list failures caused by Black Mirror: San Junipero; a direct read returned HTTP200 with a real title and `data-tmdb-type="movie" data-tmdb-id=""`. This is an explicitly unmapped entry, not a network challenge. No specific historical cause was established for Multimeldia bookmark-save failures; the endpoint previously converted all storage exceptions into404, hiding that distinction. The live list store was only571607bytes (30lists), far below its32MiB cap.

## Implementation

- Durable immediate202 import jobs, direct anonymous reads before browser fallback, two concurrent direct imports, same-URL pending-job deduplication, max3pending imports per user/40total. Job status resumes unfinished direct work after restart. UI spinner and pending-submit lock, actual server error display, no unnecessary synchronous library refresh before job tracking.
- Explicit empty/zero TMDB identities remain unmatched entries; transient/challenge failures cannot silently truncate snapshots. Browser-received metadata failures retain verified snapshots and retry up to3times with30/60second backoff, then show a terminal error. Worker status checks resume retries without requiring the import page to remain open.
- Save errors distinguish unavailable lists404 from storage/service503, with user/list/error context logged. Existing mutations remain idempotent. Past intermittent saves are not claimed fixed without evidence; future failures are diagnosable.
- Whole-list Letterboxd rating ascending/descending and movie runtime ascending/descending, stable ties/missing values last, then20item pagination. Shared two-worker metadata queue, opt-in only, persisted cache24h successes/15m missing values, bounded30kentries. First uncached sort waits visibly for values. No extra sorting work for original order. TV runtime deliberately unknown rather than misrepresented as series duration.
- Bottom-right poster badges for active sort and bookmark/count for Watch Together. No new row footer text. Context-specific badges only.
- Separate lazy request for private Plex/Letterboxd watchlist cards in My lists/All. Read-only virtual lists use existing source snapshots/matching/cache; no source writes, copies, or save/edit controls. No addition to other discovery rankings. Existing authenticated-user/admin-preview scoping retained.
- Includes tested ten-minute exact-session review association and pending publication-alert persistence fix; see early-review-20261104.md. No activity logging.

## Validation

67 focused regression tests passed, including real OpenAPI middleware, private list routes, import job restart/deduplication, retry exhaustion, invalid TMDB evidence, ordering, watchlist matching, early viewing and publication continuation. Server/client TypeScript checks and focused lint passed. Browser fixtures at390px and1440px passed sort changes/badges, read-only watchlists, actionable save errors and pending import spinner; no JS errors or horizontal overflow. These use actual list-page components with mocked APIs, modal and poster boundary components, not an end-to-end live import/publication test. Temporary browser harness excluded from source commit.

## Deployment

Prepared for scoped release; completion receipt and live verification pending. Existing settings/toggles must remain unchanged. Previous live build/source preserved by deployment wrapper; no Git push.
