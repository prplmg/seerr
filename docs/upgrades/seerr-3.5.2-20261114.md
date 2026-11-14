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

## Validation and completed release

Deployed successfully on 2026-11-14 from pushed application merge `4beb7755` and rollout helper correction `332195cf`, branch `upgrade/seerr-3.5.2-20261114`.

- Version **3.5.2**, build **9VGv9iSIjm-FenLPLsfht**.
- Release **catalogue-20261114203211262-95172**. Single rollback: `C:/ProgramData/Seerr/catalogue-20261114203211262-95172-release/previous`.
- 742/742 application tests pass; backend/frontend typechecks, focused lint, six review UI checks and 23 rollout/recovery tests pass.
- PRPL-PC frozen install 57.082s; build 71.934s. Mini isolated dependency installation 5m 4.9s. Matching Node22.23.5 used. These are phase timings, not total downtime.
- Native Mini preflight, protected-row migration rehearsal and old-runtime compatibility rehearsal pass. 31 exact dependency junctions recreated and verified.
- Branded maintenance page verified before stopping; old process stopped on first attempt. Native/public health passed and maintenance lease cleared. Retention removed the prior rollback payloads, leaving exactly one rollback.
- Existing global, user and Letterboxd sync toggles unchanged. New upstream defaults hideRequested=false and empty ntfy tags are the only settings additions; Plex scan timestamps advanced normally.
- Live authenticated watchlist preference, credential exclusion, lists, releases and review endpoints pass. All six Letterboxd workers ready with no queued, dispatched, held, conflict or unknown writes. Historical 503/connection-reset entries correspond to maintenance; fresh heartbeats confirmed recovery. No publication was triggered by these smoke checks.
- Timestamp popover customization from 9a15c56f is included. Physical iPhone appearance remains a user-device check, not claimed by server smoke tests.

The initial attempt failed creating a Windows helper directory before any build or maintenance lease. The corrected helper was committed/pushed and the subsequent complete rollout succeeded.

Evidence is retained locally under `outputs/seerr352-rollout-20261114`: deploy.log, receipt.json, verified.json, verified-features.json, migration-preflight.json, rollback-preflight.json and after.json. Source, lockfile and rollout changes are pushed; this final receipt is committed separately. Runtime binaries, test caches and generated next-env.d.ts changes are excluded from Git.
