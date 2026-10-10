# PRPL catalogue customizations

The `prpl/custom` branch preserves the deployed catalogue customizations on upstream Seerr v3.4.1. Upgrading to v3.5.0 is a separate change. The fork remote is `git@github.com:prplmg/seerr.git`; upstream is `https://github.com/seerr-team/seerr.git`.

## Version control and updates

Commit `254225e7` captures the pre-existing deployed source, including social activity, local library browsing, recently watched pages, history queue handling, branding, and narrow scanner fixes. Runtime credentials, databases, private user mappings, logs and compiled builds are not part of the fork.

Keep custom work on this branch. For an upstream upgrade, create a separate upgrade branch and merge the selected upstream release, reviewing conflicts and changed assumptions. Build and test in staging before replacing production. Do not blindly overwrite new upstream source with old snapshots.

## Media actions and progress

Movie and TV detail pages use independent Plex and Trailer buttons; movies also have a Letterboxd icon linking through the TMDB ID. Existing permission-filtered playback URLs and 4K variants are retained. This does not change iPhone Plex deep-link handling.

Detail status pills are inert unless their authenticated media response contains download items. During downloading they open a read-only progress panel, with no request-management actions or additional permissions. Other uses of the shared status badge retain their original behavior. Trailer and progress labels include Spanish and Mexican Spanish translations.

## Build and rollback

Production runs on Mini. Source is staged at `C:\ProgramData\Seerr\social-stage`; `tools\social-feature\Build.ps1` builds the frontend and backend. The media-actions patch kit is under `tools\media-actions`, outside the application folder. Its guarded `recent-reapply.cjs APP_ROOT check|apply|revert` operates only on matching source and must be followed by a build. Apply this layer after history-queue; revert layers in reverse order.

`tools\social-feature\Deploy.ps1 -StateName actions-state.json` verifies the source baseline, saves the previous compiled build and touched source, replaces them and restarts Seerr. For production rollback restore the matching compiled build and source together; source-only reversion is insufficient. Do not restore the database just to undo a UI change.

The recently-added Plex scan is a runtime setting, not a source patch: `0 * * * * *` (once per minute). Download Sync remains once per minute. Full-library scans are unchanged. Import and Plex indexing delays still occur before availability can be detected.
