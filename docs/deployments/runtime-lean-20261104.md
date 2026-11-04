# Lightweight runtime lookups — 2026-11-04

Implemented locally in commit `bbf9fb6ea81e054733ecfc79648fbc0697717961`, not deployed. Production build remains `T0OFnmdW2SldlD1rCsYZ4`. Both list runtime sorting and the For you limited-time filter use `getListMovie`, the existing base-only TMDB movie endpoint, instead of full movie details. Added runtime to its response type. No appended credits, videos, providers, release dates or trailer fallback. Concurrency remains two in application source and production; four was tested only in the isolated benchmark.

## 100-title results

Median collection time:

| Fetch | Workers | With browsing | Idle |
| --- | ---: | ---: | ---: |
| Full/current live | 2 | 9.87 s | 11.68 s |
| Full/current live | 4 | 9.41 s | 7.93 s |
| Lightweight | 2 | 9.94 s | 11.28 s |
| Lightweight | 4 | 6.24 s | 9.91 s |

With the lightweight fetch, four improves over two by 37.3% with browsing and 12.2% idle. The lightweight fetch alone at two produces no convincing collection-time improvement. Four/full was faster than four/lightweight in the idle medians; the latter includes a 13.00-second trial. The run-to-run overlap and small idle sample size prevent a universal claim that lighter means faster.

Cold metadata response bodies fell from about 1,120,796 bytes to 82,257 bytes (92.7% less), measured during idle runs without route probes. These are captured response-body bytes, not total network framing. The smaller payload is a clear benefit independent of uncertain timing gains.

All 24 trials returned identical duration values and sort order: 98 values, the same two unavailable TMDB IDs (590530 and 828247). There were exactly 48 captured HTTP errors, all their 404 responses; no captured 403/429. No scheduled jobs or production writes ran from the benchmark.

### Browsing alongside lightweight collection

| API | Median at 2 / 4 (ms) | Sample p95 at 2 / 4 (ms) | Samples at 2 / 4 |
| --- | ---: | ---: | ---: |
| Discovery | 38 / 40 | 55 / 70 | 28 / 18 |
| For you | 220 / 228 | 298 / 289 | 28 / 16 |
| Movie detail | 81 / 93 | 111 / 1077 | 26 / 15 |
| Series detail | 108 / 134 | 289 / 3313 | 25 / 15 |

Outliers remain: one 1.08-second movie response and one 3.31-second series response at four; a 2.30-second series response at two. Sample sizes are small and unequal, making tail estimates unstable. Cannot establish that concurrency caused the outliers or that the lighter fetch eliminates browsing risk. Four is a faster collection option with an unresolved tail-latency tradeoff; retain the current limit pending user decision rather than silently increasing it.

## Limited-time filter

Four alternating trials per fetch variant, 98 valid candidates, 90-minute maximum:

| Work | Full lookup | Lightweight | Reduction |
| --- | ---: | ---: | ---: |
| First cold batch | 7.97 s | 7.04 s | 11.7% |
| All candidates/pages | 11.54 s | 9.89 s | 14.3% |

Every page's results, runtime badges and continuation cursor were identical. The first batch is the existing algorithm's candidate scan, not browser render time or a promise of a full 20-result visible page. No filtering, pagination or lookup concurrency behavior changed. Already cached results should not get the same cold-lookup improvement.

## Method

Same fixed 100 movies as the preceding comparison, on an isolated snapshot of deployed build T0OFnmdW2SldlD1rCsYZ4. No production source change, no scheduler, query-only database, outbound GET/HEAD only. Tested full and base-only movie metadata at two and four workers. Four trials per combination with concurrent warmed Discovery, For you, movie-detail and series-detail API probes; two per combination without browsing. Fresh process and list-sort cache per trial. Run order alternates fetch variants and concurrency. Real upstream and host activity remain uncontrolled, so comparisons are evidence rather than proof of causality.

The separate limited-time test exercises the actual shortWatchPage algorithm at a 90-minute maximum using the same cohort minus the two consistently missing TMDB records. It traverses all pages of these 98 candidates, preserving cursor and result limits, four cold-process trials per fetch variant, alternating order. No change to its sequential lookup behavior. Timings exclude feed generation and browser rendering. Base-only and full details have separate TMDB cache keys; the test measures cold lookup work, not already cached routes.

Sorting preserves its existing 30-day runtime cache and failure backoff; base movie metadata retains its 12-hour shared cache. Existing full media-detail behavior is untouched. No automatic fallback to full details was introduced: missing runtime remains missing and transient errors retain existing handling.

## Verification and evidence

22 focused tests passed across runtime API contract, sorting/cache behavior, limited-time pagination and API routes. Server TypeScript and scoped ESLint passed. The route harness permits only the lightweight method; regression checks assert no full lookup/trailer fetch, preserved locale and cache TTL, errors, missing-value ordering and cache reuse.

Raw sorting results: `runtime-lean-100-results-20261104.json`; short-filter results: `runtime-lean-short-results-20261104.json`; summary: `runtime-lean-summary-20261104.json`. Harness and fixed cohort are under `tools/benchmarks/runtime-lean-*`. The isolated sorting harness switches only the copied compiled lookup call and worker limit; limited-time harness uses the actual deployed pagination function with either lookup callback. This matches the local source behavior but is not a new production build or browser end-to-end test.

Cleanup receipt: `runtime-lean-cleanup-20261104.json`. Production build/source, publishing settings/account mappings and live health verified; temporary D:/SeerrBenchmarks/runtime-lean-100-20261104 workspace and remote benchmark scripts removed. No deployment or remote Git push performed.
