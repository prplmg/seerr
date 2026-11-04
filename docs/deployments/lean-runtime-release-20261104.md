# Lightweight runtime and field concurrency deployment — 2026-11-04

User authorized commit and deployment during voice conversation. Source changes were already committed in `52b385ec9f4d67fb887b822d1c3e4dd958ff8b8b`, including lightweight runtime changes from `bbf9fb6ea81e054733ecfc79648fbc0697717961`.

Deployed only server/api/themoviedb/index.ts, server/lib/listSort.ts and server/routes/discoveryLists.ts. Four score tasks, at most two runtime tasks, maximum four total tasks in the shared list-sort queue. Both list sorting and limited-time filtering use the base movie endpoint. Existing caches, user toggles and sync schedules unchanged. Review reactions/comments remain an exploratory idea and are not part of this release.

Build `20cM2gc74VAenO7yfSEkH` is live. Previous build `T0OFnmdW2SldlD1rCsYZ4` preserved in `C:/ProgramData/Seerr/catalogue-20261104211850293-18998-release/previous`; source/state/database rollback evidence in the parent release directory.

Validation: prior 12 focused tests plus server TypeScript and scoped ESLint passed. Production frontend/server build and migration/schema checks passed. Public health and review/series API release checks passed. Post-deployment verification matched all three source hashes, confirmed the worker limits and lightweight calls in compiled code, checked unchanged publishing settings, and fetched seven limited-time results, all with valid durations at or below 90 minutes. Both virtual watchlist descriptions remain empty. Release engine verified unchanged account mappings and all six publishing settings.

Deployment launched exactly once. Waited on local process-exit events without polling build status/logs or restarting the release. Read the final deployment log only after success. No remote Git push performed. Benchmark evidence and timing limitations remain in runtime-lean-20261104.md; this deployment verification is not a new performance benchmark.
