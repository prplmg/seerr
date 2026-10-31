# Observation work lifecycle — October 30

Root cause: health maintenance independently retried historical failed observations, even after consumers no longer needed them. Playback consolidation excluded its event from the publication planner but did not finish its independent observation work. Old account/film failures also shared a retry budget with new work.

Changes: only active publication consumers request reads; monitor no longer creates retries. New requests retain owning playback event/review IDs. Verified owning publication retires its observations only with matching user/account/film/entry and publication creation after read request; all shared owners must complete. Explicitly consolidated playback with exact local fields, bound review receipt and verified diary receipt also retires its owned work. Retirement preserves original state/result, excludes claim/baseline/retry/health paths, survives restart and acknowledges late authenticated reports without reopening work. Later events have their own retry history. Unresolved failures remain alertable. No global notification suppression, no toggles changed.

Legacy iBoy ownerless checks: narrow backed-up migration validates user's recorded explicit consolidation, current local event link, exact remote identity and matching verified review fields, and absence of unresolved iBoy writes. Only checks at/before the consolidation timestamp, prplmg/iBoy and exact or film-wide non-create-new scope are retired. Old continuation snapshot removed. Original failed results retained, no remote writes. Migration runs with catalogue process confirmed stopped after full release state backup, eliminating cross-process file-update races. Recovery code in tools/recovery/retire-consolidated-iboy-20261030.cjs.

Validation: 83 focused tests passed; server typecheck passed. Covers shared-owner protection, identity mismatch, new events, genuine error alerts, no monitor retries, restart and late-result behavior, explicit consolidation field guards, existing playback and worker tests. Deployment underway; final identity and live checks follow.

Limitation: external network/browser failures can still happen and will still be reported. This fixes obsolete work being retried after resolution, not every possible external failure. Legacy failures without authoritative resolution evidence are not automatically discarded.

## Verified deployment

Live build yr8e5IFddSlMFFqQEd7We; rollback C:/ProgramData/Seerr/catalogue-20261031000821803-89029-release. Native build, migrations and public health passed. All six publishing settings/mappings unchanged. Migration retired942 iBoy verification records (not publications) without remote writes and removed obsolete continuation snapshot. Original states/results preserved in store and full pre-change state backup.

Read-only post-deploy verification:942 total iBoy checks,942 retired,0 active;0 current read health issues,0 unresolved writes; Focus remains verified. Twenty health scans on an in-memory copy of live state created0 requests. Independent unresolved synthetic read still produces alert. Source checkpoint89b62ac090148e62232d4d511a69f80d69e01f67. Activity logging excluded; no push.
