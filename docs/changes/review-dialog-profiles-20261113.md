# Review dialogs and profile review rows — 2026-11-13

Implemented locally, not deployed. No notification settings or delivery semantics changed.

## Findings

Comment/reaction notifications currently target only the review author, excluding the actor. Commenting does not subscribe a participant. Existing Social Interactions channel preferences still apply.

Episode reviews use Common Modal; comments use a portaled Headless UI Dialog. Common Modal's capture-phase outside-click listener considered clicks in the comments portal outside the episode modal and could dismiss the parent, destroying both. Common Modal now leaves dismissal to an open Headless UI dialog. Additional closing paths hardened: transient feed refresh errors retain loaded cards, and notification-query changes no longer key/remount the comments footer.

## Changes

- Comments focus the close control on opening, not an input. Header stays outside the scrolling body; comments/composer scroll inside a contained area.
- Visible viewport resize/pan updates the sheet bounds when the keyboard appears. The background body is fixed while open and its original position is restored on close. No post-scroll correction loop.
- Review notification links do not scroll the background to the review while comments are opening.
- Each profile now has a Reviews row using existing review cards, episode metadata, reactions and comments. API userId filter selects written reviews for that member without the discovery date cutoff; existing visibility/deduplication rules and 20-item pagination remain. OpenAPI query parameter documented.

## Validation

TypeScript no-emit and scoped ESLint passed. Three regression tests passed: visible viewport/scroll-lock cleanup, actual feed-handler author filtering/date-window/invalid-ID behavior, and actual Common Modal parent-dismissal behavior with a child dialog open. Tests use mocked browser/DB boundaries; no production writes or notifications.

Physical iPhone keyboard behavior and the reported live notification sequence have not been replayed on-device. No deployment or production verification claimed.

## Follow-up: unified dates and comment participation

Reviews retain date-only semantics (watched date, or publication calendar date). Today/yesterday/2–6 days ago/last week for 7–13 days; dates from 14 days onward. Comments use actual instants in viewer timezone, minutes/hours within today and the same older-day policy. Hover title and tap expansion expose full date; only comments include time. Labels update while mounted; English/Spanish via Intl.

New comments notify the review author and distinct existing commenters, excluding the actor, through existing social notification preferences. Existing comment records supply thread participation without a backfill or migration; deleting all of a person's comments removes that implicit participation. Reactions remain author-only. Channel delivery exceptions are isolated to allow other recipients to proceed. No global/user toggles changed.

Five focused regression tests and TypeScript/scoped lint passed. Implementation commits c12bffbb and f81e70e9. Explicitly authorized one-time missed push to margoTica for prplmg's Abbott Elementary S03E11 reply; guarded receipt prevents rerun. Delivery receipt must be checked separately from deployment.

## Deployed November 13 (local time)

Build `B35_yD3v3-SrSFYYlWacl`; release `catalogue-20261114013626505-42977` (UTC identifier). PRPL-PC built once in80.843s; Mini31 dependency links/staged checks passed. First switch rolled back because cold startup exceeded fixed120s allowance; server logs subsequently showed readiness. Same artifact restaged and switched with per-release180s allowance; no rebuild. Branded maintenance/native/public health passed. Eleven live file hashes match. User/global/sync toggles unchanged; only normal Plex lastScan metadata advanced. Single runnable rollback retained in release/previous; no push.

Live user5 profile feed200:20 rows of101 total, every row user5. On-device keyboard verification remains outstanding. Fixed startup timing remains an operational follow-up; only this release's retry allowance was changed.

Targeted margoTica push for prplmg’s Abbott Elementary S03E11 reply sent once; push service accepted HTTP201 at2026-11-13 19:53 America/Merida. No device-display/read confirmation claimed. Guard receipt `C:/ProgramData/Seerr/reviews-rollout-20261113/margotica-notification.json`. Initial helper setup failures occurred before transport; no duplicate sends.

## Follow-up: iPhone safe-area headroom (local, not deployed)

User screenshot showed keyboard-sized sheet header beneath status bar. Added top padding equal to safe-area-inset-top plus16px to the viewport wrapper, preserving contained scroll below the fixed header. Close control is now44×44 CSS pixels, top-aligned. Scoped lint/format passed; physical iPhone validation pending.

### Focused composer visibility (local, pending deployment)

Kept the approved safe-area headroom and close-button size unchanged. On input focus or keyboard viewport resize, reveal the focused textarea by scrolling only the dialog content after layout updates. Viewport panning does not trigger this correction, allowing readers to scroll older comments while the keyboard stays open. Pending animation frames and listeners are removed on close. Six focused regressions pass, including keyboard resize, manual-scroll preservation and cleanup; physical iPhone keyboard validation remains pending.

Notification wording verified: the one-time margoTica push said “prplmg commented on their Abbott Elementary S03E11 review.” Standard participant notifications currently say “[actor] commented on [author]’s review you commented on.” No notification was resent or wording changed.
