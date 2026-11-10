# Pending work review — 2026-11-09

## Completed locally this turn, not deployed

Review comment buttons (icon and count) use gray at zero/unknown count and lilac at one or more comments. Both shared review footer and standalone interaction control updated; reaction styling unchanged. Scoped ESLint and client TypeScript passed. No toggle changes, production changes or push.

## Suggested next work

1. Broader service health checks and grouped incident/recovery emails: torrent URL, actual catalogue rows/posters, bounded Plex reads from both shares, PRPL-PC reachability/DNS. Mini boot retry already exists. See Network/10 - Backup and recovery.md, Deferred Network todos. These are prevention work, not a claim of a current outage.
2. Plex watchlist transient-zero state: distinguish never-loaded/failed/empty, retain last successful snapshot and bounded retries. Explicitly parked by user; see plex-watchlist-zero-diagnosis-20261107.md.
3. PostHog performance experiment: isolated browser test completed (198 measured visits); see ../benchmarks/posthog-20261109/report.md. Actual-app integration, deferred initialization and production/network validation remain unimplemented; nothing deployed. Compare logging off/on in isolation, cold/warm caches and ordinary/burst browsing. Old custom activity logging stays archived; do not restore it implicitly. Decide capture scope before measuring, since page events and session replay have different costs.
4. Wednesday November 11, 11am Merida review: first scheduled weekly list run, refresh policy for unsaved discovery lists and whether PRPL-PC execution is worthwhile. Documented reminder; not re-verified or changed this turn. See list-discussion-agenda-20261106.md.
5. Curated collections and institutional author credit: parked for user research. Earlier eleven additions were undone; three AFI drafts remain unapproved. Other lists agenda points are complete.
6. User-to-user recommendations: earlier conversation proposal, not implemented here; dedicated inbox, private ignore, accept media into Recommendations and save recommended lists. Separate from already-shipped list sharing/edit permissions.
7. Optional linked-viewing deletion alongside a review: parked, requires exact external-entry confirmation and protection against reconciliation recreating intentional deletions.

## Older documented items to revalidate before scheduling

Shared-profile attribution UI; manual watched/unwatched controls; empty/YouTube-first party creation; legacy KoalaSync UI cleanup; build/test artifact retention and possible D: staging; AdGuard native crash recovery and natural-boot evidence. These are historical TODO notes, not freshly audited defects.

Letterboxd ledger migration and automatic unambiguous reviewed-diary association are already deployed, as are list source filters, homepage rotation and media-detail list cards. Old pending entries for those are superseded. No new sync incident is established by this backlog review.
