# Letterboxd recovery and pending health improvements — 2026-10-28

## Verified live recoveries

- margoTica: fresh identity probe `8ea13b2f-d60a-427f-8d99-d34387140b12` verified margotnochill. Existing safety logic cleared only the read-induced pause from Verity follow-up `65314d8e-2f71-4390-a0de-e7fcf4af6dd8`. Verity publication was already verified and was not replayed.
- prplmg: confirmed completed list job `96d630fc-4488-45a9-ac56-13d0621ceb81` no longer exists server-side. Preserved its full 250-item result and original payload in `C:/Users/MSI/MultimeldiaLetterboxdRuntime/orphan-list-recovery-1793174638.json`, then acknowledged exactly this orphan. No imported list or publication was modified. Subsequent check found no unacknowledged list result or new 409.
- Catalogue publishing/RSS/browser toggle hash unchanged: `efc1909bb44d5c3b37c841fb3c0520d7f999a48524050cade273b7107ef89c5e`. Runtime pause changed only for the intended margoTica recovery.

## Implemented, tested, not deployed

- Optional per-account worker telemetry reports actual pause reason, supported write kinds and bounded sanitized stage errors. Admin status distinguishes ready, paused, stale and unknown; exposes unsupported queued actions and oldest queue timestamp. Missing telemetry never implies healthy.
- Authenticated reporting of a retired list UUID returns an explicit 410. Worker atomically preserves the complete report before acknowledging it. Known-job credential/account mismatches remain 409 and are never discarded.
- Chernobyl TV 87108: Letterboxd TMDB redirect returned HTTP403 while canonical `/film/chernobyl/` returned 200 and 4.62/5. Existing imported reviews provide the canonical mapping. New rating lookup verifies the exact TMDB type/ID on that page; ambiguous/unsafe mappings are rejected. Lookup remains deferred, coalesced, bounded and cached; both HTTP attempts share a 10-second budget. Successful ratings cache 24 hours; transient failures retry after five minutes.
- Isolated execution of the new lookup on Mini returned 4.62 and the canonical Chernobyl URL; production app code was not replaced.

## Remaining limitation

prplmg intent `73b026b7-0cb2-48f7-b2f1-cdad16da868b` (Percy Jackson and the Olympians: The Lightning Thief) is a queued `watched` action unsupported by the current worker. No write was attempted. The new health panel makes this visible; implementing that action is separate work.

## Validation and rollout

Targeted server/UI tests, strict API-schema negotiation tests, 65 Python worker/queue tests, and server/client typechecks passed. Final rating/canonical-URL tests passed (7). Existing API clients remain supported. New health payload requires server/schema deployment before worker rollout.

Current live build remains `aWB1WGuuR7Wy9GX9tSDIu`; this turn did not deploy. Existing rollback remains `C:/ProgramData/Seerr/catalogue-20261028000636651-90188-release`. Preserve current account state on any code rollback. Scoped source checkpoint only; no Git push.
