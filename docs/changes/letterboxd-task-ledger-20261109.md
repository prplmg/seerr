# Letterboxd task ledger migration — deployed 2026-11-09

Status: deployed with coordinated server/worker/browser updates. Final build `Ga2jPHD7DjJyo_7YXJGIA`; extension `0.2.50`. See [release receipt](../deployments/letterboxd-ledger-20261109/README.md). The checkpoint sections below retain the implementation history; their pending-release statements are superseded by that receipt. User toggles unchanged; unrelated next-env.d.ts preserved.

## Implemented locally

- One Mini SQLite ledger replaces five independent JSON persistence adapters: writes, observations, browser bindings/jobs, public-list browser tasks and verified receipts. Immutable task IDs and settings are preserved. Original JSON is retained as migration evidence, not dual-written.
- Startup imports all five documents transactionally before jobs start. Failed migration rolls back. Nested receipt/queue operations use savepoints. Database is private (0600), WAL, synchronous FULL, and has an integrity check.
- Current-state JSON export supports a controlled rollback. Never restore the original JSON after new live work: it will be stale. Export requires a new directory and a completion manifest.
- Admin health endpoint includes task counts by namespace/state and stored retry times. This is an initial operational view, not yet the full blocker/retry UI.
- All Letterboxd worker HTTP endpoints accept the bounded 15 MB envelope; list content validation remains stricter. This fixes the 120 KB retained list-report rejection caused by the previous default 100 KB parser.
- Browser failure diagnostics use the existing supported error field. An actual JavaScript payload now crosses the real Python Queue.event validator in a test.
- A timed-out browser list scan with a retained lease can deliver its completed result. Repeated refresh scheduling reuses that task rather than creating another scan. Newer completed results supersede older validated snapshots. Wrong-profile/token and incomplete content remain rejected.
- Publishing/heartbeat failures no longer skip the independent list exchange lane.

## Verified locally

- 58 adapter/recovery tests passed after updating test persistence assertions to SQLite.
- 6 ledger tests passed: migration/reopen/settings, atomic receipt transitions, nested rollback, invalid identities, async mutation rejection, startup migration and current-state rollback export.
- 15 browser tests passed, including the actual Python receiver contract.
- 84 worker tests passed.
- Actual loopback Express HTTP test passed: 120 KB accepted, 16 MB rejected.
- List late-report regression passed, including shared subscriber preservation and one application of the snapshot.
- Server TypeScript check passed before final formatting; no production rollout performed.

## Original cutover checklist (completed; see release receipt)

1. Complete centrally owned recovery scheduling and explicit blocker scope; content uncertainty must not silently become account-wide indefinite suspension. Preserve authentication/manual/watchdog holds and never blindly retry an executed mutation.
2. Complete bounded fair transport scheduling across profiles and durable retry classification. Permanent payload/schema errors must retain evidence without repeatedly blocking every later delivery.
3. Prove a live-shaped migration/rollback on copied state, including payload sizes, timing, exact settings/IDs and compatibility of server/bridge/extension. Test restart with real pending result outboxes.
4. Resolve retained list results and Zelza's existing entry using verified evidence after cutover, then verify all linked profiles. Do not resubmit uncertain diary writes.
5. Controlled coordinated cutover: preserve state, stop new claims, settle/checkpoint active work, install matching components, verify actual loaded versions and unchanged settings. Use PRPL-PC maintenance-aware rollout; no build polling. Record live release/rollback identity only after verified.

## HTTP versus browser clarification

`refreshDiscoveryLists` tries `importPublicList` first for its rotating saved/liked/owned public-list batch. Direct HTTP validates canonical identity, totals and full pagination (or a verified linked CSV). Browser work is fallback when this cannot establish a complete public snapshot. A reachability/public-visibility check alone is not a complete contents refresh.

The separate Tuesday weekly discovery flow currently queues browser work both for discovery pages and selected list contents. It is not currently an HTTP-first path. This checkpoint does not change that schedule or the 560-item weekly eligibility limit, and does not apply that limit retroactively to saved larger lists. The shared public-list worker pool remains.

## Completed release preparation (same day)

Implemented negotiated subject-holds capability and strict HTTP schema coverage. Confirmed remote content conflicts block the account+film locally and on Mini, while unrelated films may progress. Identity/challenge/watchdog/manual holds remain account-wide. Unknown post-submit outcomes remain conservative: the installed workflow can lose identity during verification, so a generic write-not-verified is NOT enough evidence to narrow its hold.

Review recovery now persists attempts and nextAttemptAt, retries only reads after 15 minutes with exponential backoff capped at six hours, retains old read evidence, and stops automatic retries on a positively observed mismatch. Diary recovery uses the previously implemented exact, fresh export evidence. Worker acknowledgement reconciliation also runs for unresolved results on unpaused profiles.

Two exchange threads permit bounded progress across profiles; the existing per-profile pending set still prevents overlapping exchanges. Health-file updates are serialized. List outbox retries survive restart: transient failures back off with bounded jitter; 400/409/413/422 or malformed results retain the payload in a visible parked state until protocol revision/repair. Other reports can progress. Health keeps parked results visible rather than forgetting them after ten minutes. Mini reports held write count and next recovery time.

Mini copied-live-state test: five documents, 1841 tasks, ~352ms migration, ~1.57ms average write-state read, exact JSON round-trip including settings and IDs. All six linked profiles preserved. Added ledger-aware settings verification, database backup and current-state downgrade export to the canonical maintenance release engine; rollback test passed. Local checks: 86 worker tests, 5 weekly tests, 21 browser tests, 72 write/recovery tests, 48 recovery/ledger tests (overlap), 40 adapter tests, 5 health tests, 2 real HTTP/OpenAPI tests, 7 rollout tests; TypeScript passed. Deployment and live verification still need a separate receipt.

### Live-verification correction

First rollout passed health but receipt-only reconciliation was rejected by OpenAPI: the existing Python sender includes action=idle and reconcileIds, absent from the schema. No write was replayed. Added both bounded fields and a regression that executes the real Python CatalogueClient to obtain the body, then submits it through Express/OpenAPI; it passes, and oversized/duplicate ID batches fail. The earlier capability-only HTTP test did not cover this separate request shape.

Also coalesced already-retained received snapshots per URL before metadata processing: newest snapshot wins, all subscribers are preserved, and one URL cannot have simultaneous metadata imports. Late reports had all been acknowledged, but the four historical duplicate jobs otherwise could each repeat metadata work. Regression test verifies one application and all four subscribers. These corrections require a second scoped maintenance rollout; no worker settings changes.
