# Durable Letterboxd handoff — 2026-10-27, NOT DEPLOYED

User explicitly requested no deployment yet. Finish zelza activation after deployment.

## Completed live recovery

Read-only Verity observation 180acc28-df8c-450c-a048-b280043b74ff verified
margotnochill, complete diary inventory, zero entries. Recovered original task
450257b9-ad3e-4c8f-98d9-b74566d3c774 by inserting that same immutable ID into the
browser worker (not creating a new catalogue intent). Worker succeeded and
catalogue state is verified, canonical entry:
https://letterboxd.com/margotnochill/film/verity-2026/ (watched 2026-10-27).
Only one write was executed. Two extra post-recovery read-only inventories were
inconclusive; neither retried the write. All five existing publishing settings
and existing runtime account pause states remained unchanged.

## Zelza

Catalogue user 14, Letterboxd zelzingb, Edge Profile 6 (zelza), worker instance
6a7476f9-f1a1-4ea6-b230-013c21920ddc. User enabled InPrivate; verified identity
probe succeeded. Runtime and catalogue linked; first watchlist scan succeeded.
Runtime config backup: catalogue-before-zelza-1793144690.json in runtime folder.
User explicitly approved one global publication-sync run to establish baseline.
Export job 9b5f9c0b-c37e-4a34-9bc6-3f1690347f95 failed reconciliation with
ECONNABORTED: timeout of 10000ms exceeded. No export baseline committed and
outbound publishing NOT enabled. Retain the archive; after deployment, safely
resume this exact reconciliation, verify complete baseline/holds/identity, then
enable publishing only for user 14 through the readiness-checked API. Do not
manually clear the alert without successful reconciliation or change other users.

## Pending source changes

- New worker advertises durableDelivery=1. Only newly negotiated catalogue
  deliveries are tagged replayable; dropped responses replay the exact ID.
  Worker enqueue is idempotent before/during/after execution. Old uncertain
  writes, legacy clients, disabled users, account mismatch and unknown/conflict
  states remain fail-closed. No blanket reset of dispatched tasks.
- Server logs offered IDs and accepted outcomes; worker retains bounded rotated
  transport-errors.jsonl with safe error reason, type/status/errno, instance,
  intent when known, and function/line context. Unknown exception text is omitted
  to avoid recording reviews/credentials. Successful polls do not erase history.
- Axios ECONNABORTED export timeouts are retryable under existing bounded budget.
- Own-account API returns fullyIntegrated only for matching enabled browser and
  publishing settings. Contact Melanie notice hidden for integrated users and
  while status is loading. Existing self-service settings/import changes retained.

Validation: 27 server handoff/API tests, 63 worker queue/client tests, 2 export
inbox tests, self-service/notice regression checks, client and server typechecks.
No build, app deployment, or worker restart performed. Deploy catalogue and
updated catalogue_client.py together to activate negotiation and retained logging.
Worker source and tests are recorded under tools/letterboxd-worker in the Git
checkpoint; editable operational source remains ../seerr-social/letterboxd-pilot/edge-worker.
