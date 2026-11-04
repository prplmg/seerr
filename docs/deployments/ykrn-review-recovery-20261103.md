# Ykrn review recovery and alert persistence — 2026-11-03

## Verified recovery

User-approved association applied through authenticated reviews API as user 4, preserving review ID, original publishedAt, text, rating 3, spoiler flag, sync preference and November 3 date. Backup saved on Mini at C:/Windows/Temp/ykrn-ring-before-association-20261103.json. Linked existing https://letterboxd.com/jairoheredia/film/the-ring-2002/ and cleared the separate manual viewing reference through the normal save path.

Fresh entry-specific browser read succeeded. Normal worker published review update 0f9ee9da-f79a-4b11-a947-81dde739e2a8 and verified at 2026-11-04T00:46:54.767Z (18:46:54 Merida). Receipt binds the review to the existing diary and original Tautulli viewing. Independent Letterboxd RSS fetch returned exactly one matching entry, date 2026-11-03, rating 3.0, and expected review text. Final catalogue check: zero ykrn preparation failures and zero unsettled Ring writes. No toggles changed.

## Cause

The local review was created 18:02:23.186 Merida using the manual new-diary path. Tautulli event 1239/reference1188 completed 18:02:28, five seconds later. Playback publication was queued at 18:03:41 and verified at 18:04:26. The local edit at 18:03:48 retained its manual association. This was a manual viewing versus a subsequently completed playback, not association to an unrelated movie or old viewing. The frontend defaults edits to Keep existing association. We cannot reconstruct the exact clicks, but the persisted manual ID can only be created by the new-diary branch in this save route. Both sources subsequently referred to the same day; duplicate protection prevented a second diary rather than guessing they were the same viewing.

## Notification code correction, pending deployment

Preparation now explicitly reports pending work. A needs-baseline result, in-flight continuation, or another bounded candidate does not clear an existing incident. Original age and attempt count survive until eligible work is settled/removed/opted out. Existing thresholds and deduplication retained. No automatic ambiguous-viewing merge introduced.

Validation: 50 focused tests pass across continuation, notification policy, write queue, diary duplicate protection, and viewing defaults. Regression covers pending reads, persisted restart, actual alert eligibility and clearing when resolved. Full TypeScript check passed. Production review recovery is complete; notification source change is tested but not deployed. Boot recovery automation still awaits user confirmation.
