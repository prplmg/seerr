# PRPL catalogue customizations

The `prpl/custom` branch preserves the deployed catalogue customizations on upstream Seerr v3.4.1. Upgrading to v3.5.0 is a separate change. The fork remote is `git@github.com:prplmg/seerr.git`; upstream is `https://github.com/seerr-team/seerr.git`.

## Version control and updates

Commit `254225e7` captures the pre-existing deployed source, including social activity, local library browsing, recently watched pages, history queue handling, branding, and narrow scanner fixes. Runtime credentials, databases, private user mappings, logs and compiled builds are not part of the fork.

Keep custom work on this branch. For an upstream upgrade, create a separate upgrade branch and merge the selected upstream release, reviewing conflicts and changed assumptions. Build and test in staging before replacing production. Do not blindly overwrite new upstream source with old snapshots.

## Public profiles and Plex watchlists

The attribution menu hides co-viewer join/leave actions for the default or claimed Plex playback viewer (even if they previously added themselves). Shared-profile correction remains available. A manually added co-viewer can still leave, including when they are the last attributed person. Cards with no available actions omit the three-dot menu entirely.

Watching Now cards also expose a session-specific three-dot attribution menu. Shared-profile users can replace the default attribution with “This is me” or exclude themselves with “This is not me”; authenticated users can add themselves as co-viewers or leave. English and Spanish labels use the existing party locale helper. Choices persist atomically in `viewing-attribution.json`, keyed by a hash of Tautulli Plex user, exact movie/episode key, client and session start. Tautulli's `include_activity` history provides the stable start identity; missing identity disables attribution without hiding ordinary activity. Completion follows Tautulli's existing `watched_status === 1` criterion, not merely clicking the menu. Leaving before completion earns no future credit; leaving after completion retains it. “Not me” corrects that session's mistaken attribution. Other sessions and prior completed watches remain intact. These choices never join relay rooms or grant playback controls. If multiple Plex sessions share a card, the menu separates them rather than guessing. Party-only/external-video sessions without live Plex activity do not expose this Plex-session menu.

Authenticated members can browse a read-only user directory and profile requests, Plex watchlists, and recently watched movies and series (grouped by show). User-management controls and write APIs retain their existing administrator permissions. Recent history reuses the social-history aliases, completion criteria, party history and hidden-user policy; it does not expose raw session data or watch timestamps.

Bookmarks on movie/series details write directly to Plex, not the local Watchlist table. Plex changes are read on focus and every 30 seconds. Profile watchlists use that same Plex source, including shared `playback-profiles.json` mappings (misu/gerry -> edgy); validated avatar mappings supply the other managed profiles. Missing credentials fail closed, never falling back to the owner's watchlist. Existing local watchlists are preserved but no longer mask Plex profile lists. Shared playback mappings do not attribute a watch to every linked user.

`SHOW_REQUEST_ALLOWANCE = false` hides the profile allowance/statistics block and avoids fetching its quota data. Limits, settings, and markup remain intact; toggle it back to restore the section. `SHOW_WATCHLIST` remains false for legacy catalogue-only bookmark controls; the new Plex bookmark and profile watchlist do not use that switch.

## Media actions and progress

### Multi-season approval and initial search

Non-admin requests for more than two distinct, newly requested seasons require approval even with auto-approve permissions. Existing available/requested seasons are filtered before this rule is applied; it is per request, not a cumulative limit across separate requests. Expanding an existing request beyond the threshold also places it in pending approval. The requester sees an English/Spanish notice at the bottom of the TV request modal. Held requests cannot be approved or retried by non-admin request managers.

Administrators can choose “Add without searching” when creating a TV request or approving it from the request list, carousel, detail request block, or edit modal. The persisted `skipInitialSearch` flag disables only the initial Sonarr search, including on retries; seasons remain monitored and future RSS grabs are possible. Global Sonarr prevent-search settings still take precedence. Other requests retain their normal behavior.

Approved no-search requests show the yellow “Manual search” / “Búsqueda manual” badge while their media is processing without active downloads. Downloading, partial availability and availability retain normal precedence. Pending already uses yellow. Multi-season pending-request emails are restricted to the installation owner (user ID 1, prplmg), using existing SMTP configuration and notification preferences; unrelated notification rules are unchanged. Migration `1792200001000-AddRequestSearchMode` adds two false-default boolean columns and preserves existing requests.

