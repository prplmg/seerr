# Ykrn Letterboxd diagnosis — 2026-11-03

Verified around 18:30 Merida. User 4 / jairoheredia is online, publishing enabled, worker unpaused. RSS refresh at 00:30:08 UTC succeeded with 50 entries and no unresolved matches.

The Ring (TMDB 565) local diary review has rating 3, text, watched date 2026-11-03, and a manual viewingEventId, but no externalEntryId or sync receipt. The imported Letterboxd diary at https://letterboxd.com/jairoheredia/film/the-ring-2002/ has the same date with no rating/text. Repeated verified browser inventories confirm that diary exists. No write intent has been dispatched for this review.

reviewDiaryIntent rejects creation when an existing diary date is >= the local date. Publishing reports viewing-association-conflict. This is duplicate protection, but the UI-created manual viewing remains unbound to the existing entry.

Notification defect: observations expire after five minutes. A needs-baseline pass (or an in-flight-ticket pass returning no issues) clears setPreparationFailure. The next verified inventory recreates the conflict and resets firstFailedAt. Notifications require 15 continuous minutes and three attempts, so this recurring conflict never reaches the threshold. Latest sampled firstFailedAt 00:29:41 UTC despite inventories starting 00:05 UTC.

Recommended recovery: explicitly associate the review with the verified existing viewing, obtain an entry-specific baseline, then update that entry through normal publication. Preserve existing remote content and never create a second diary. Permanent correction should preserve incident age while verification is pending, clear only on actual resolution, and retain a concrete per-review failure reason.

Diagnosis only. No data, toggles, or deployment changed. Boot automation remains deferred until user confirms both urgent issues resolved. Separate observation: avellana worker still reports uncertain-write pause although catalogue has no unresolved intents; requires reconciliation before declaring all-account health.
