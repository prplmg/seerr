# Default catalogue builder

From the Mac run `node tools/build-host/deploy.cjs <scoped-manifest.json>` in seerr-fork. The existing seerr-social/deploy-catalogue.cjs entrypoint delegates here. The manifest contains an explicit files array relative to the catalogue source. Use one invocation and await its exit. The existing live Git snapshot and rollback procedure apply.

Mini owns the release lock, snapshots its source, overlays the reviewed changes and sends the allowlisted build input over native Windows SSH to PRPL-PC (MSI, port 2222). Each release carries its own helper directory on Mini. PRPL-PC keeps its portable Windows x64 Node 22.23.5, pnpm 10.24.0, frozen dependency store, working directory and tools under D:/CatalogueBuilder. The wrapper transfers PC helpers into the release job directory. Mini's release account must already trust and authenticate to the PC. No live DB, settings, .env, keys, or service credentials are build inputs. An unreachable builder fails the build; the current catalogue remains online.

Every build refreshes the working source, runs a frozen install, compiles both halves and exports .next and dist. Cache, traces and .next/node_modules are excluded. A per-release receipt binds the input digest, artifact digest, link manifest digest, tool versions and build ID. Mini checks the hashes, rebuilds every generated alias as a junction to the exact installed pnpm path after validating package name and version, and exercises the staged login page, JavaScript chunks, compiled list/review modules and native in-memory SQLite. Those checks run on loopback before the Caddy lease. Mini installs the frozen dependency graph into an isolated release runtime before preflight; do not bypass a preflight failure.

After preflight the release verifies Caddy's public maintenance page, stops Seerr, backs up state, switches the already-tested .next, dist, dependencies and launcher, starts the service, checks the direct APIs, clears the lease and verifies public health. Rollback uses the same expiring lease. Receipts and rollback files are kept under Mini's release directory; transfer archives are removed after preflight. D:/CatalogueBuilder/work is reused for subsequent builds. The trial helpers remain as the historical acceptance harness.

Shutdown/recovery hardening (2026-11-08): deploy.cjs ships a release-specific rollout-control.cjs. Shutdown uses up to three bounded attempts, exact executable/entrypoint selection, creation-time identity and actual process-exit checks, disposed handles, and a free-listener check. It logs process IDs/creation times/exit outcomes and listener owners on failure. It never kills an unrelated port owner. Before any artifact movement, recovery skips a repeated failing stop and starts/checks the intact old app, clears maintenance only after native health, then verifies public health. After artifact movement, a successful stop remains mandatory before restoring files. failed-attempt.json records both original and recovery errors; pre-swap backups are archived and empty swap directories removed only after recovery. Native API uses192.168.68.50:5055 (not localhost). No scheduler/publication settings are changed.

Retention (2026-11-10): after verified success, while holding the deployment lock, retention.cjs keeps exactly one rollback: the release matching the live BUILD_ID. Older verified releases retain only small receipts; payloads, source/state snapshots and successful staging copies are removed. Directory junctions are unlinked, never traversed. Failed/unverified releases are excluded pending explicit recovery review. Cleanup failure is reported separately from successful deployment. Standalone cleanup takes the same exclusive lock. Run `node --test tools/build-host/retention.test.cjs`. No application build is needed to install this deployment-tool change.

## 3.4.1 → 3.5.2 upgrade support (not deployed)

The scoped manifest now accepts `delete` alongside `files`. Include the merged
`package.json`, frozen `pnpm-lock.yaml`, `next.config.mjs`,
`server/tsconfig.build.json`, any native Node helper under `server`, and all other
reviewed application changes in `files`; put `next.config.ts` in `delete`.
Missing files are never inferred as deletions. The wrapper rejects an unresolved
Git merge before contacting Mini. Build inputs must contain exactly one Next
config after overlay/deletion. Templates, JavaScript/MJS/MTS server helpers and
root compiler/build configs are allowed explicitly; credentials remain excluded.

Each invocation ships its own helper scripts to Mini and PRPL-PC. PC still does
the application build using Windows x64 Node 22.23.5 / pnpm 10.24.0. It also exports
the pinned pnpm installer with a receipt digest. Before taking the maintenance
lease, Mini verifies the installer and installs the exact frozen dependency graph
in `C:/ProgramData/Seerr/catalogue-<id>-runtime`, never in the live application.
This install requires package registry access and native package installation
support on Mini. Lifecycle install scripts run, but application builds stay on
PRPL-PC. Mini must match the builder Node version and Windows x64 architecture.
The loopback preflight exercises both native `node:sqlite` and package `sqlite3`,
compiled custom modules, the login page and JavaScript chunks. The preflight
receipt binds the manifest, build and native Node version.

