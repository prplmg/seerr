# Ten-minute early review association — 2026-11-04

Implemented locally, not deployed. Existing notification-persistence fix also remains pending deployment. No live toggles changed. Read-only Tautulli probes were authorized and no playback or publication was initiated.

## Behavior

The existing shared 30-second recent-playback importer also reads get_activity and includes active history rows. It joins exact session key, Plex user, rating key and machine identity, obtaining the real start time from history. Only playing movies with a valid position in their final ten minutes qualify. The cache is bounded to 100 candidates and expires after 65 seconds. Attribution, hidden users, linked-account publishing eligibility and blocked-media rules are retained.

The review form can default to Watching now · mark watched. Saving it explicitly creates a dated local review representing that viewing. This does not create a fake Plex/history completion. If actual completion never arrives, the explicit review/log remains. Undated or unrelated reviews retain existing behavior. Existing review edits retain their association.

A deterministic identity includes playback source, catalogue user, Plex user, media key, device and exact session start. Completed events retain that session identity. The normal playback publisher recognizes a session claimed by a local synced review and does not publish a second diary. A completion arriving between form opening and save is accepted using the session alias. Stale, unrelated, malformed, ambiguous, paused and out-of-window sessions are not automatically selected. A review associated before completion suppresses a second rating suggestion afterward. No same-day-only merging is introduced.

Scope limitations: active suggestions currently use the existing linked/publishing-enabled account intake and its privacy rules. Exact session identity is required; a resumed session with a changed identity remains subject to existing ambiguity protection. The 30-second refresh means the hint can appear up to one refresh after crossing the threshold. Cache failure makes the optional hint unavailable rather than blocking review forms.

## Validation and measurements

74 focused tests passed, covering early boundaries, exact attribution/session identity, stale and ambiguous hints, no fabricated completion, completion during save, duplicate suppression, publishing/continuation and notification regressions. Both server and application TypeScript checks passed.

Reproducible benchmark: bin/benchmark-early-review.cjs, with a sanitized read-only live fixture of 1,066 review records plus playback identities. Actual before/after reviewEntrySelection functions ran against an isolated SQLite fixture and real local files. Before source is ops/adguard-recovery-2026-11-04. Alternating order, 50 batches per version, 20 operations per batch, serial and eight-concurrent calls. Missing, empty, one-active and 100-candidate caches. Total 36,000 warm operations per version. Application-cold measurements recreate the module 20 times per scenario. OS file cache remains warm.

Serial warm medians in milliseconds:

| Cache | Before | After | Added |
|---|---:|---:|---:|
| Missing | 0.0403 | 0.0489 | 0.0086 |
| Empty | 0.0397 | 0.0510 | 0.0113 |
| One active | 0.0394 | 0.0492 | 0.0098 |
| 100 candidates | 0.0385 | 0.0681 | 0.0295 |

Application-cold median differences ranged approximately 0.012–0.043 ms. Raw results include batch-mean p95, CPU totals, logical file-read byte totals, concurrency and combined-process RSS. These are incremental lookup measurements, not complete browser page-load or save-request benchmarks. Database fixture is local; external metadata/network work was excluded. They do not establish physical disk cold-start, Mini whole-process CPU, or device-specific rendering performance. Discovery endpoints gain no new feature calls. The existing review GET/save association lookup gains the bounded file read.

Live read-only background measurement from Mini alternated 20 before/after pairs. Median existing history request 47.6 ms, history-plus-activity pair 41.1 ms; initial smaller run had the opposite ordering (about 50 vs 58 ms), so there is no reliable speedup or consistent increase in these samples. Definite overhead: one shared get_activity request per ~30 seconds, 7,957 additional response bytes in the one-active-movie sample (~0.26 KB/s). Requests run in the background, not from page handlers. Active-only failure does not prevent completed-history ingestion; the optional lookup returns no hint. Independent read-only inspection confirmed current Tautulli movie activity includes duration/view_offset and matches the include_activity history session.

The safe conclusion is a very small measured local lookup overhead and small additional background traffic. Full deployed page navigation has not been measured and is not claimed. Raw aggregate results are adjacent JSON files; no credentials or review text are committed.
