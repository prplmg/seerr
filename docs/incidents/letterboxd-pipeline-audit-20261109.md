# Letterboxd extension pipeline audit — 2026-11-09

Read-only production audit. No jobs retried, accounts unpaused, toggles changed or deployments performed. Local temporary SQLite reproduction only. Evidence: workspace outputs/lb-pipeline-audit-20261109; preceding scoped evidence outputs/lb-reconcile-20261109. Current worker has no reconcile_writes method; commit53635a73 is pending and MUST NOT deploy unchanged (finding1).

## Executive finding

This is a distributed task system, not one queue. Browser automation is intrinsically fallible, but the persistent stalls are also our orchestration defects: duplicated terminal state, account-wide blocking, incompatible retry policies and incomplete cross-component tests. More unit tests or blind retry alone will not resolve this.

## Observed architecture

1. Catalogue events: authored ratings/reviews, completed Plex watches (including supported co-watch events), scheduled reads. Ordinary RSS import is separate from the extension.
2. Mini plans immutable expected/desired write intents, separate preflight observation requests and entry receipts. These live in separate JSON stores plus catalogue/export SQLite records. Reads establish account, remote state and duplicate-avoidance baseline before a mutation.
3. PRPL-PC Python bridge exchanges work with Mini and persists its own SQLite jobs, deliveries, acknowledgements and pause records. One global exchange loop serializes profile exchanges; each browser profile also executes one job at a time.
4. Edge extension polls the bridge, accepts a delivery/execution ID, checks logged-in identity, navigates Letterboxd, reads the existing state, submits the intended mutation once, then reads back the result. IndexedDB retains active workflows and pending results across extension suspension.
5. Browser result -> bridge SQLite -> catalogue acknowledgement -> catalogue entry receipt/projections. Each hop is independently durable, but not one transaction. Local and remote terminal states can disagree.
6. Exports/RSS/watchlists/lists are separate consumers with overlapping account/runtime infrastructure. A successful export is not automatically proof that a pending write was reconciled.

Code pointers: tools/letterboxd-weekly/{bridge.py,queue_store.py,catalogue_client.py,automation.js}; server/lib/{letterboxdWriteQueue.ts,letterboxdObservations.ts,letterboxdWriteRecovery.ts,letterboxdExportInbox.ts}; server/routes/letterboxdWorker.ts; server/index.ts.

## Zelza: what waited, what retried

A Quiet Place Part II mutation33865693-277a-47b2-b291-27ef100ba1b3 was attempted November3. It remains unknown in live worker state. Resident Evil's later preflight succeeded, but its catalogue write waits because claimWrite blocks every new write for a user if any intent is dispatched/unknown/conflict. No second media_write job for the earlier title exists in the retained worker queue. No automatic follow-up observation for that title appears after the failure; the only later check is our explicit November9 diagnostic, which failed editor-unavailable.

After the failure, Zelza completed12exports,12list scans,5watchlist scans, and Resident Evil's preflight read. These are not retries of the blocked mutation and did not reconcile it. Current live pause remains1. Latest export proves one matching dated diary entry exists, but not who created it. Preflight absence ~28seconds before submission cannot exclude a concurrent manual Letterboxd log.

## Retry semantics today

| Work | Behavior | Gap |
|---|---|---|
| Browser result delivery | Three short transport attempts; durable pending result retried on later wakeups | Permanent schema errors can trap the same payload |
| Write offer not executed | Durable ID can be reoffered/deduplicated | Not the same as submitting Save twice |
| Uncertain executed write | No blind mutation retry; account paused | Live plain-diary recovery missing |
| Review recovery | One bounded read-only recovery; ten-minute checking timeout | Recovery unavailable is not an ongoing state-driven retry schedule |
| Ordinary preflight reads | Consumer-driven retry budget, up to three attempts with15/30minute backoff | Exhausted records need explicit resolution; health alone does not revive them |
| Read-related profile pause | Identity probe possible after15minutes subject to other holds | Separate pause/worker/server rules make behavior hard to infer |
| Export reconciliation | Up to four transient attempts with1/3/10second delays | Success does not automatically settle pending diary write |
| List-result delivery | Earliest unacknowledged report, roughly45second minimum exchange interval | 413 repeats unchanged and blocks subsequent reports on that profile |
| Watchdog | Running job stale after180seconds without events or3600seconds overall; safe no-progress delivery can be reoffered | Other uncertainty creates another pause state |

