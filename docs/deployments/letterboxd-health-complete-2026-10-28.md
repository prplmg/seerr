# Letterboxd reliability completion — 2026-10-28

## Changes

- Per-account effective health from the runtime: pauses, reason, fresh capabilities, recent sanitized errors and unsupported queued intents. Shared history status is separately visible to admins.
- Read-induced pauses schedule a bounded read-only identity probe (15-minute cooldown, one job at a time). A successful correctly identified probe uses existing safe recovery. Manual pauses and newer unknown/blocked mutations remain held; no review is replayed.
- Retired list reports are preserved atomically before acknowledging a confirmed-retired server UUID. Credential/token mismatches stay failures.
- Export freshness preflight precedes remote title resolution; transactional checks remain authoritative against updates during resolution. Independently persisted per-link metadata matches, including boxd.it links, survive failed exports and process restart. No partial import is committed.
- Shared Tautulli history failures use a persisted 1–5 minute backoff and a ten-second bounded read. Clear legacy per-user history incidents. Send one shared incident alert after sustained failure instead of six account alerts. Preserve independent RSS/publishing. Log sanitized stage, code and HTTP status; RSS failure diagnostics now include code/status too.
- Advertise the existing watched adapter only for a fresh loaded 0.2.48 extension, separately per profile. Normal precondition/read-back and durable-delivery protection remain in force.
- Chernobyl rating uses an exact identity-verified imported canonical link when available, retaining deferred lookup/caching and bounded timeout.
- Review cards show the recorded watch date when present, falling back to publication date for undated entries. Live read-only feed verification found Pan’s Labyrinth second for avellana and ninth globally; no watch entry was rewritten.
- Deployment stops and verifies the actual catalogue Node child, not just its scheduled-task wrapper. Authenticated smoke checks use HTTPS with redirects rejected. Server/schema must precede worker rollout.

## Tests

Targeted server, UI and real SQLite transaction tests pass, including six-profile shared email deduplication and failed SMTP retry, stale export protection, persistent metadata reuse, strict API schema/legacy negotiation, safe rating fallback, account privacy and settings. 67 Python queue/client tests and 20 browser/workflow tests pass. Server/client typechecks pass. Nine deployment-health tests pass. Three optional historical ZIP fixture tests are skipped because their local fixtures are unavailable.

## Deployment

Live build **B12zQTRe9q7Z_QNTZMoEJ**. Production build and schema/HTTPS checks passed. The first deployment restart selector missed a Windows-backslash child; the corrected explicit restart was executed and the new runtime-only health fields verified. A regression test covers the emitted Windows/slash selector. Chernobyl now returns 4.62/5 live.

At 2026-10-28T15:31:31Z all six profiles report ready, pauseReason none, zero unsupported queued intents, and no recent worker errors. All six advertise watched capability from fresh 0.2.48 instances. Percy Jackson intent `73b026b7-0cb2-48f7-b2f1-cdad16da868b` verified at 1793201478171; no unsettled intents remain. The existing desired action was handled through the normal precondition/read-back workflow, not a test or duplicate submission. Shared history has zero current failures and a recent success. Pan’s Labyrinth ranks second in avellana’s live feed.

Publishing/RSS/browser toggle hash remains `efc1909bb44d5c3b37c841fb3c0520d7f999a48524050cade273b7107ef89c5e`. Worker installation independently compared all account pause values and configuration bytes unchanged. No Edge profiles, playback or download settings were changed.

Rollback: catalogue `C:/ProgramData/Seerr/catalogue-20261028151812836-9475-release` (previous build aWB1WGuuR7Wy9GX9tSDIu); worker `C:/Users/MSI/MultimeldiaLetterboxdRuntime/health-client-backup-20261028-093010`. Roll back code while retaining newer account/database state. Server/schema must precede the new worker on installation; reverse the order when rolling back compatibility. Build invoked once and original completion awaited; no build log/process polling. No Git push.

Receipt: `letterboxd-health-completion-2026-10-28.json`. Original transient history failures had generic logs, so their exact network/processing cause cannot be reconstructed; this release adds stage/code/status evidence, backoff and shared alert deduplication rather than claiming to eliminate external outages.
