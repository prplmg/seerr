# Mini obsolete-artifact cleanup — 2026-11-04

Explicit user authorization: clean obsolete build/test artifacts. Removed187 preflight-validated direct-child build/stage, benchmark/trace and obsolete release folders under C:/ProgramData/Seerr. No failures. Recursive deletion used lstat and unlinked junctions/symlinks without traversing targets. Verified no active deployment lock, unchanged live build, no running process/scheduled-task references to candidate names, and no external link references from the prior completed inventory.

C: free increased from4,459,294,720bytes (4.15GiB) to13,039,263,744bytes (12.14GiB):8,579,969,024bytes (7.99GiB) reclaimed. Space delta includes ordinary concurrent disk activity.

Preserved app, data, logs, runtime/tools, active services and the latest two verified rollback directories with paired native stages:
- catalogue-20261104135754812-1043-release/native
- catalogue-20261104092709395-91826-release/native

Live remains moKy4UU8ntkn_SPxP3ica. Publishing settings/account-mapping hash unchanged across cleanup. Post-cleanup GET-only verification passed all seven deployed source hashes, list/watchlist endpoints, progress validation/auth and11 runtime-sorted watchlist titles. No service restart, deployment, media deletion, VM change, concurrency change or Git push. Full plan/result and health evidence are in the adjacent JSON receipt. Older rollback paths mentioned in historical notes may now be removed; the two listed above are retained.

## Follow-ups not implemented

- Automate bounded retention after successful future releases; do not accumulate unlimited stage/test/rollback trees.
- Evaluate D: for build staging after reviewing dependencies.
- Compare list metadata concurrency2 vs4 with cold acquisition completion times, page latency, CPU/memory and failure rates. Current2-worker setting was conservative, not a benchmark-proven optimum. The underlying Letterboxd reader has a shared8-request ceiling and falls back when saturated; leave headroom for detail-page requests. Runtime and rating list work currently share the two-worker queue. No live cap changed in this cleanup.
