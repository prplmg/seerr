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

In progress; append completion identity and verification below. Existing user toggles must remain unchanged; no test publication is submitted.
