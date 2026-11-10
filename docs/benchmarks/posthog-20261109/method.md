# PostHog isolated browser benchmark — 2026-11-09

## Scope

No application integration, deployment, account/project configuration, production toggles or production data reads/writes. Real PostHog JS 1.447.7 downloaded into an output-only npm project, with a fake token and loopback-only collector. No analytics events or recordings sent to PostHog. Connected PostHog used solely for documentation lookup.

Current Multimeldia source b99962a6 supplies the actual MovieReviews and FindToWatch React UI, bundled/minified with production React. APIs/authentication are synthetic fixtures: 40 reviews and 120 repeated synthetic title results. Permissions, provider data and some secondary modal/image components are stubbed. This is a controlled client SDK experiment, NOT full Discovery/For you/movie/series end-to-end testing, a live API latency benchmark, or the old custom activity-store benchmark. The old isolated server snapshot no longer exists.

## Variants and workloads

- Off: no SDK downloaded or initialized.
- Events: real SDK, explicit pageview plus button actions; autocapture, replay, surveys, conversations, heatmaps, performance/error capture and rageclick disabled; no person profiles.
- Replay: same events plus active DOM session recording, text and inputs masked. Actual snapshot capture required for every measured replay visit.

SDK initializes through deferred script after HTML parsing. SDK JS and recorder are served locally with gzip/cache headers. Local ingestion acknowledges batches; records only endpoint and body size. The local config endpoint enables replay for the replay variant. Persistence uses localStorage+cookie. SDK test-only opt_out_useragent_filter prevents headless-browser bot suppression. Actions are observed in capture phase because popovers stop event bubbling. No form contents are included in explicit action events.

Six rounds per route/viewport/cache condition, rotating off/events/replay order. 390x844 and 1440x900 viewports, actual Chrome on Mac; BOTH use 4x CPU throttle and 40ms/20Mbps download/10Mbps upload emulation. Mobile width does not emulate iPhone Safari or mobile hardware. Fresh browser contexts define cold; warm primes the exact page/assets in the same context before measurement, waits for network idle before closing the priming page, and asserts every measured script has zero transfer bytes. Receipt IDs are appended only to ingestion URLs, never asset URLs. OS caches and upstream caches are not cold. Each measured visit is a full document load with a new SDK instance; internal SPA navigation would normally reuse the initialized instance, but actual SPA route transitions are not measured here. Six open/close interactions and alternating scrolls per measured visit, then a 1.3s settling interval. Local batching configured to 1 second for short test visits, rather than SDK's documented default 3 seconds.

Three four-session burst rounds per variant, mixed review/title pages. These share one Mac/browser and are browser-contention stress tests, not four devices hitting production or proof of Mini capacity.

## Measures and validity

First control-ready timestamp: a DOM mutation sees >3 buttons, then two animation frames. This is a reproducible rendering proxy, not complete-image/page-data readiness. Also record FCP/LCP, main-thread TaskDuration, JS heap, long tasks, controller-measured click-to-two-frames times, transferred resource bytes, localStorage/cookie footprint, captured event types/serialized sizes and per-run collector request sizes. Click timings include browser automation overhead and are not field INP. TaskDuration includes the artificial CPU throttle; it is not machine CPU utilization. Heap is not total browser RAM; no forced GC. Browser disk I/O is not measured; serialized persistence footprint is only a proxy, not physical writes.

Instrumentation is identical across variants except SDK before_send event-count/size verification (including JSON serialization), which adds small measurement work to enabled variants. Collector receipt accounting is isolated by a run UUID. SDK capture is checked, not inferred merely from init. Uncaught JS errors or failed resource responses invalidate visits. Failed pilots are excluded; they caught bot filtering and stopped click bubbling before measurement. The first warm batch was also excluded after transfer accounting exposed early priming closure and per-run IDs on recorder asset URLs; warm-only measurements were repeated after fixing both. Cold and fresh-context burst results remain valid because those asset requests were uncached by design.

Report per-group medians/p95, and paired enabled-minus-off mean deltas with deterministic 5,000-resample bootstrap intervals. Six samples per cell give weak tail estimates. Pooled paired differences across the four fixture/viewport cells are exploratory, not population confidence guarantees. No assertion that a negative difference means analytics speeds up the site.

## Reproduction / artifacts

Local harness: outputs/posthog-benchmark-20261109 under the shared workspace, including benchmark, fixture builders, exact npm lockfile and analyzer. npm dependencies are isolated there, not installed in Seerr. Saved evidence here will include results and summary after the run. The source fixtures borrow earlier layout-test mocks but rebuild the actual current components in production mode.

Documentation checked via PostHog connector:
- https://posthog.com/docs/libraries/js/config
- https://posthog.com/docs/references/posthog-js/types/PostHogConfig
- https://posthog.com/docs/libraries/js/usage#session-replay

These measurements do not verify cloud ingestion, a PostHog dashboard, login/user identity wiring, CDN/DNS latency, Safari, ad blockers, offline retries or production API concurrency. External downloads are blocked in the browser. SDK/collector failure resilience remains untested; successful local collector delivery does not establish retry behavior during an outage.

## Targeted follow-up

The corrected main warm batch contained a noisy desktop-review condition (including a replay click-to-frame outlier of 5.6s). A separate six-round, three-variant warm desktop review repeat uses the same UI, cache assertions and SDK configuration, adding split click/frame-wait timings and host load averages. It does not replace or remove the original main results. No claim of a proven cause for the original outlier.
