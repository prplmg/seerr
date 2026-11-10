# Re-run the local experiment

Copy this directory to `outputs/posthog-benchmark-20261109` under the shared workspace (alongside `seerr-weekly-lists` and `koalasync-fork`). The sibling checkout supplies Playwright/esbuild; the application checkout supplies React/TypeScript/Tailwind and the current components. Install the exact isolated dependencies with `npm ci --ignore-scripts --no-audit --no-fund` inside the output folder. Do not install them in the app.

For Finder, copy `arrival.jpg` and `moon.jpg` from the existing `outputs/find-to-watch-20261108` layout fixture. These are fixed image assets; they are not included in this source receipt.

From the shared workspace run:

```sh
node outputs/posthog-benchmark-20261109/reviews/build.cjs
node outputs/posthog-benchmark-20261109/finder/build.cjs
PILOT=1 node outputs/posthog-benchmark-20261109/bench.cjs
node outputs/posthog-benchmark-20261109/bench.cjs
node outputs/posthog-benchmark-20261109/analyze.cjs
```

Use an isolated local Chrome session. Script binds only loopback and blocks remote HTTPS resource requests. No real token or account credentials are required. Pilot results are excluded from the measured results. `ROUNDS` defaults to six; three four-session burst groups per mode run after the sequential samples.

Read ../method.md before interpreting results. This fixture is intentionally not a full production server.
