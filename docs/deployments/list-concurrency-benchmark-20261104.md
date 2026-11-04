# Two versus four list metadata lookups — 2026-11-04

## Git push

Explicit user authorization. Non-force push advanced origin/prpl/custom from fd971dd5 to verified live checkpoint a5da3083; published live/catalogue-2026-11-04 and audit/mini-storage-2026-11-04. No unrelated dirty checkout edits were included.

## Method

Mini, deployed build moKy4UU8ntkn_SPxP3ica. Isolated copy of compiled server/API schema plus a read-only database backup and copied state, on D:; shared node_modules junction, no new build. No dist/index startup, scheduler registration, migrations or external mutations. SQLite query_only; outbound requests GET/HEAD only. Actual deployed listSort and Letterboxd/TMDB fetch implementations; the sole behavioral variable changed in the copied listSort module was active<2 versus active<4. Live compiled-source hash checked before/after.

Same12 known-rated movie IDs across24 trials,288 metadata resolution tasks; all288 returned values, all sampled API responses200, no captured upstream HTTP error responses, and rating values/order remained identical. Each trial used a fresh process and reset list-sort cache. Browsing mode warmed Discovery movies, For you recommendations, a movie detail and series detail API, then took three baseline rounds. During collection, round-robin probes ran serially with100ms between requests. Limits alternated2,4,4,2 then4,2,2,4 per metadata field (four runs per limit/field). Idle mode omitted API warmup/traffic, running2,4,4,2 (two runs per limit/field).

Important: browsing mode resets the list-sort cache but normal route warmup can warm underlying metadata/transport caches. Idle mode has no route warmup. Compare two/four *within* each mode; do not attribute differences between idle/browsing modes solely to CPU contention. OS/CDN caches and normal production activity on the shared host remain uncontrolled. These are API/server measurements, not full browser rendering/navigation measurements.

## Results — median time for12 titles

| Scenario | Two | Four | Reduction |
|---|---:|---:|---:|
| Scores, browsing warmed/active |3.863s|3.527s|8.7%|
| Runtime, browsing warmed/active |1.465s|1.133s|22.7%|
| Scores, idle/no route warmup |5.838s|3.980s|31.8%|
| Runtime, idle/no route warmup |4.835s|4.244s|12.2%|

Idle runtime was noisy: two ranged3.081–6.590s; four3.643–4.844s. That row does not establish a reliable speedup. Score timing with browsing also overlapped, so8.7% is a sample median difference, not a confidence bound.

During score collection, median concurrent API responses (two→four): Discovery46.8→57.4ms; For you225.7→246.5ms; movie68.6→67.5ms; series112.3→124.6ms. For you sample p95262→314ms, but samples are too small/unequal to infer stable tail latency. Runtime collection ended quickly with four; some routes lacked concurrent observations (zero series observations in that mode), so do not compare mixed-route medians or claim all routes were covered during every short window.

The instrumentation includes CPU totals, RSS samples and event-loop p95. CPU totals include the final outstanding probe after metadata completes; RSS is sampled by the browsing loop, so idle RSS is not a true peak. These are diagnostic context, not clean resource-cost comparisons. Four showed more event-loop bursts in browsing samples; no zero-overhead claim.

## Conclusion

Two was a conservative guardrail, not a proven optimum. Four is a reasonable candidate to improve first-time score sorting, particularly without concurrent browsing; observed typical API penalties were tens of milliseconds. It is not a guaranteed2x gain or a proven universally optimal limit. Larger lists, more users, upstream throttling and stable slow-end latency remain untested. Live remains two: this request authorized testing, not deployment of a concurrency change.

Raw and summarized evidence are adjacent JSON files. Reproduction harness: tools/benchmarks/list-concurrency.cjs; initial run, resume, resume-idle modes correspond to the three passes. Temporary copied state and worker scripts are removed after extracting evidence; node_modules target must never be deleted.
