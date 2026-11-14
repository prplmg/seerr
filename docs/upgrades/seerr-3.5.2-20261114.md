# Seerr v3.5.2 integration

## Scope and source

All existing committed custom work was pushed to `origin/feat/weekly-list-reconciliation-20261106` at `9a15c56f` before integration. The isolated `upgrade/seerr-3.5.2-20261114` branch merges official tag `v3.5.2` (`18a90b4`). The original checkout and its generated next-env.d.ts line-ending difference remain untouched.

The 12 merge conflicts are resolved by combining custom behavior with upstream security checks. User-approved request semantics: additional seasons create a separate POST request; editing an existing request is allowed only while pending, as the existing UI already required. Backend enforcement now matches that UI. Custom multi-season approval, admin-only initial-search control, watchlist preference and analytics remain.

## Compatibility corrections

- Explicitly register seven custom review/Letterboxd entities and DiscoveryCacheSubscriber after upstream replaced automatic discovery with registration arrays.
- Retain requestAddToWatchlist in the safe authenticated-user settings allowlist; credentials remain excluded.
- Preserve background JSON decoding, paginated/token-scoped Plex watchlist caching and strict error propagation. Invalid responses cannot overwrite existing snapshots.
- Retain Plex identity repairs and the documented TVDB/TMDB disambiguation while supporting upstream custom-provider GUIDs; remove obsolete GUID-cache writes.
- Preserve custom blocklist filtering and add upstream hide-requested filtering with its default off.
- Combine both scanner test sets and preserve custom Spanish translation keys.
- Replace next.config.ts with upstream next.config.mjs and use the merged frozen dependency lockfile.
- Make the upstream test runner return a nonzero exit status for failed tests.

## Runtime and rollout

Official Windows x64 Node22.23.5 downloaded and checked against nodejs.org SHASUMS256.txt, SHA256 `247e9693d316da9857e44990e5e11709f596f18112251b8026ec6eed80bdf38a`. Matching binaries staged and hash/version verified at `C:/ProgramData/Seerr/node-v22.23.5/node.exe` and `D:/CatalogueBuilder/node-v22.23.5/node.exe`; no live launcher change during staging.

The maintenance-aware rollout now supports explicit source deletion, release-specific dependency installation, matching runtime verification, and native Mini migration rehearsal on an isolated database backup. No live database or credentials are sent to the builder. Database row counts and protected review/account/settings rows are checked after rehearsal. Existing toggles are fingerprinted separately. A single rollback is retained, including matching dependencies and launcher details.

Independent review identified that restoring the pre-switch database after startup could erase accepted writes. Rollback must retain the current database; the two approved upstream migrations are backward compatible with the previous app (DELETED=7 already exists, and the subscription change removes a uniqueness restriction). Any additional pending migration requires review before switching.

## Validation and release status

Backend and frontend typechecks pass. Focused lint passes. Custom API/database checks and review UI checks pass. The initial full run found stale test fixtures and persistent test-cache interference; these were corrected without weakening behavior assertions. Deployment tooling: 23 tests pass, including explicit protection for user/scheduler writes during rollback. Final full-suite result and production receipt will be appended after completion. Production has not switched yet.

Final isolated full regression suite: 742 tests passed, zero failures/skips. Backend/frontend typechecks pass, focused lint passes, six review UI checks and23 deployment-tool tests pass. Build and native release gates are next.
