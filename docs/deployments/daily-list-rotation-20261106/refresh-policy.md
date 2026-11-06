# Verified Letterboxd list refresh policy — 2026-11-06

Read from deployed source and native Seerr job configuration before the rotation rollout. The rotation change does not alter these rules.

- Weekly automatic census and eligible-content refresh starts Tuesday07:20 America/Merida and runs within07:20–08:40, with unfinished work resuming in later morning windows and existing busy/health deferral. All qualifying URLs from the fresh census enter the queue, not just homepage selections. Cap560; absent automatic-only lists are retained until the retirement policy applies, not refreshed blindly forever.
- Personal public refresh is invoked by `letterboxd-browser-sync` at00:00 and12:00 America/Merida. Saved, liked and owned list URLs are deduplicated; at most20URLs per invocation, round-robin persisted cursor. It attempts full public content imports; direct failures may enter existing browser fallback. Personal imports retain their existing limits rather than the automatic560cap.
- A successfully processed linked-account list export also invokes the personal public refresh. Consequently this queue can run more than twice daily; a scheduled pass is an attempt, not a guarantee that every external list succeeds.
- Snapshot at deployment preflight:19personal URLs, so one20slot pass covers them all;45stored automatic lists including retained seeds,3also in the personal queue. These counts can change with user saves and the next census.
- The old static seed refresh no longer supplements the personal queue once the first successful weekly census exists.
- Unreferenced old imports are not guaranteed periodic refresh merely because their records remain stored. Private/unavailable/stale/retired lists remain subject to visibility and lifecycle rules.
- Homepage daily rotation is local selection from stored data, not a Letterboxd import trigger.
