# Watchlist descriptions removed — 2026-11-04

User requested removal of descriptions for Plex and Letterboxd watchlists, deployment, then100-title concurrency benchmarks.

Shared virtual-watchlist API helper now returns an empty description for both sources. List cards already omit empty descriptions; detail pages now omit the empty paragraph too, avoiding blank description spacing. Other lists retain their descriptions.

Validation:14 existing route tests passed, including both virtual watchlists having empty descriptions; server/client TypeScript and scoped lint passed. Released only server/routes/discoveryLists.ts and src/components/Discover/ListLibrary.tsx from implementation85f8c45acb010aa4b57cf2e820e0234b9b9ebb58.

Live build:T0OFnmdW2SldlD1rCsYZ4. Previous moKy4UU8ntkn_SPxP3ica retained at C:/ProgramData/Seerr/catalogue-20261104151401864-5372-release. Build launched once and awaited process completion without build/status/log polling. Build, migrations, public health and all six linked users' settings/account-mapping checks passed. GET-only post-release checks confirmed both watchlist cards and both full list responses have empty descriptions; both source hashes match. Initial runtime-results read was still warming; not claimed as a completed sort measurement. No concurrency or user-toggle changes.

100-title benchmarks start only after this deployment and live verification. Results are documented separately.
