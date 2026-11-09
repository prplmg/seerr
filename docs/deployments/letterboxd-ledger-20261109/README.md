# Letterboxd ledger and worker migration — 2026-11-09

## Release identity and scope

Final LIVE build `Ga2jPHD7DjJyo_7YXJGIA`, release `catalogue-20261109182304929-5853`, source through `72bfcbd6` (includes `39eefa60`, migration `859c8e9f`, checkpoint `dbb43518`, diary recovery `53635a73`). Matching worker and loaded browser extension `0.2.50`. Unrelated generated `next-env.d.ts` was excluded. No Git push performed.

Initial migration build `Z4LZt4b0xEYkAC-6h1jo_`, release `catalogue-20261109181212512-4981`, passed rollout health. Live receipt reconciliation then exposed missing OpenAPI fields in the actual Python request (`action=idle`, `reconcileIds`). The follow-up release fixes that contract and coalesces already-retained list snapshots before metadata processing. This required two PRPL-PC builds, each started once and awaited to completion without build polling. No uncertain write was replayed because of the rejection.

## Implemented

Five JSON task stores migrated transactionally into one Mini SQLite ledger. Stable task IDs/settings, nested transactions, durable receipts and transition history, private WAL storage, current-state rollback export. Original JSON remains historical evidence, never dual-written.

Fair two-thread profile exchanges with per-profile serialization; independent publishing, heartbeat and list lanes; durable transient backoff and visible retained permanent delivery failures; lease-aware late results and shared per-URL list deduplication. Confirmed content conflicts hold only their subject; identity/manual/watchdog and uncertain post-submit outcomes remain conservative account holds. Read-only review recovery has persisted retry scheduling; exact plain-diary export recovery and receipt reconciliation repair server/worker disagreement.

The public-list worker pool remains. Ordinary saved/liked/owned refresh is HTTP-first with complete pagination validation and browser fallback. Tuesday weekly discovery still uses browser tasks; schedule and 560-item eligibility cap unchanged.

## Rollout and rollback

Both releases staged online on PRPL-PC, checked all 31 dependency junctions and staged login/JS/compiled server/SQLite, took the Caddy maintenance lease for the switch, verified branded maintenance and native Mini health, then cleared the lease and verified public health. Initial build/install: 79.963s/3.648s; correction: 43.010s/1.586s. These are build/install timings, not total maintenance duration.

Final release backup: `C:/ProgramData/Seerr/catalogue-20261109182304929-5853-release`; immediate previous build is `Z4LZt4b0xEYkAC-6h1jo_`. Original pre-migration build `Cys3zO0KTNv1XDhWf5-4M` retained under `C:/ProgramData/Seerr/catalogue-20261109181212512-4981-release/previous`.

Worker backup and consistent queue: `C:/Users/MSI/lb-ledger-20261109/backup`; additional before-correction queue snapshot retained. Worker stopped only after checking no active mutation. Protected catalogue.json/config.js hashes unchanged. **Future rollouts must use the ledger-aware release engine/helper.** To roll back to a pre-ledger version, export CURRENT ledger state and move the ledger aside using the tested helper; never restore stale original JSON after new work.

## Validation and recoveries

Passed: 87 worker tests, 5 weekly tests, 21 browser tests including real Python report validation, 72 write/recovery tests, 48 recovery/ledger tests (overlap), 40 adapter tests, 5 health tests, 3 actual HTTP/OpenAPI contract tests, 9 list tests and 7 rollout/rollback tests. TypeScript passed. Copied-live-state rehearsal: 1,841 tasks, ~352ms migration, ~1.57ms average write-state read, exact document/settings/ID round-trip. Tests do not guarantee future third-party browser behavior.

All six linked accounts passed fresh RSS imports and authenticated identity checks: prplmg, ykrn/jairoheredia, avellana/evegrissel, margoTica/margotnochill, wampiro/beast199666 and zelza/zelzingb. All six browsers actually loaded 0.2.50. Shared playback-history checks succeeded. Deployed source hashes and the full publication/binding toggle fingerprint matched expectations.

Four retained 1005-film Psychedelic Films Compilation results were acknowledged and all four server tasks succeeded, reusing `lb-99b6fdd64da6622a405654e10c39274c`. No duplicate list creation; saved-user subscriptions retained. Worker has no unacknowledged completed lists or delivery retry holds.

Zelza's A Quiet Place Part II reconciled automatically to her existing Nov3 entry through the new receipt exchange. Resident Evil then encountered an existing reviewed entry for Nov7 and safely stopped before creating a duplicate. A fresh authenticated read confirmed exactly one canonical entry/date, rating3 and her original text, corroborated by the committed export. A guarded one-off transaction linked that existing entry to the playback origin and marked its intent verified; it preserved her rating/review, checked receipt conflicts and unchanged settings, and made zero external writes. Current-state backup: `C:/ProgramData/Seerr/lb-ledger-20261109/before-resident-association`. Automatic plain-diary export recovery intentionally excludes reviewed entries; this special case required additional read evidence and remains a documented limitation.

Avellana's City of God remains verified at the existing entry. Historical unknown/blocked observations and obsolete worker records remain retained as evidence; their totals are not active queue counts. No fabricated test reviews or diary writes were used to prove health.

## Evidence

Local `outputs/lb-ledger-rollout-20261109/`: both rollout logs, contract/type/test logs, identity-results.log, verified-all-users.log, verified-api-health.log, verified-worker.log, verified-worker-health.log, resident-evidence.log, resident-observed.json and resident-associated.log. Final runtime receipt below records the post-reconciliation checks.

## Final runtime receipt

All six configured profiles ready and unpaused on both worker and server, with check-ins 8–12 seconds old, no queued/dispatched/unknown/conflict catalogue writes, no recent transport errors or pending list delivery retries. Both Zelza intents are verified against existing entries. Fresh RSS imports and identity probes succeeded for every account; no artificial publication was created for testing.

Final worker-only correction `b6f49438` includes blocked results in receipt reconciliation, under the same exact account/payload/entry checks, positive server resume decision and local hold checks. Live verification revealed this missing state after Resident Evil's duplicate guard fired. Regression covers absent, malformed and exact receipts and proves no new media-write job. Installed after a guarded worker stop/backup (no active mutation), protected config hashes unchanged; no catalogue rebuild needed. Runtime catalogue_client.py SHA256 `c2649b7a7b8d325671eea8daaf463f078e4c4bf392c36dab64d8506cb10de338`. Backup `C:/Users/MSI/lb-ledger-20261109/before-blocked-receipt.sqlite` and `catalogue_client.before-blocked.py`.

Historical worker records with no current catalogue intent remain retained rather than reinterpreted or replayed. Healthy current queues do not mean every historical failure record was erased. Future reviewed-diary associations still require stronger evidence than the plain-diary automatic export rule.
