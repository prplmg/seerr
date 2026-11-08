# Available-library finder and reactive people — 2026-11-08

Source `b5c574f5`; thirteen application/schema files explicitly scoped. Generated next-env.d.ts excluded. LIVE build `9xZ0eKYeK44oEc7Z6b_PM`, release `catalogue-20261108212656196-33583`.

Includes For You lightbulb shortcut; available-only movie/series browsing; shared people picker, filters and sorting; counted processing status; global filtering/sorting before paginated results; infinite scroll that preserves posters while loading and deduplicates appended batches. Old full-section URLs retained. AI Search now automatically reapplies watched filters when people change, ignores superseded responses, reuses the cached interpretation and respects removal of a name from the original prompt.

Default opening loads only its first page and starts no score scan. Explicit broad filters/sorts can require a cold-library metadata pass; two concurrent base-metadata reads and existing four-worker score queue, cached metadata, bounded private expiring jobs and lightweight progress. No AI usage in the finder. No settings/toggle changes.

14 isolated tests, client/server types and lint passed. Actual-component mocked browser checks covered automatic people additions/removals on both pages, processing status, infinite loading with posters retained, deduplication/end guard, and no pagination controls. Evidence/preview: outputs/find-to-watch-20261108. Rollout evidence: outputs/find-to-watch-rollout-20261108. One PRPL-PC maintenance-aware build, completion awaited without build progress/log/status polling. No Git push.


Verified rollout: one PRPL-PC build44.276s/install1.625s. Mini recreated/verified31dependency junctions; staged login/JS/server/SQLite passed. Branded maintenance page verified before stopping old PID6572 (first attempt successful). Native API/schema under lease passed; lease cleared/public health passed. Thirteen source hashes match; binding/publication toggle fingerprint unchanged. All18unique public chunks across finder and AI Search match deployed artifacts, including finder copy and automatic watched-filter updates.

Live read-only smoke test: default available/unwatched movie view returned20titles, total235, continuation1, unknown0. Every returned title's availability/blocklist flags checked in SQLite read-only. It performed only first-page metadata, no paid AI or library-wide score pass. Verification elapsed21.728s includes a deliberate20s wait; it is not a page-load benchmark.

Rollback previous `F3SA0DUSK47kqcaz7ENFt` at `C:/ProgramData/Seerr/catalogue-20261108212656196-33583-release/previous`, plus SQLite/state backups and source manifest. Canonical maintenance-aware rollback required. No retry/second build/toggle changes or Git push. Supersedes local-only finder note.
