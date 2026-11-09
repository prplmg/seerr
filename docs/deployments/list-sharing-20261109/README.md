# List sharing and previews — deployed 2026-11-09

Source `50a948c5`; includes pending commits `ae270182`, `d0a21c97`, `ffa3c151`, `50a948c5`. Nineteen source/schema files explicitly scoped; unrelated generated next-env.d.ts excluded. No Git push.

LIVE build `Vjl5a1Y-nLXyPB_HkNRIS`, release `catalogue-20261109045609723-43083`.

Includes viewer/editor grants for created lists, automatic Shared with you category (separate from saved), owner-only permission/visibility/deletion, stale-edit protection, simplified sharing feedback, canonical catalogue.prpl.com.mx sharing links, public summary/thumbnail landing pages and generic private previews, authenticated redirect/login return targets, finder availability/requester badges, and three AI placeholders rotating every eight seconds with focus/text pause.

One canonical PRPL-PC rollout. Build 85.038 seconds; dependency install 3.846 seconds; 11,388,181-byte artifact. Mini recreated/verified 31 exact dependency junctions. Staged login/JS/server/SQLite checks passed. Branded maintenance verified before stop; old PID7380 exited on first attempt. Native health/schema checks under lease passed; lease cleared and public health passed. Build logs/process state were not inspected during execution; terminal completion awaited. Existing sync toggles unchanged by fingerprint.

Live acceptance: all 19 deployed source hashes match; all 34 public JS chunks across lists/list detail, login, AI Search and finder match deployed artifacts. Sharing UI markers and placeholder present. Shared category returns 200. Public share route correctly returns 404 for missing list, and compiled Mini thumbnail renderer generates 1200×630 PNG. No active created lists exist in the current store, so live list-specific public/private previews and owner-sharing reads were skipped; no artificial catalogue data was created. Mocked route/browser tests cover those paths. WhatsApp itself has not been tested.

Finder read-only smoke: 20 results, total237, continuation1, unknown0; each card includes media status, all results' catalogue availability checked with read-only SQLite. Elapsed22.254s includes a deliberate20s completion wait, not a load benchmark.

Local validation receipts: docs/changes/finder-badges-placeholder-20261108.md, list-sharing-20261108.md, list-share-previews-20261108.md. Sharing's broader suite had one pre-existing discovery preview assertion failure reproduced against baseline; relevant sharing/preview tests, typechecks and focused lint passed.

Rollback: previous build `9xZ0eKYeK44oEc7Z6b_PM` retained at `C:/ProgramData/Seerr/catalogue-20261109045609723-43083-release/previous`, with before.sqlite3, state backup and source manifest. Use the maintenance-aware rollback engine. Evidence: parent workspace outputs/list-sharing-rollout-20261108/{scope.json,hashes.json,preflight.log,rollout.log,verify.log,features.log,api.log,verified.json,before.json}.
