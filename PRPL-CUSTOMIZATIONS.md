# PRPL catalogue customizations

The `prpl/custom` branch preserves the deployed catalogue customizations on upstream Seerr v3.4.1. Upgrading to v3.5.0 is a separate change. The fork remote is `git@github.com:prplmg/seerr.git`; upstream is `https://github.com/seerr-team/seerr.git`.

## Version control and updates

Commit `254225e7` captures the pre-existing deployed source, including social activity, local library browsing, recently watched pages, history queue handling, branding, and narrow scanner fixes. Runtime credentials, databases, private user mappings, logs and compiled builds are not part of the fork.

Keep custom work on this branch. For an upstream upgrade, create a separate upgrade branch and merge the selected upstream release, reviewing conflicts and changed assumptions. Build and test in staging before replacing production. Do not blindly overwrite new upstream source with old snapshots.

## Public profiles and Plex watchlists

Watching Now cards also expose a session-specific three-dot attribution menu. Shared-profile users can replace the default attribution with “This is me” or exclude themselves with “This is not me”; authenticated users can add themselves as co-viewers or leave. English and Spanish labels use the existing party locale helper. Choices persist atomically in `viewing-attribution.json`, keyed by a hash of Tautulli Plex user, exact movie/episode key, client and session start. Tautulli's `include_activity` history provides the stable start identity; missing identity disables attribution without hiding ordinary activity. Completion follows Tautulli's existing `watched_status === 1` criterion, not merely clicking the menu. Leaving before completion earns no future credit; leaving after completion retains it. “Not me” corrects that session's mistaken attribution. Other sessions and prior completed watches remain intact. These choices never join relay rooms or grant playback controls. If multiple Plex sessions share a card, the menu separates them rather than guessing. Party-only/external-video sessions without live Plex activity do not expose this Plex-session menu.

Authenticated members can browse a read-only user directory and profile requests, Plex watchlists, and recently watched movies and series (grouped by show). User-management controls and write APIs retain their existing administrator permissions. Recent history reuses the social-history aliases, completion criteria, party history and hidden-user policy; it does not expose raw session data or watch timestamps.

Bookmarks on movie/series details write directly to Plex, not the local Watchlist table. Plex changes are read on focus and every 30 seconds. Profile watchlists use that same Plex source, including shared `playback-profiles.json` mappings (misu/gerry -> edgy); validated avatar mappings supply the other managed profiles. Missing credentials fail closed, never falling back to the owner's watchlist. Existing local watchlists are preserved but no longer mask Plex profile lists. Shared playback mappings do not attribute a watch to every linked user.

`SHOW_REQUEST_ALLOWANCE = false` hides the profile allowance/statistics block and avoids fetching its quota data. Limits, settings, and markup remain intact; toggle it back to restore the section. `SHOW_WATCHLIST` remains false for legacy catalogue-only bookmark controls; the new Plex bookmark and profile watchlist do not use that switch.

## Media actions and progress

Movie and TV detail pages use independent Plex and Trailer buttons; movies also have a Letterboxd icon linking through the TMDB ID. Existing permission-filtered playback URLs and 4K variants are retained. This does not change iPhone Plex deep-link handling.

Movie detail ratings replace the TMDB percentage with Letterboxd's public JSON-LD aggregate rating (stars out of five), fetched separately through `/api/v1/movie/:id/letterboxd`. Successful results are cached for 24 hours; missing/unavailable results retry after an hour, retaining a previous score during outages. Requests are deduplicated and bounded (eight concurrent, 1,000 cached titles, ten-second timeout, 2 MiB response limit). No credentials or browser scraping are involved. Series retain their existing rating because Letterboxd's TMDB redirect is movie-specific. English and both Spanish locales include the rating label. This source change requires a frontend/backend build and deployment before appearing live.

Detail status pills are inert unless their authenticated media response contains download items. During downloading they open a read-only progress panel, with no request-management actions or additional permissions. Other uses of the shared status badge retain their original behavior. Trailer and progress labels include Spanish and Mexican Spanish translations.

## Build and rollback

Production runs on Mini. Source is staged at `C:\ProgramData\Seerr\social-stage`; `tools\social-feature\Build.ps1` builds the frontend and backend. The media-actions patch kit is under `tools\media-actions`, outside the application folder. Its guarded `recent-reapply.cjs APP_ROOT check|apply|revert` operates only on matching source and must be followed by a build. Apply this layer after history-queue; revert layers in reverse order.

`tools\social-feature\Deploy.ps1 -StateName actions-state.json` verifies the source baseline, saves the previous compiled build and touched source, replaces them and restarts Seerr. For production rollback restore the matching compiled build and source together; source-only reversion is insufficient. Do not restore the database just to undo a UI change.

The recently-added Plex scan is a runtime setting, not a source patch: `0 * * * * *` (once per minute). Download Sync remains once per minute. Full-library scans are unchanged. Import and Plex indexing delays still occur before availability can be detected.
