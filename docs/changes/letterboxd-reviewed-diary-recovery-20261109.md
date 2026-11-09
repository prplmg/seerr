# Associate unambiguous reviewed diary entries

Plain pending watch publications can now reconcile to an existing reviewed Letterboxd diary entry. The complete, account-bound committed export must be fresh (24 hours), captured after the intent, and identify exactly one film/date/rewatch candidate absent from the complete recent pre-write inventory. Matching review rows must agree on date and rewatch; duplicate aliases, competing reviewed entries, incomplete/unresolved identity evidence and competing local intents remain held.

Association records only the diary receipt and marks the pending intent verified. It never submits a Letterboxd form, alters review/rating fields, or adopts a review-content baseline. The already-deployed worker's exact receipt exchange handles unknown or blocked outcomes and resumes only when all existing holds permit. User toggles unchanged. Combined review/content publication intents retain their stricter recovery path.

Tests: 109 recovery/worker/receipt tests passed, including reviewed entry association, unchanged export/review/rating/settings, idempotent replay, receipt conflicts, every existing evidence guard, duplicate same-day entries and receipt-only endpoint recovery with no publication continuation. Server TypeScript passed. One runtime file in release; tests/docs committed separately from unrelated next-env.d.ts.

Deployed as build `IMyC6iBka0tFOzjraTMQg`; see [verified release receipt](../deployments/reviewed-diary-recovery-20261109/README.md). Existing reviewed entries may wait for the next successful complete export; no extra page-load requests or automatic external edits are introduced.
