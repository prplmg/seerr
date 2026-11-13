# Request watchlist option — local, 2026-11-12

Movie, series and collection request dialogs now offer checked-by-default “Add to watchlist”. After each successful media request, the existing Plex bookmark PUT adds that title to the signed-in user's watchlist (including when an administrator submits a request on another user's behalf). Unchecked means no bookmark mutation; existing bookmarks are not removed. Edit/approval dialogs do not offer the option. Collection requests add only successfully requested selected movies.

A failed bookmark operation emits a separate warning and does not misreport the media request as failed. Existing bookmark/user-watchlist caches are refreshed. No server contract or user toggles changed.

Validation: client TypeScript check passed; isolated hook checks passed for checked default, add-only semantics, unchecked no-op, and failure isolation. No live media requests made. No browser visual check or deployment performed. Unrelated next-env.d.ts remains untouched.

## Production rollout — November 12, Merida
Deployed only the four request UI/helper files from8d6f3285, over an exact verified production baseline. PRPL-PC build80.51s/frozen install3.708s; buildgq9Vxridi4VrKoKragjoc, releasecatalogue-20261113021008219-81114. Mini recreated31 verified dependency links and passed staged login/chunks/server/SQLite checks. Branded public maintenance verified before stop; native health passed, lease cleared, public login200 matched new build. All four live source hashes match approved files. Global/user settings, account mappings, read/write settings and browser bindings unchanged; only Plex library lastScan timestamps advanced. One previous rollback retained at C:/ProgramData/Seerr/catalogue-20261113021008219-81114-release. Other pending catalogue changes excluded. Build command awaited; no build-log/status inspection while running. No live media requests submitted for testing. No Git push.
