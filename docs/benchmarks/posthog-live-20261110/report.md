# Live Discovery analytics comparison — 2026-11-10

18 successful runs, six per explicit mode, live build 1J9J9K5Ye6fznmCFWON0p. Normal interactive owner login followed by headless Chrome, authentication held only in process memory. No backend toggle changes, deployment or app edits. Fresh browser context per run, browser cache disabled, service workers blocked, viewport 1470×1000, native CPU (no artificial throttle), actual live network. All six permutations of off/events/replay used, one per block. Existing server caches and normal production traffic were not controlled.

Per run: navigate to Discovery; wait for account menu and six movie/TV links; allow five seconds; identical four scrolls and two account-menu clicks, then three seconds settling. Chrome Performance and Network counters measured CPU and transferred bytes independently of app reports. PerformanceObserver measured FCP/LCP. Content-ready is the six-links condition, not completion of every row/poster. App telemetry posts were intercepted in the test browser to avoid mixing benchmark records into production performance logs. PostHog itself used real network delivery. Every mode check passed, all observed PostHog responses 200, no page JS errors. Replay recorder running only in replay; Off never loaded SDK.

| Median | Off | Events only | Events + replay |
|---|---:|---:|---:|
| First paint (FCP) | 1.64 s | 1.80 s | 1.99 s |
| Main content paint (LCP) | 6.34 s | 6.60 s | 6.97 s |
| Initial server response (TTFB) | 0.57 s | 0.73 s | 1.06 s |
| Six title links ready | 4.82 s | 4.95 s | 5.72 s |
| Links ready minus initial TTFB | 4.21 s | 4.15 s | 4.20 s |
| Main-thread CPU work, whole run | 1.30 s | 1.36 s | 1.72 s |
| Main-thread CPU during fixed interaction phase | 573 ms | 660 ms | 610 ms |
| PostHog transferred bytes | 0 | 120.2 KiB | 188.8 KiB |

CPU work is not added wall-clock waiting time. Median CPU was higher with replay (about 417 ms / 32% compared with the separate off median), but paired estimates remain uncertain. Six-pair bootstrap 95% intervals for median CPU delta: events +121 ms [-284,+747], replay +365 ms [-266,+853]. LCP paired median deltas: events +58 ms [-1844,+11952], replay +628 ms [-456,+8982]. Small-sample bootstrap intervals are descriptive and wide, not proof of equivalence or a precise causal estimate. Difference of medians and median of paired differences are distinct statistics.

Events and replay had large single-run paint outliers (26.88 s and 24.16 s respectively). Different initial server response times already precede PostHog startup; post-response link readiness medians are similar. This test therefore does not isolate a consistent page-load penalty attributable to PostHog, nor establish zero/negligible overhead. Replay showed higher median overall CPU and a clear extra download cost. Fixed-phase interaction CPU varied and does not establish an input-latency/INP regression. Long-task observer output was zero in all runs and should not be interpreted as proof of no interaction jank.

Desktop Chrome only; no inference about iPhone/low-end devices. Existing source/privacy behavior unchanged. Raw browser results and harness retained in workspace outputs/posthog-controlled-20261110; sanitized runs.csv and summary.json retained here. No passwords, authentication cookies or browser storage state were written to those artifacts. A proposed direct session reuse was rejected before execution; normal login was used instead. No Git push performed.
