# Weekly bridge compatibility repair — 2026-11-11

## Cause and scope
Tuesday's weekly cycle started, but its first discovery job was not claimed: the migration bridge only advertised list support for extension 0.2.48, while all six active profiles ran 0.2.50. It also omitted weeklySupported. No discovery/import/retirement phase completed in that scheduled attempt. A separate weekly bridge copy had newer capabilities but lacked subsequent reconciliation changes.

Canonical source is now tools/letterboxd-worker. Weekly catalogue_client.py and queue_store.py are symlinks to it; Windows staging dereferences them. Restored explicit supported-version capability sets and weekly payload validation without replacing blocked-write reconciliation. Installer requires expected live hashes, idle queues, preserved account/config hashes, and restarts only the bridge task. Source commits: 23680ffe, 4595ed12.

## Validation
90 Python worker tests; 5 Python weekly tests; 6 browser Node tests; 6 weekly TypeScript tests passed. Includes compatibility against the actual released extension manifest, stale/unsupported/private-window rejection, capability distinction for old adapters, canonical-source identity, weekly mode/cap preservation, and operator continuation lease bounds. TypeScript no-emit and production build passed.

## Deployment
PRPL-PC native Windows build; 81.673 seconds build, 4.522 seconds install; 31 dependency junctions verified. Live build em5wMnsArd2WlWgEYw0q0. Only server/lib/weeklyLists.ts and server/lib/weeklyListsState.ts changed in the catalogue release. Pending Finder AI-notice UI correction and unrelated next-env.d.ts excluded.

Canonical maintenance rollout: staged login/chunks/server+SQLite passed; branded public maintenance page checked before exact old process stop; native health under lease and public health after clearing it passed. Source hashes, served chunk and live library API verified. Sole rollback: C:/ProgramData/Seerr/catalogue-20261111183415249-89698-release.

Bridge backup: C:/Users/MSI/MultimeldiaLetterboxdRuntime/compatibility-backup-20261111-123431.
Installed catalogue_client.py SHA256 af279f75dc9afb8bff37c07f2af8a6b4e7160cc1fd16289f977ca04dedfabca1.
Installed queue_store.py SHA256 86822af265099c5dbfd0e6446aa73d7a7e0ebb243f0e23fddf78078b53f31eb8.

## Real weekly verification
COMPLETED and live-verified. Mini remains coordinator/importer; existing PRPL-PC browser profiles supply browser observations. No isolated benchmark output copied into production. Resumed existing incomplete checkpoint via an operator-only two-hour continuation grant; normal maintenance/health guard, one outstanding weekly job, 560-item cap, saved/owned-list protection and retirement policy remain active. No schedule changes.

Real run12:40:46–13:24:57 America/Merida:44m11.073s end-to-end.8/8 discovery pages,64 unique candidates,43 eligible lists;43/43 completed and verified freshly checked in the live list store.9,014 resolved memberships plus3 retained unmatched entries (9,017 source memberships).0 import retries,0 failed lists,0 retired lists. Temporary operator grant removed. Two brief maintenance/health deferrals cleared automatically. All six active browser profiles fresh after completion (10–21s heartbeat ages).

Final configuration verification: global/user/sync toggles unchanged; only normal Plex library lastScan timestamps advanced. Final public health200, source hashes/served chunk verified, mixed library API20 results/408 total, maintenance cleared and exactly one rollback retained. No production browser walkthrough or future scheduled-run guarantee claimed. Raw sanitized results: final.json and verification.json.

The44m11 real pipeline time includes normal browser worker handoff, acknowledgement, server scheduling and protective pauses. It is not comparable to the earlier isolated2m10 processing benchmark or the PC cold batch; do not use it as hardware-only performance evidence. Weekly orchestration and imports remain on Mini; existing browser work remains on PRPL-PC.

No Git push performed.
