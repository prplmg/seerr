# One-time weekly-list bootstrap and history timeout audit — 2026-11-06

User authorized an expedited initial pull on PRPL-PC rather than waiting for the first Tuesday cycle. No additional application deployment, schedule change, publication change, or review resubmission is authorized/needed here.

## History alert

Mini logged seven shared `history-fetch` ECONNABORTED failures between 13:39:10 and 14:04:10 UTC (07:39–08:04 America/Merida). This path has a ten-second HTTP timeout; no HTTP response status was recorded. The separate catalogue-history job also failed during this interval and once at 15:02 UTC. These failures concern retrieving Tautulli playback history, not proof of a failed Letterboxd write.

At 16:16 UTC the persisted shared health had attempts=0 and a recent success. The exact get_history request returned HTTP 200/success, 50 rows in 40.35 ms; get_activity returned HTTP 200/success in 241 ms. At 16:26 UTC health again had attempts=0 with a current success. Automatic retry recovered without manual intervention or resubmission.

Read-only host inspection found Tautulli continuously running since October 28; its log recorded a library event during the failure interval. Its private route is Mini → Tailscale 100.72.204.19:8182 → Windows portproxy → Tautulli loopback 8181. Forward-recovery log has no repair in today's interval (last entry October 28). Mini boot-recovery has no event today. Neither host's queried System event interval yielded an explanation. Existing evidence cannot distinguish a stalled HTTP/database request from a transient route problem; do not claim a proven root cause or permanent fix. Logging gap: forwarding recovery records repairs/listener status, not end-to-end HTTP timings during healthy-looking listener states.

## Off-host import design

Fresh anonymous discovery through the existing extension: first two pages each of all-time, week, month and year. All eight completed in 51.093 s: 64 unique lists, 44 within 560 films, 9,220 memberships. Known excluded lists remain excluded.

The actual public-list parser, film resolver and persistent identity-cache logic were bundled into an isolated Node harness. Only the harness drops the normal deliberate 250 ms title delay and runs two lists concurrently. The live scheduler/limits remain untouched. The harness rechecks the 560 cap before film resolution, rejects incomplete pagination and private/challenged pages, and keeps errors separate from successful identity matches. It writes only D:/CatalogueBuilder/weekly-first-pull-20261106, with no database, publication, account configuration or scheduler access. Existing portable Node is used; no software installed.

Production merge must preserve saved/liked references, owners, unrelated lists/store fields and newer/deleted snapshots. Six focused checks passed for these invariants. Merge takes a backup, checks that the live store has not changed before atomic replacement, and verifies the result. Initial weekly state records successful evidence and last-seen dates without setting startedAt; that intentionally allows the first regular Tuesday cycle on November 10 rather than delaying it through the six-day cycle guard. No automatic list is retired on this initial bootstrap. Existing static seeds receive their ordinary grace period.

## Completion

Completed at 16:33 UTC / 10:33 America/Merida. All 44 imports succeeded on their first attempt in 577.121 seconds (9m37s), plus the 51.093-second discovery census: 10m28s for discovery and importing, excluding staging/verification. 5,726 HTTP requests; 1,188,189,611 decoded response bytes; approximately 23.89 CPU seconds and 146.8 MiB peak RSS reported by the PRPL-PC process. This is a different cohort/host/concurrency/pacing setup from the previous Mini 43-list benchmark, not a controlled speedup claim.

Resolved 9,217 memberships covering 5,609 unique film/series identities; three entries remain explicitly unmatched: Twin Peaks: The Return in two lists and Black Mirror: San Junipero in one. No guessed mapping was inserted. Cached 5,609 successful identity matches for reuse by scheduled runs.

Dry-run against a live-store copy passed. Production merge added 34 lists and refreshed 10, with zero skips; persisted store now has 65 lists (curated definitions are separate). All 44 appear in authenticated Explore results: 175 total results versus 141 before. Saved/liked references, owners and unrelated store fields were checked by the merge. Original store backup: C:/ProgramData/Seerr/data/backups/weekly-bootstrap-1793982785454. Restore only after reconciling any user changes made after this snapshot; do not blindly replace a newer live store.

Weekly initial evidence persisted with no startedAt, so Tuesday November 10 at 07:20 remains the first regular weekly cycle. Static-seed grace dates initialized, no retirements. Cron unchanged. All six stable browser-binding toggles/instances and publication settings, plus social policy, fingerprinted equal. The broad settings.json file fingerprint changed during the interval; that file also contains runtime scan metadata. Its full bytes are not claimed identical; this importer never writes it. No service restart, maintenance page, application deployment or software installation was needed.

Post-merge status/jobs/Explore all HTTP 200. Explore observed 676/207 ms during the off-host import and 1,405 ms immediately after adding the larger pool; these are uncontrolled individual observations, not evidence of zero overhead. Shared history health remains attempts=0 and current successful fetch. Publishing notifications and all existing schedules remain enabled as before.