Scheduler code defaults, not independently verified live overrides: playback planning30seconds; RSS15minutes; health5minutes; browser scans12hours; scheduled publication/export planning09:00/21:00 America/Merida. Extension alarm30seconds; bridge exchange minimum10seconds. These are scheduling intervals, not a delivery SLA.

## Findings and severity

1. **Release blocker: pending diagnostic schema incompatibility.** New automation.js emits `failureReason`; both queue_store.py report allowlists reject it. Reproduced against real Queue.event in temporary SQLite: ValueError Invalid report fields. Live schema also lacks it. Existing browser tests mocked the receiver, so171 passing tests did not prove compatibility. Fix the payload/contract and add actual producer-to-consumer tests before release. This is a flaw in our prior validation, not a Letterboxd outage.
2. **Active repeated oversized-list delivery.** Retained current log contains1733 lists HTTP413 failures within24hours (bounded/rotating log; not a lifetime count or unique list count). Four profiles have succeeded but unacknowledged list results of120399characters. Deployed-source server/index.ts sets15MB only for /exchange and import; /lists uses default express.json. The current list queue accepts snapshots up to4MB. Request-size contracts disagree. Set explicit consistent bounded request limits, validate serialized UTF-8 envelope size, classify413 as permanent-until-transformed, preserve the completed result and resend after repair. Do not rescan/reimport simply because delivery failed.
3. **Duplicated success and pause state.** Avellana was verified on Mini but unknown/paused on PRPL-PC. Pending receipt reconciliation addresses this, but its release is gated by finding1. A received-report acknowledgement must not be confused with successful Letterboxd mutation verification.
4. **Account-wide head-of-line blocking.** One uncertain title blocks unrelated later writes for that account. Appropriate for identity/session problems; excessively broad for one unresolved entry. Scope content ambiguity to account+film/entry; retain account-wide holds for authentication/challenge and bounded outage circuit breakers. Keep one active browser mutation per account.
5. **Uneven recovery coverage.** Plain diary writes lacked review-style recovery. Pending positive export recovery helps, but is conservative and can wait for a fresh export. It is not an instant universal recovery mechanism. Same-date duplicates, changed reviews and identity uncertainty must remain held.
6. **Mixed task lanes/global exchange serialization.** Publishing, heartbeat and lists run in one cycle; a publishing/heartbeat failure skips list exchange. The global bridge loop can make one profile's slow requests delay others. Preserve browser serialization but isolate transport/control scheduling, prioritize acknowledgement/recovery, and use bounded fair concurrency across profiles.
7. **Retries are distributed rather than owned.** Several independently implemented timers, budgets, watchdogs, pause records and acknowledgements govern progress. Define nextAttemptAt, attempt type and blocker scope centrally; expose when/why the next action will occur. Never equate recurring health checks with recovery work.
8. **Release/version drift risk.** Multiple maintained client/queue copies and hard-coded adapter version gates differ; current live client supports0.2.49 while the generic copy has older capability checks. A release must specify one exact server/bridge/extension/schema compatibility set and verify loaded versions, not just copied files.

Historical context:935 blocked iBoy reads occurred October28–30; not a current storm. Across the last14days the retained worker shows17currently-succeeded media_write jobs and1unknown, including manually reconciled successes. These are final states, not first-attempt success rates; do not use them to claim reliability percentages. Current six active linked profiles: five unpaused, Zelza paused.

## Recommended simpler target

Keep the extension as an authenticated executor; no need for Redis/Kafka or another server at this scale.

Use one authoritative durable job/attempt ledger in the catalogue's SQLite database. Each task has a stable ID, account, subject/entry, kind, desired revision, state, lease, nextAttemptAt, last safe error, verification evidence and explicit blocker. PRPL-PC retains only a durable local execution/result outbox and per-profile lease; it does not independently decide business success. Browser IndexedDB remains an execution receipt/outbox safeguard, not a third business queue.

States: queued -> checking -> ready -> applying -> verifying -> succeeded. Separate retry_wait from needs_review. An interrupted applying/verifying state becomes verification work, never an automatic fresh Save. Auth failures hold the account; ambiguous content holds its subject. Subsequent edits coalesce only while a task is unclaimed; once applying, preserve its immutable revision and queue the newer revision separately.

