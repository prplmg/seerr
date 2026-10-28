# Review chronology deployed — 2026-10-28

Live build: **HfqeWOf_V3dYQaiV-LdjR**. Public review feeds now order and apply their recent window by watchedDate, falling back to publication date for undated entries. Publication timestamp and ID provide stable ties. The editor's latest saved-entry selection is unchanged; no review data was rewritten.

HTTPS verification at 17:28:12 UTC: 20 recent-feed results correctly ordered; MargoTica's Verity entry has watchedDate 2026-10-27 and publishedAt 2026-10-28T00:00:00.000Z. Publishing/RSS/browser toggle hash unchanged: efc1909bb44d5c3b37c841fb3c0520d7f999a48524050cade273b7107ef89c5e.

Production build succeeded once. Initial stop check raced process termination before any artifact swap. Corrected deployment helper waits on the exact process handle for up to 15 seconds before checking survivors. Reused built artifacts; no rebuild or build polling. Normal deployment smoke and chronological feed verification passed.

Rollback: C:/ProgramData/Seerr/catalogue-20261028171130859-12079-release/previous contains previous B12zQTRe9q7Z_QNTZMoEJ artifacts. Manifest/source backup and pre-deploy database backup are in the release directory. Prefer code rollback without reverting newer account/database state. Receipt: chronology-verified.json in that release directory. No Git push.

Tests: real SQLite watched-date ordering, recent-window exclusion, fallback and pagination; server typecheck; emitted Windows process selector and bounded-exit-wait regression; production build and HTTPS API checks.