The existing Caddy lease, branded 503 check, shutdown, state backup, native API
checks, public health check and publication-toggle checks remain in place. The
switch now includes the `node_modules` junction with `.next` and `dist`; source
changes include deletions, and recovery restores all three plus original source.
Runtime paths stay stable while junctions move. Retention keeps exactly one
verified rollback and preserves the dependency targets of both live and rollback;
unreferenced runtimes from older verified releases are deleted. Failed/unverified
releases and runtimes are left for explicit recovery review.

Node provisioning is separate from deployment: stage the verified official Windows
x64 `node.exe` at `C:/ProgramData/Seerr/node-v22.23.5/node.exe` and
`D:/CatalogueBuilder/node-v22.23.5/node.exe`. Both hosts enforce version,
architecture and SHA-256
`247e9693d316da9857e44990e5e11709f596f18112251b8026ec6eed80bdf38a`.
Do not replace the running `node/node.exe`. The release controller also runs with
the staged 22.23.5 binary, so its HTTPS checks use the patched runtime before the
application switches. Under the existing lease, after a
verified stop, replace only the two executable literals (probe and normal startup)
in `tools/startup/Start-Seerr.ps1`. Its complete original bytes are retained in
`launcher.json`; the scheduled task, `run-seerr.cmd`, credential loading and
all environment/toggle settings stay unchanged. Recovery stops the new exact
executable, restores the original launcher, and starts the old application.

Migration rehearsal runs only on Mini, after the native runtime smoke and before
the lease. The online SQLite backup API creates an isolated DB copy in the release
directory; no DB/config data enters PC build input. A separate process sets an
isolated CONFIG_DIRECTORY, blocks network/subprocess/job scheduling, imports only
the compiled datasource (never server/index), disables subscribers and schema sync,
initializes and permits only these pending migrations (or none):
`DropPushSubscriptionAuthUnique1786619443939` and
`RemapOverseerrDeletedStatus1789257612345`. It mirrors startup's foreign_keys=OFF
around transaction-all migration execution, then re-enables and checks constraints.
It verifies both migration records, removal of auth-only uniqueness, all seven
custom entities, existing table row counts, protected/custom row digests, unchanged
copied config/toggles, integrity and foreign keys. Any unexpected pending migration
blocks the lease before execution.

A second isolated process runs the original executable and old datasource against
that same migrated copy. Schema sync, migration execution and subscribers stay off;
it reads/counts every old entity and checks old startup has no pending migrations.
Its receipt is bound to the old BUILD_ID and executable hash/version. This proves
read/schema compatibility, not every business write behavior. Current old code
already recognizes DELETED=7, and the other migration only relaxes auth uniqueness.
Both rehearsals must pass before taking the lease. The private copy is removed
only after both pass; failures retain it on Mini for diagnosis, never on PRPL-PC.

Rollback restores the application, dependencies and launcher while retaining the
current migrated main DB. It never rewinds to before.sqlite3: startup jobs and
public requests may have written since that snapshot. The snapshot remains available
for explicit recovery review only. Existing task-ledger recovery stays unchanged.

Read-only Mini measurements on 2026-11-14: 10,536,218,624 free bytes; dependencies
812,851,116 bytes; .next 55,189,191; dist 3,917,100; data 31,352,286. Node was
v22.23.2/x64 at inspection. New output sizes are unknown until build. The PC receipt
reports expanded artifact and dependency sizes; Mini requires two dependency
copies (install/store overhead), expanded artifacts, two data copies, and a 2 GiB
reserve before installation. It checks reserve again after rehearsal. This is a
conservative budget, not a guarantee against concurrent disk consumption.

Local validation: 16 fixture tests cover all six artifact rename failure boundaries,
source deletion/copy failure, scheduler-startup (including WAL/SHM), post-launch and post-public-open failures preserving new writes, exact launcher replacement,
input validation and live/rollback dependency retention. Tests run with
`node --test tools/build-host/{release-input,retention,runtime-policy,recovery-upgrade,deploy-package}.test.cjs`.
Syntax and whitespace checks passed. The complete authorized rollout was accepted on
2026-11-14: 947-file manifest plus next.config.ts deletion, PRPL-PC build, isolated
frozen Mini dependency install, native preflight, migration and old-runtime
compatibility rehearsals, maintenance switch, and native/public health all passed.
Build: 9VGv9iSIjm-FenLPLsfht; release: catalogue-20261114203211262-95172.
Existing toggles were unchanged and one rollback retained. See
`docs/upgrades/seerr-3.5.2-20261114.md` for the final receipt.
