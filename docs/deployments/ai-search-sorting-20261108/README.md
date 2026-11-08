# AI Search sorting — 2026-11-08

Source `c48fb910`; seven explicitly scoped application/schema files. Generated next-env.d.ts excluded. LIVE build `tt1fk10baK9mlRnUwl8ZS`, release `catalogue-20261108203445351-30019`.

Includes permanent sort icon at the right of filter chips, current order label, Best match/LB score/runtime/release year, direction and optional Then by. Local rules suggest ordering from clear prompt clues; explicit sort instructions win. Manual changes reuse the cached interpretation without new model calls. Back preserves manual order; History reopens the prompt suggestion. Stable ties and unknown values last. Sorting covers the same returned shortlist, not the entire catalogue.

Scores and runtimes share existing caches and bounded queue (four scores, two runtimes, four total). Series runtime means episode length. Metadata collection completion notifications now cover both fields.

Pre-release: 16 isolated tests passed for rules, API, history and shared metadata cache/concurrency; TypeScript client/server and lint passed. Actual-component mocked browser checks passed mobile/desktop/320px layouts, secondary ordering, Escape, Back without requests and History reset. Six-filter screenshots also verified wrapping/no horizontal overflow. No paid model call or live user search test.

Evidence `outputs/ai-sort-rollout-20261108`; visual evidence `outputs/ai-search-sorting-20261108`. PRPL-PC canonical maintenance rollout, one build awaited without progress/status/log polling. No Git push authorized.


Verified: one PRPL-PC build84.216s/install4.146s. Mini recreated/verified31dependency junctions; staged login/JS/server/SQLite checks passed. Branded maintenance page verified before stopping old PID5084, which exited on first attempt. Native API/schema passed under lease; lease cleared/public health passed. Seven source hashes match and binding/publication toggle fingerprint unchanged. All16public AI Search JS chunks match, including Sort results UI.

Rollback previous `mKCG9DhfHWLPphvGR2y47` retained at `C:/ProgramData/Seerr/catalogue-20261108203445351-30019-release/previous`, plus SQLite/state backups and source manifest in release directory. Use canonical maintenance-aware rollback. No retry, second build, toggle mutation or Git push. Scoped local release receipt supersedes local-only sorting notes.