Movie and TV detail pages use independent Plex and Trailer buttons; movies also have a Letterboxd icon linking through the TMDB ID. Existing permission-filtered playback URLs and 4K variants are retained. This does not change iPhone Plex deep-link handling.

Movie detail ratings replace the TMDB percentage with Letterboxd's public JSON-LD aggregate rating (stars out of five), fetched separately through `/api/v1/movie/:id/letterboxd`. Successful results are cached for 24 hours; missing/unavailable results retry after an hour, retaining a previous score during outages. Requests are deduplicated and bounded (eight concurrent, 1,000 cached titles, ten-second timeout, 2 MiB response limit). No credentials or browser scraping are involved. Series retain their existing rating because Letterboxd's TMDB redirect is movie-specific. English and both Spanish locales include the rating label. This source change requires a frontend/backend build and deployment before appearing live.

Detail status pills are inert unless their authenticated media response contains download items. During downloading they open a read-only progress panel, with no request-management actions or additional permissions. Other uses of the shared status badge retain their original behavior. Trailer and progress labels include Spanish and Mexican Spanish translations.

## Letterboxd reviews — phase 1

Movie details include member ratings and reviews, with green Letterboxd and purple local accents, spoiler concealment, and original Letterboxd links. Local reviews never publish to Letterboxd. Individual catalogue identities own reviews; shared Plex playback mappings do not share review identities.

Administrators alone manage Letterboxd usernames in each user's Linked Accounts settings, preview/import extracted CSVs in batches of 25, resolve missing TMDB IDs, refresh or pause RSS, and unlink/remove imported entries while retaining local reviews. These restrictions apply to the APIs as well as the UI. Other authenticated members see only the linked Letterboxd username and profile link, not management controls or sync diagnostics. Local catalogue review authoring remains available. Imports require explicit confirmation that the selected CSV contains no private/deleted material and may be shown to catalogue members. Export bundles can contain deleted material: do not import deleted-content CSVs. ZIP upload is not supported in this initial version.

Enabled accounts poll public RSS every 15 minutes, with bounded requests and no stored Letterboxd credentials. RSS is an incremental source, not a complete historical archive or deletion feed; CSV supplies history. Failures preserve existing entries. Stable identities prevent repeat imports of the same URI/watch-date pair, and original dates keep old reviews out of the recent feed. CSV re-imports do not overwrite existing entries; RSS may refresh them. Unmatched films require explicit matching rather than fuzzy title guesses.

The independently removable/reorderable Recent Reviews Discover row uses a configurable 1–365-day lookback (7 days = one week), defaults to 28 days, and shows up to 20 newest text reviews. Movie detail pages paginate all reviews, including rating-only entries. Read-more links target the specific review. UI copy includes English and Spanish.

SQLite/Postgres migration `1792200000000-AddMovieReviews` adds `movie_review` and `letterboxd_account`; it does not alter existing tables. Before release, validate with a real account export and mapping. Phase 2 authenticated Letterboxd writes are intentionally excluded. An application rollback can leave these additive tables in place to preserve imported data.

## Build and rollback procedure

Production runs on Mini. Source is staged at `C:\ProgramData\Seerr\social-stage`; `tools\social-feature\Build.ps1` builds the frontend and backend. The media-actions patch kit is under `tools\media-actions`, outside the application folder. Its guarded `recent-reapply.cjs APP_ROOT check|apply|revert` operates only on matching source and must be followed by a build. Apply this layer after history-queue; revert layers in reverse order.

`tools\social-feature\Deploy.ps1 -StateName actions-state.json` verifies the source baseline, saves the previous compiled build and touched source, replaces them and restarts Seerr. For production rollback restore the matching compiled build and source together; source-only reversion is insufficient. Do not restore the database just to undo a UI change.

The recently-added Plex scan is a runtime setting, not a source patch: `0 * * * * *` (once per minute). Download Sync remains once per minute. Full-library scans are unchanged. Import and Plex indexing delays still occur before availability can be detected.
