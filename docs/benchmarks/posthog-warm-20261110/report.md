# Warm browser-cache PostHog test — 2026-11-10

18 successful live Discovery measurements, six per mode, same six balanced order permutations and viewport 1470×1000 as the cold-cache comparison. Native desktop Chrome CPU; real production network/server. Three independent contexts, one per mode, primed by loading Discovery and performing the measured scroll sequence once; subsequent measured visits open new pages in their existing context. Cache enabled; service workers blocked. No Playwright request routing/interception (routing would disable HTTP cache). Normal sign-in, authentication in memory only. No backend settings changes or deployment. Metrics are read directly from Chrome, independent of the app collector. Warm test browser metric posts were not intercepted and may appear in the live logs; run timestamps identify this test window.

All 18 SDK/recorder responses were confirmed cache hits (events 6/6, replay 12/12). Script/CSS cache hits: off 779/789, events 791/798, replay 797/804. Every observed PostHog response was 200; all mode assertions passed. New document initialization still happens on each measured visit; this is not a measurement of resuming a still-running PWA or SPA navigation within one document.

| Median | Off | Events | Replay |
|---|---:|---:|---:|
| FCP | 0.45s | 0.50s | 0.79s |
| LCP | 2.89s | 3.21s | 3.92s |
| TTFB | 0.40s | 0.46s | 0.74s |
| Six title links ready | 2.18s | 2.67s | 3.02s |
| Links ready minus TTFB | 1.78s | 1.98s | 2.33s |
| Whole measured run main-thread CPU | 1.25s | 1.33s | 1.53s |
| Fixed interaction-phase main-thread CPU | 718ms | 677ms | 772ms |
| PostHog response transfer | 0 | 0.29KiB | 0.29KiB |

Response-transfer figures exclude request/upload payloads: cached SDK downloads do not mean analytics traffic is zero. CPU work is not additional wall-clock waiting time. Paired replay CPU median delta +192ms, descriptive six-pair bootstrap 95% interval [+23,+515]ms. Events CPU delta +99ms [-217,+235]. Replay LCP delta +860ms [-92,+4318]; events LCP +82ms [-492,+2490]. Replay links-ready after TTFB delta +481ms [+175,+1240], but subtracting initial TTFB does not control later API/image/network timing. Thus replay's extra CPU work is supported in this test; the precise causal loading penalty is not established. Do not describe replay as negligible or claim it adds exactly the 1.03s difference of separate LCP medians. Six observations per mode and desktop-only scope limit generalization. Cold and warm batches were at different times, not an interleaved cache experiment.

## Live cache lifetimes

Verified HTTP headers: versioned app JS and pinned PostHog SDK/recorder: public max-age=31536000 immutable (one year). PostHog project config: public max-age=300 (five minutes). Authenticated page document: private no-cache no-store max-age=0 must-revalidate. Observed optimized images: max-age=14400 (four hours); other images showed max-age=0 or 31919000, so there is no universal image TTL. API/server-side data caches are separate from these browser-file TTLs.

A cold browser cache is per browser/device and can result from first use, eviction, cleared/private storage, disabled cache or new asset URLs. A deploy invalidates changed asset URLs, not necessarily unchanged pinned PostHog files. A fresh app document executes cached JavaScript again; resuming a still-running document can reuse the initialized SDK. TTL is permitted freshness, not guaranteed storage residency. Server restarts/cold server caches are another independent case.

All global/user/sync toggles compared unchanged after test; only routine Plex lastScan metadata advanced. Raw browser evidence and harness retained in workspace outputs/posthog-warm-20261110. No auth state written to artifacts; no Git push.
