# PostHog browser overhead — 2026-11-09

Status: isolated experiment only. No deployment or app integration. SDK 1.447.7; source b99962a6. 144 sequential measured visits and 9 four-session groups (180 measured page visits), plus excluded warm-up/pilot visits.

Actual current review and title-browser UI with synthetic data, production React bundles; not full Discovery/For you/detail end-to-end measurements. See [method](method.md).

## Recommendation

Basic explicit event tracking looks viable, but it has measurable browser cost. Keep replay off initially and test deferred initialization in the actual app before deployment. This experiment does not establish zero overhead or production API performance.

Fresh-load paired mean increase to first controls was about60ms for events and62ms for replay. Main-thread work over loading plus six interactions increased113ms for events and362ms for replay on the4x-throttled browser. Cached-load results were noisier and are retained below.

## Targeted repeat of the noisy warm desktop condition

An additional18 measured visits repeated warm desktop reviews (six per mode), bringing total measured visits to198. All cache/event/receipt/snapshot/error assertions passed. This repeat did not reproduce the original5.6s click-to-frame outlier; maximum clicks were162ms off,161ms events,193ms replay. Paired mean render overhead was62ms events/68ms replay; additional main-thread work112ms/447ms. Median first controls:220ms off,285ms events,288ms replay. The split frame waits peaked at34–35ms in all modes.

The original warm group remains in the main tables, including its large tails. The repeat suggests instability in that condition, but does not prove the original delay was caused by host load, automation or PostHog. It would be misleading to claim either zero interaction overhead or a reproducible5.6-second PostHog stall. Host load averages were captured only in the follow-up, so they cannot establish the original cause.

## Paired overhead

Enabled minus off, mean milliseconds with exploratory bootstrap 95% interval. Main-thread work covers loading plus six open/close/scroll interactions. Both viewport sizes use 4x CPU throttling.

| Cache | Mode | First controls ready | FCP | Main-thread work | Click-to-frame | JS heap MiB |
|---|---|---:|---:|---:|---:|---:|
|cold|events|59.7 [57.9, 61.5]|58.5 [56.3, 60.7]|112.9 [103.8, 121.9]|1.2 [-0.2, 2.7]|0.7 [0.2, 1.3]|
|cold|replay|61.9 [59.9, 64.3]|61.3 [59.2, 63.7]|361.5 [343.7, 380.9]|5.8 [3.2, 8.4]|4.6 [3.7, 5.4]|
|warm|events|101.4 [60.8, 147.9]|101.7 [62.0, 147.0]|228.0 [111.5, 374.9]|9.3 [-0.0, 20.8]|1.8 [0.8, 2.7]|
|warm|replay|87.5 [66.8, 116.3]|68.0 [59.0, 77.7]|423.1 [320.5, 556.0]|193.3 [1.2, 574.7]|7.2 [6.1, 7.9]|

## Per-cell first-controls-ready medians

Milliseconds; six observations per cell. “Ready” is the two-frame control-rendering proxy described in the method, not complete API/image readiness.

| Viewport | Fixture | Cache | Off | Events | Replay |
|---|---|---|---:|---:|---:|
|390px|/reviews|cold|285.2|344.4|346.6|
|390px|/reviews|warm|210.9|267.4|271.8|
|390px|/find-to-watch|cold|244.7|305.0|305.2|
|390px|/find-to-watch|warm|166.8|226.8|262.9|
|1440px|/reviews|cold|287.4|347.1|349.6|
|1440px|/reviews|warm|256.9|611.3|326.9|
|1440px|/find-to-watch|cold|246.9|304.8|307.1|
|1440px|/find-to-watch|warm|172.5|236.5|244.6|

## Exploratory slow-end rendering

Empirical first-controls-ready p95 in milliseconds; only six samples per cell, so these are sample tails, not reliable population p95 estimates.

| Viewport | Fixture | Cache | Off p95 | Events p95 | Replay p95 |
|---|---|---|---:|---:|---:|
|390px|/reviews|cold|290.1|351.1|349.6|
|390px|/reviews|warm|217.9|271.6|347.9|
|390px|/find-to-watch|cold|247.5|311.4|318.6|
|390px|/find-to-watch|warm|181.0|234.6|304.6|
|1440px|/reviews|cold|291.0|351.0|359.0|
|1440px|/reviews|warm|512.8|743.8|772.7|
|1440px|/find-to-watch|cold|250.8|312.1|308.9|
|1440px|/find-to-watch|warm|177.5|267.4|273.5|

## Download, capture and persistence

| Mode | Cold total resource transfer KiB, median | Warm total resource transfer KiB, median | Captured JSON KiB/visit, median | Collector body KiB/visit, median | Persistence bytes, median |
|---|---:|---:|---:|---:|---:|
|off|130.2|0.3|0.0|0.0|2.0|
|events|251.3|1.3|19.2|19.4|1579.5|
|replay|319.1|1.6|131.2|131.2|1872.0|

Standard SDK gzip body:121,332 bytes (~118.5KiB); replay lazy recorder adds68,944 bytes (~67.3KiB). This uses the standard browser bundle, not a measured tree-shaken minimal import. Uploads are local short-window payloads, not estimates of real-cloud compression, long-session traffic or monthly billing. Browser persistence footprint does not measure physical disk writes.

## Four simultaneous sessions

Three groups per mode; exploratory browser-contention stress, not a Mini server capacity measurement. Group time includes fixed settling and automation.

| Mode | Group duration median ms | Sum of page main-thread work median ms |
|---|---:|---:|
|off|4737.2|2556.2|
|events|4714.9|2979.0|
|replay|4726.6|3948.7|

## Interpretation and limits

Use the paired intervals and raw results, not a single faster enabled sample. Small cell sizes cannot establish rare-tail behavior. A real-cloud installation adds CDN/ingestion conditions not present here. Mobile width and throttle are not iPhone Safari. Background app/API/database work, login identity wiring, ad blockers, offline retry behavior, total browser RSS and physical disk activity remain unmeasured. No events were sent to a real PostHog project.

Explicit events and replay are separate product decisions. If proceeding, prefer pageviews plus an allowlist of meaningful actions, with session replay/autocapture disabled initially, and load the tracker after the page becomes interactive. Deferred initialization is a proposed mitigation, not a measured variant in this run. Verify a real isolated app integration before treating these client-only results as production approval.

Sources for SDK configuration: [JavaScript configuration](https://posthog.com/docs/libraries/js/config), [session replay controls](https://posthog.com/docs/libraries/js/usage#session-replay). Full raw data, environment/bundle hashes, analysis and harness accompany this report.