Retry matrix: transport/429/5xx get bounded exponential backoff+jitter and Retry-After; payload/schema/auth/permanent failures require transformation, reauthentication or a parked actionable task. Failed read verification retries reads; reuse positive canonical export evidence when exact. Only confirmed absence and unchanged preconditions can permit a new explicit mutation attempt; browser automation cannot offer a true exactly-once remote guarantee.

Separate lanes for user publication/recovery, authoritative reconciliation, and background discovery. No list delivery failure should obstruct a watch receipt. Export is a repair input, not the main acknowledgement channel. Health UI should show per-lane last success, oldest pending task, blocking title/reason, next attempt and whether intervention is needed.

## Execution order proposal

A. Correct the pending protocol regression and active413 delivery mismatch; test real HTTP parsing and real bridge validation. Preserve existing results and toggles.
B. Release verified-receipt/diary recovery with coordinated version checks and live read-only verification of exact affected entries; do not batch reissue mutations.
C. Introduce authoritative job/attempt ledger and typed shared envelope, keeping stable IDs and migrating outstanding jobs with comparison mode before switching executors. Remove redundant state only after equivalence is established.
D. Narrow holds, separate lanes, standardize retries/health; prove restart/network-failure/manual-edit cases at every handoff.

Acceptance: valid reports survive every hop; no duplicate after crash immediately before/after Save or acknowledgement; manual LB changes are not overwritten; unresolved title does not starve unrelated work; permanent413/schema failures do not loop; each blocked job has a visible next action; deployment leaves toggles unchanged.

Audit limitations: no new live mutation or browser submission; no independent source of Letterboxd authorship; transport log rotation prevents lifetime rates; no performance benchmark of proposed architecture. The exact original browser verification failure for avellana cannot be reconstructed from retained generic logs.

## Follow-up: identity of four list payloads and migration stop policy

All four outstanding results are `https://letterboxd.com/jbodes/list/psychedelic-films-compilation/` (Psychedelic Films Compilation),1005items each. Every snapshot contains the exact same set of film URLs. Two full snapshots are identical; earlier snapshots differ in only one/two item metadata records. No account-specific content is involved: snapshots explicitly mark anonymous/complete.

Mini has four separate nonweekly jobs, users empty, all marked blocked after one-hour browser timeout despite worker succeeded results. Existing catalogue list IDlb-99b6fdd64da6622a405654e10c39274c is saved by users1and4. This matches the periodic saved-list refresh fallback: direct refresh fails -> queueBrowserList(url) -> available permitted profile claims shared public job -> completed result rejected413 -> Mini times out -> later refresh no longer sees an active job and creates replacement -> another profile scans same list. Attribution is supported by nonweekly/no-user job metadata, saved-list eligibility and source call path; no claim of an original manual click.

Tuesday schedule concerns automatic discovery. The separate12hour browser job also refreshes saved/liked/owned public-list references in a rotating batch of20. Manual imports can occur on demand. Weekly560-item limit applies to weekly-marked jobs, not this saved-list refresh; do not silently remove the user's1005-item list. The workers are a shared pool on one PRPL-PC/IP, not a requirement to fetch public content under every user's account. Two list scans at most can run concurrently. Recommended replacement: one shared anonymous public-list lane/deduplicated task per canonical URL, distinct from per-user authenticated exports/writes. Missing acknowledgements retry delivery of retained results, not scans.

User explicitly accepts temporarily stopping recoverable work during migration, including twice-daily imports. Plan a controlled cutover: stop new scheduling/claims; preserve queues, snapshots, IDs and pending acknowledgements; finish or checkpoint active local DB commits; interrupt/reschedule read-only scans and downloads as needed; let active Letterboxd mutations finish or retain them as uncertain and verify after restart; never erase in-flight mutation evidence or resubmit blindly. No jobs stopped in this audit turn; no migration begun.

## Resolution — 2026-11-09

Coordinated migration and contract/receipt repairs deployed; all six linked profiles verified ready with unchanged toggles. Four retained list results settled; both Zelza watches linked to existing entries without duplicates. See [deployment receipt](../deployments/letterboxd-ledger-20261109/README.md) for exact builds, tests, live corrections, retained limitations and safe rollback.
