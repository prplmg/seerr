# List controls and score-cache follow-up — 2026-11-04

**Local implementation only. Do not deploy without a new instruction.** Live remains -44OS71K1cO069TNYOSKQ (9887c1f5 source/receipt checkpoint). No production requests, settings changes or deployment in this task.

## Requested scope

- Fix the same-sort loading bug. SWR Infinite's periodic revalidation had skipped its cached first page because revalidateFirstPage:false was retained from pagination optimization. Explicit per-page mutate now refreshes only pending pages every5seconds while visible/online and not already validating. It stops once all pages are ready, on error (normal SWR error handling applies), or after unmount. Ready first pages are not refetched merely to append pagination. Highest/lowest continue sharing score-cache entries.
- Successful list-sort ratings cache seven days; runtime remains24hours. Failed/missing refreshes keep a previous known value and use15minute retry timing. The underlying Letterboxd fetch cache tracks successful verification time so its stale fallback cannot masquerade as a fresh verification and renew the list cache for seven more days. Existing persisted entries keep their original expiration until refreshed successfully. No destructive cache migration.
- Limited-time recommendations include listRuntime from the runtime already fetched to enforce the time limit. No second metadata call, no changes to candidate order or pagination; existing poster badge renders the duration.
- Accessible funnel-button popover aligned right of Available/Unwatched. Radio choices cover original order, rating ascending/descending and runtime ascending/descending. Selection closes the panel; Escape supported.
- My lists categories now include Watchlists and Other lists (All still includes both). Watchlists-only does not fetch ordinary lists; Other lists does not mount the watchlist reader. Removed the extra Watchlists section heading. Existing saved/created/liked categories remain ordinary-list filters.

## Explicitly deferred

Do NOT implement partial lists shown while sorting metadata is collected, followed by an automatic reorder. User raised the risk of content jumping while scrolled and explicitly deferred that behavior. Unknown first-sort metadata still has a loading state until ready. Cache-duration/failure improvements do not authorize introducing a new reorder behavior.

## Load characteristics

Metadata acquisition is asynchronous network I/O with a shared maximum of two list-metadata workers. Queued work continues after leaving the page; workers stop when their queue drains. There is no permanent rating-scan interval. Pending queues are in memory; only persisted values survive process restart. Ratings use the catalogue process and share CPU/network/disk with other features, so this is not an isolated worker. HTML parsing, sorting and JSON persistence are synchronous CPU/file work. Cache writes are batched every25 completions and on queue drain. UI checks request the full list endpoint, not a tiny job-status endpoint; they also do normal discovery-data assembly. No claim of negligible total production overhead.

Local warmed sorting-only benchmark (actual sortedList implementation, cached fixture,200iterations; no network or HTTP/discovery-data projection):50items median0.039ms/p950.058ms;250items0.345/0.395ms;1000items1.663/1.828ms. These are local CPU costs and must not be presented as live API latency. Initial rating acquisition remains the dominant waiting component for a cold list, but its system-wide CPU impact was not profiled here.

## Verification

26focused tests passed: ordering, seven-day TTL, preserve-zero/known-score on failure, fresh-versus-stale upstream cache, duration-decoration without extra calls, and actual OpenAPI list routes. Server/client TypeScript and focused lint passed. Actual list-page components in isolated browser fixtures at390/1440px passed: wait on the same highest-first selection until ready, stop subsequent checks, hidden-tab suppression (390px), funnel alignment/radio selection/Escape, Watchlists/Other list filtering, no redundant heading, limited-time runtime badge, no JS errors or horizontal overflow. Fixture APIs/poster/modal boundaries are mocked; not claimed as live-browser verification. Temporary fixture retained outside repository at /tmp/list-controls-20261104/harness.
