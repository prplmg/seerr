# Watching now roster overflow — local, pending deployment

User-approved behavior:1–3standalone viewers retain avatar/name rows;4+switch to horizontal avatar-only layout. ResizeObserver measures available width and overflow button, preserving all faces that fit; +N opens a portaled accessible names/profile-picture popover. Party pills use the same bounded roster in list cards while keeping group/own-party styling and YouTube actions. Detail rosters unchanged.

WatchingCard height152px mobile/200px desktop. The roster area can scroll for multiple groups without displacing playback controls or growing the card. No server/API/sync-setting changes.5focused tests, client TypeScript, formatting and ESLint passed (existing image warnings only).

Actual components bundled with mocked media/activity and image fixtures, verified in browser at320/375/1280px. Six scenarios:3/4/12standalone viewers,12-person party, own-party plus mixed groups, and mixed groups. All mobile cards152high/288wide; all desktop200high/384wide, no card horizontal overflow. +N click exposed the correct hidden people; Escape closed it. Temporary viewport override reset. Screenshot: workspace outputs/watching-card-20261106/desktop.png. Fixture people/media only; no production playback interaction. Preview at http://127.0.0.1:8767/ while local server remains running.

Not deployed. Preserve unrelated next-env.d.ts; no remote push.
