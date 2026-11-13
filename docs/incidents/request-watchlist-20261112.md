# Request watchlist option — local, 2026-11-12

Movie, series and collection request dialogs now offer checked-by-default “Add to watchlist”. After each successful media request, the existing Plex bookmark PUT adds that title to the signed-in user's watchlist (including when an administrator submits a request on another user's behalf). Unchecked means no bookmark mutation; existing bookmarks are not removed. Edit/approval dialogs do not offer the option. Collection requests add only successfully requested selected movies.

A failed bookmark operation emits a separate warning and does not misreport the media request as failed. Existing bookmark/user-watchlist caches are refreshed. No server contract or user toggles changed.

Validation: client TypeScript check passed; isolated hook checks passed for checked default, add-only semantics, unchecked no-op, and failure isolation. No live media requests made. No browser visual check or deployment performed. Unrelated next-env.d.ts remains untouched.
