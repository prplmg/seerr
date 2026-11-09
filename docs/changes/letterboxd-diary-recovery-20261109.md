# Letterboxd diary verification and durable worker reconciliation

Status: local implementation; not deployed. Existing production toggles unchanged. No automatic resubmission of uncertain writes.

## Evidence and diagnosis

Avellana: November 3 worker job `defd417b-9ef2-482c-a89e-1ffb98a71d3c` submitted the How to Train Your Dragon (2025) diary save, then returned write-not-verified. The original timeline retained navigation and dispatch events but no precise failed verification check. The catalogue later verified the canonical diary entry; the worker retained unknown and paused. The Nov9 guarded one-off reconciliation fixed this state mismatch and City of God subsequently published/verified. Do not claim the original save failed or invent a specific browser selector failure.

Zelza: preflight observed an empty complete diary inventory at 1793758753088; submission was recorded at 1793758781414, about 28 seconds later. A manual Letterboxd log during that interval remains possible; neither export nor worker records establish authorship. The latest export contains exactly one matching dated diary entry. The fresh Nov9 browser observation failed editor-unavailable. Generic review observation requires an editor even for plain diary cases, while automatic recovery previously only covered review writes.

## Changes

- Bounded receipt-only `/writes` exchange with `reconcileIds`; it always returns idle, never claims browser work or invokes publication continuation. Server validates the linked account and returns only verified receipts for that account.
- Paused worker checks verified receipts even when its original unknown report was acknowledged. Exact saved payload values and canonical entry identity are checked before atomic reconciliation. Other unresolved writes, active writes, watchdog/read holds and server settings continue to gate resume.
- Reconciled receipts awaiting permission to resume are persisted across worker restarts and rechecked fairly alongside unknown jobs; they clear only after the existing holds permit resume. Manual-only accounts receive no invented recovery candidates.
- Checks are limited to ten IDs and one attempt per minute per account. They run in the worker, not page loading paths. Independent read observations continue.
- Plain diary recovery can use the committed account-bound browser export (at most 24 hours old, captured after the intent), persisted canonical mappings, and complete recent pre-write inventory. Requires exactly one account/film/date/rewatch match, no preexisting candidate or competing local intent, no review content, and durable receipt persistence before queue transition. Maximum two recoveries per call. No remote write or metadata/network lookup.
- Export-positive reconciliation establishes that the requested state exists, not who created it. Entries already in the pre-write inventory, ambiguous records and combined review/content writes remain held.
- A generic-film editor-unavailable observation may follow exactly one canonical account/film diary entry from the authenticated complete inventory, then retry the read once. Explicit entry/create-new operations and ambiguous inventories do not use this fallback. It supplies no guessed field values and submits no form.
- Browser diagnostics retain allowlisted underlying verification reasons through generic workflow outcomes, without logging raw DOM, credentials or arbitrary error text.

## Validation and limitations

Read-only replay of actual Zelza evidence selects only `https://letterboxd.com/zelzingb/film/a-quiet-place-part-ii/` with watched date 2026-11-03 and rewatch false. No production queue mutation was performed by this replay.

Tests cover account/value/entry mismatch, duplicate candidates, preexisting manual entries, stale evidence, persistence errors, replay, receipt-only API behavior and no publication continuation. Detailed outputs are in `outputs/lb-reconcile-20261109/`.

Current export provenance is the authenticated browser-job ingestion path; ordinary user uploads do not update this baseline. capturedAt is trusted-worker download-start time, not an independent Letterboxd archive-generation timestamp. If manual uploads ever populate baselines, add explicit provenance before allowing recovery. A browser UI change can still fail verification; positive export evidence provides an independent recovery path. Conflicting evidence remains actionable, not silently ignored.

Deployment must include catalogue server code, both maintained worker client copies and browser automation.js. Install through the maintained rollout/worker procedures, then verify actual restarted child processes and worker health. Preserve accounts, tokens, toggles and rollback files. No push or deployment is part of this local receipt.

Final local verification: 68 server/receipt/API tests; 84 Python worker tests; 5 weekly worker tests; 14 browser diagnostic/fallback tests passed. Server TypeScript check and scoped ESLint passed; browser syntax and scoped diff checks passed. Actual Zelza export replay produced one exact recovery plan, without modifying production. New UI/browser behavior has not yet been exercised through a deployed extension; rollout must verify that boundary.
