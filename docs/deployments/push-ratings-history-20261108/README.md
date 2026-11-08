# Mobile notifications, ratings and AI Search — 2026-11-08

Source `51c91755`. Ten application files explicitly scoped; generated `next-env.d.ts` excluded. LIVE build `mKCG9DhfHWLPphvGR2y47`, release `catalogue-20261108081128629-21797`.

Includes:

- Device-aware mobile push opt-in, iPhone Home Screen setup steps, expanding Enable button, right-aligned Not now, no collapse control or snooze footnote. Seven-day snooze remains. Android supported browsers can enable directly.
- Push registration preserves separate endpoints with identical user agents; lookup distinguishes missing subscriptions from database errors.
- Detail Letterboxd scores reuse validated last-known list-cache scores when the regular lookup fails. Fresh scores win; fallback creates no additional upstream work. Failures log diagnostic metadata.
- AI Search placeholder: “Adult stop motion movies from the 2010s, under two hours, with a Letterboxd score between 3.5 and 4.5”.
- History relative times; one entry per normalized prompt, original generated filters only; filter edits do not overwrite history. Solo searches omit the people caption. Legacy duplicates collapse without replaying edited overrides.

Validation before release: five isolated history/API tests and twelve notification/rating/rollout tests passed; client/server types, focused lint and prior actual-component browser previews passed. Real iPhone opt-in/delivery still requires on-device acceptance. No test notification sent and no paid AI request made.

Evidence: `outputs/push-ratings-history-rollout-20261108`. Build run once through the PRPL-PC maintenance-aware wrapper, completion awaited without inspecting build logs or status while running. No push authorized.


## Verified release

One PRPL-PC build: 43.982 seconds; dependency install: 1.603 seconds. Mini recreated and verified 31 exact dependency junctions. Staged login/JS/server/SQLite checks passed. Public branded maintenance page verified before stopping the old app; old PID 6312 stopped on first attempt. Native API/schema checks passed under the lease; lease cleared and public health passed.

All ten deployed source hashes match the local payload. Letterboxd binding/publication toggle fingerprint unchanged. All sixteen publicly served AI Search JavaScript chunks match the deployed artifacts, including the exact Adult stop motion placeholder. No second build or fallback was needed.

Rollback: previous build `SrNAYgtEKhEGtFkyq7oig` retained at `C:/ProgramData/Seerr/catalogue-20261108081128629-21797-release/previous`, with SQLite/state backups and source manifest in the release directory. Use the canonical maintenance-aware rollback. Receipt and source committed locally; no Git push.

This release supersedes the local-only notes for mobile push, detail rating fallback, AI placeholder and history polish. Physical-device permission/delivery acceptance remains for the user; automated tests used mocked subscription APIs.
