# List controls and score-cache follow-up — 2026-11-04

**Deployed after explicit user authorization on 2026-11-04.** Build `moKy4UU8ntkn_SPxP3ica`, implementation checkpoint `f39cf4d683f94d66a2f80226f194a7b3ec66ea80`. Previous build `-44OS71K1cO069TNYOSKQ` is retained for rollback. See deployment receipt below.

## Requested scope

- Fix the same-sort loading bug. SWR Infinite's periodic revalidation had skipped its cached first page because revalidateFirstPage:false was retained from pagination optimization. Metadata waits now query an authenticated, owner-and-preview-scoped progress ticket every5seconds while visible/online. The status endpoint only scans cached values and returns checked/total/unavailable counts; it does not assemble discovery data, fetch metadata, sort, or read/write cache files. Once ready, explicit per-page mutate fetches final results once. Unknown/expired tickets (including after restart) recover through the normal authorized list endpoint. Tickets expire after30minutes and are bounded to128 snapshots. Pending watchlist matching retains its existing full-page refresh, suppressed while metadata progress is pending. It stops once all pages are ready, on error (normal SWR error handling applies), or after unmount. Ready first pages are not refetched merely to append pagination. Highest/lowest continue sharing score-cache entries.
- Successful list-sort ratings cache seven days; runtime caches30days. Failed/missing refreshes keep a previous known value and use15minute retry timing. The underlying Letterboxd fetch cache tracks successful verification time so its stale fallback cannot masquerade as a fresh verification and renew the list cache for seven more days. Existing persisted entries keep their original expiration until refreshed successfully. No destructive cache migration.
- Limited-time recommendations include listRuntime from the runtime already fetched to enforce the time limit. No second metadata call, no changes to candidate order or pagination; existing poster badge renders the duration.
- Accessible funnel-button popover aligned right of Available/Unwatched. Radio choices cover original order, rating ascending/descending and runtime ascending/descending. Selection closes the panel; Escape supported.
- My lists categories now include Watchlists and Lists (in that order) (All still includes both). Watchlists-only does not fetch ordinary lists; Lists does not mount the watchlist reader. Removed the extra Watchlists section heading. Existing saved/created/liked categories remain ordinary-list filters.

## Explicitly deferred

Do NOT implement partial lists shown while sorting metadata is collected, followed by an automatic reorder. User raised the risk of content jumping while scrolled and explicitly deferred that behavior. Unknown first-sort metadata still has a loading state until ready. Cache-duration/failure improvements do not authorize introducing a new reorder behavior.

## Load characteristics

Metadata acquisition is asynchronous network I/O with a shared maximum of two list-metadata workers. Queued work continues after leaving the page; workers stop when their queue drains. There is no permanent rating-scan interval. Pending queues are in memory; only persisted values survive process restart. Ratings use the catalogue process and share CPU/network/disk with other features, so this is not an isolated worker. HTML parsing, sorting and JSON persistence are synchronous CPU/file work. Cache writes are batched every25 completions and on queue drain. Metadata UI checks now use the lightweight sort-progress endpoint; full discovery-data assembly happens initially and when fetching completed results. Progress counts failures as checked and reports unavailable values separately; unavailable values remain last. No metadata acquisition is triggered by progress reads. Lookups remain on-demand when a metadata sort is chosen, never on every imported list. No claim of negligible total production overhead.

Local warmed sorting-only benchmark (actual sortedList implementation, cached fixture,200iterations; no network or HTTP/discovery-data projection):50items median0.039ms/p950.058ms;250items0.345/0.395ms;1000items1.663/1.828ms. These are local CPU costs and must not be presented as live API latency. Initial rating acquisition remains the dominant waiting component for a cold list, but its system-wide CPU impact was not profiled here.

## Verification

29focused tests passed: private progress snapshots, owner/preview isolation, expiry/eviction/restart, actual progress-route access/schema and no discovery/watchlist assembly, 30-day runtime TTL, ordering, seven-day TTL, preserve-zero/known-score on failure, fresh-versus-stale upstream cache, duration-decoration without extra calls, and actual OpenAPI list routes. Server/client TypeScript and focused lint passed. Actual list-page components in isolated browser fixtures at390/1440px passed: wait on the same highest-first selection while only progress requests repeat, display checked counts without intermediate posters, fetch final results once, stop subsequent checks, expired-ticket recovery with exactly one final list fetch (both widths), hidden-tab suppression (390px), funnel alignment/radio selection/Escape, Watchlists/Lists filtering, no redundant heading, limited-time runtime badge, no JS errors or horizontal overflow. Fixture APIs/poster/modal boundaries are mocked; not claimed as live-browser verification. Temporary fixture retained outside repository at /tmp/list-controls-20261104/harness.

## Deployment receipt — 2026-11-04

Released only seven application files from the tested scoped checkpoint. Build/deploy launched once and awaited process-exit notification, without build-status/log polling. Initial filesystem notification hit local EMFILE; switched to process-exit notification, without restarting the deployment. Build and migration/public health checks passed.

- Build: `moKy4UU8ntkn_SPxP3ica`
- Rollback artifacts: `C:/ProgramData/Seerr/catalogue-20261104135754812-1043-release`
- Previous build: `-44OS71K1cO069TNYOSKQ`
- All seven deployed source hashes match the release manifest.
- Existing six-user publishing settings and account mappings unchanged (deployment wrapper comparison); verification independently compares publishing settings to the pre-swap backup.
- GET-only live checks passed: list categories, both personal watchlist cards, progress-expiry response, authentication rejection, invalid ticket validation. Initial watchlist contents were still warming after restart. The subsequent read returned 11 titles in verified runtime order. A new cold progress ticket was not needed on this cached live list; pending-to-ready behavior and cross-user ticket isolation were verified in isolated tests.
- No unrelated dirty files, archived activity logging, or Git push included.
