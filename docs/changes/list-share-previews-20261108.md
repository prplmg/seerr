# Public sharing previews for created lists

Implemented locally; not deployed. Share/Copy link now uses the canonical https://catalogue.prpl.com.mx/share/lists/{id}, independent of the browser's current origin.

A small server-rendered public landing page exposes only a public created list's name, creator, movie count and up to four poster images. Open Graph metadata references a 1200×630 PNG. Private lists show a generic Multimeldia title/thumbnail, with no creator, contents, count or name exposed. Deleted/unavailable lists return 404. Existing list APIs and full list pages retain login/access checks. Sharing grants no permissions.

The share routes reuse the existing session store: signed-in users are redirected to /lists/{id}, where normal permissions apply. Signed-out visitors receive a Sign in to view list action. Login and already-authenticated login redirects accept only a validated created-list detail return destination; external destinations and arbitrary routes are rejected. No new server or separate hosting.

Images use sharp (existing dependency), base TMDB movie metadata and fixed-host poster URLs. At most two distinct image generations run concurrently; duplicate work is coalesced and excess requests receive the generic thumbnail. Each job reads at most four posters. Image buffers are cached in a bounded 32-entry memory cache for one hour, keyed by list revision. Generic image is generated once. HTML requests do not fetch metadata. Image requests recheck current visibility after generation and reject if the list changed. HTTP responses use no-store; a previous publicly shared thumbnail may nevertheless persist in third-party chat caches, beyond our control.

Validation: three local route/domain tests passed (escaping, canonical host, safe login returns, public HTML/image, authenticated redirect, private metadata isolation, stale image URL privacy, deletion, caching, and visibility changes while rendering). Application/server typechecks and focused lint passed. Local Chrome verified actual generated HTML at mobile/desktop widths, login target, no mobile overflow and private-page content. Fresh artifacts in parent workspace outputs/list-share-preview-20261108-v2/: public/private landing screenshots, public/private PNGs and a clearly labelled illustrative WhatsApp-style card. Mock list uses Arrival and Moon. No real WhatsApp crawler or physical-device/native sharing test performed; verify after deployment.

No push, production writes, toggles or deployment. Other pending commits remain intact. next-env.d.ts excluded.
