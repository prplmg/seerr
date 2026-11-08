# AI Search Letterboxd filtering and clearer History (local only)

Implemented after pending history/chip changes175d1d8d and2402e986. Not deployed; live buildosm4NYyfTiOr7rQigfiga and all integration toggles unchanged. No model/API-token spend in these tests, no Git push.

History now has a highlighted trigger and visually attached lilac panel labelled Search history. While open, it replaces the search form and results; closing restores both without submitting. Edited-history entries show saved constraint summaries. Actual component browser checks at320/390/1440px verified preserved drafts/results, no hidden form confusion and no horizontal overflow.

AI interpretation supports an optional minimum Letterboxd rating on0–5 scale. Maximum/range requests are explicitly unsupported rather than misinterpreted as minimums. Minimum can also be edited/cleared from the LB chip without another model request. Scores are verified locally, never invented by the model. Result badges show score and runtime together if applicable. Unknown/unavailable/timed-out scores cannot pass the threshold and are reported separately. Subjective searches remain bounded to their up-to16 suggestions; objective searches retain the existing up-to3pages/60candidate pool, returning up to20 matches after filtering. This is not exhaustive Letterboxd catalogue search.

Cheap catalogue/history/year/genre and runtime constraints run before scores. collectListRatings joins the exact existing listSort queue/cache: four slots overall, maximum four rating jobs/two runtime jobs, same-key coalescing and existing seven-day score retention. It does not create another four-worker pool in the app. Failed refresh retains last known score; expired null values wait for a retry. No new client progress polling: completion callbacks emit Checked N/total over the existing search response. Collection waits at most90seconds; then unchecked titles are excluded with a warning, while already queued shared jobs may finish/cache results. Browser stream deadline240seconds accommodates provider/metadata plus rating work. No cancel button added during loading.

## Measurements

Real read-only Letterboxd requests, isolated temporary caches/processes, popular-title sample; cold means both local score-cache layers empty, not Letterboxd's own CDN. No production cache/database/service modifications. One run per size/host, not a statistical benchmark or end-to-end AI-search latency measurement. Mini tests use the new queue function compiled in a temporary harness and existing installed rating client dependencies. Each reported cold run found all requested scores with HTTP200 and peak4 concurrent lookups.

| Host | Candidates | Cold score stage | Warm repeat | Warm requests |
| --- | ---: | ---: | ---: | ---: |
| Mac |20|3.723s|0.383ms|0|
| Mac |60|9.465s|0.467ms|0|
| Mini |20|2.682s|1.464ms|0|
| Mini |60|7.035s|2.342ms|0|

Eight of the20 and45 of the60 passed minimum4. Real searches may wait longer behind other queued work or on failures/unknown titles. No synthetic browsing-load experiment and no live paid-model interpretation test in this turn. Model/schema behavior covered with mocked provider/real OpenAPI middleware; production proxy stream delivery remains a deployment check.

16focused tests pass, covering rating validation/inclusion/unknown exclusion, cheap filtering before score lookup, shared four-slot cap with concurrent list/AI jobs, deduplication, warm-cache reuse, deadline/cache completion, existing people/privacy/history semantics, and stream parsing. Server/client typechecks and focused lint pass. Browser previews use mocked progress/results and test LB edits, streamed count, score/runtime badges, navigation restoration and no loading cancel action. Evidence and scripts outputs/ai-search-lb-20261107. Existing next-env.d.ts change excluded.
