# Letterboxd task ledger migration — local checkpoint, 2026-11-09

Status: implementation in progress; NOT deployed and NOT ready for cutover. Existing user toggles, schedules and production jobs have not been changed by this work. The earlier pending diary recovery remains pending too. Preserve unrelated next-env.d.ts changes.

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

## Still required before release

1. Complete centrally owned recovery scheduling and explicit blocker scope; content uncertainty must not silently become account-wide indefinite suspension. Preserve authentication/manual/watchdog holds and never blindly retry an executed mutation.
2. Complete bounded fair transport scheduling across profiles and durable retry classification. Permanent payload/schema errors must retain evidence without repeatedly blocking every later delivery.
3. Prove a live-shaped migration/rollback on copied state, including payload sizes, timing, exact settings/IDs and compatibility of server/bridge/extension. Test restart with real pending result outboxes.
4. Resolve retained list results and Zelza's existing entry using verified evidence after cutover, then verify all linked profiles. Do not resubmit uncertain diary writes.
5. Controlled coordinated cutover: preserve state, stop new claims, settle/checkpoint active work, install matching components, verify actual loaded versions and unchanged settings. Use PRPL-PC maintenance-aware rollout; no build polling. Record live release/rollback identity only after verified.

## HTTP versus browser clarification

`refreshDiscoveryLists` tries `importPublicList` first for its rotating saved/liked/owned public-list batch. Direct HTTP validates canonical identity, totals and full pagination (or a verified linked CSV). Browser work is fallback when this cannot establish a complete public snapshot. A reachability/public-visibility check alone is not a complete contents refresh.

The separate Tuesday weekly discovery flow currently queues browser work both for discovery pages and selected list contents. It is not currently an HTTP-first path. This checkpoint does not change that schedule or the 560-item weekly eligibility limit, and does not apply that limit retroactively to saved larger lists. The shared public-list worker pool remains.
