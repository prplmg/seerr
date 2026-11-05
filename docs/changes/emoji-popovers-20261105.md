# Compact reaction pickers — deployed 2026-11-05

Quick reactions now open as an anchored, slim floating popover from Discovery reviews, detail reviews and comments. No card-height changes. Six defaults plus up to six distinct personal recent emojis scroll horizontally; the full-picker button stays fixed. Dialog portal avoids carousel clipping, repositions within the visual viewport, and supports Escape/outside dismissal and focus management.

Full picker uses a compact panel, search, scrollable category icons, selected-reaction highlighting, back and close controls. Full emoji data remains lazy-loaded. Reactions stay local; no backend/schema/notification changes.

Validation: full TypeScript check and focused ESLint passed. Actual components with mock API data passed Chrome at 320, 390 and 1280px: stable review dimensions, viewport containment, quick/recent scrolling, Escape and outside dismissal, expand/back/search, review and comment reaction writes, and no runtime errors or horizontal page overflow. Native iPhone Safari not tested. Preview harness remains outside application commits in seerr-social/interactions-preview/test-slim-picker.cjs.

Not deployed. No settings changed.

Who reacted now uses a compact centered panel with initial circles, individual name rows, a You marker, and an explicit removal button. Inline comment-drawer reaction names use grouped chips. Mock browser tests at all three widths verify opening the roster preserves your reaction and only the removal button removes it. Focused lint passed. Category highlight circles reduced and inset to avoid clipping.

Media-detail and episode reviews now share DiscoveryReviewFooter: slim reaction/comment controls at bottom right, alongside existing edit/external links where present. Episode-only footers remain right aligned without a link. Comment deep links open the shared drawer; author and episode context retained. TypeScript, focused lint, review-source tests (whitespace-tolerant assertion), and mobile/desktop footer/dialog preview checks passed. Still undeployed.

## Production verification

Deployed all six UI files through the PRPL-PC builder and canonical maintenance rollout. Build `nE-ZHijNfGJyjYh-21_m9`; source commit `cea0c117`. Release `catalogue-20261105082846084-47786`. Frozen install 1.587s; compilation 41.973s; 31 dependency junctions verified on Mini. Loopback login, JS chunks, compiled server and SQLite checks passed before maintenance. Branded maintenance page verified before switch, native API checks passed, publishing settings/account mappings unchanged, lease cleared, public login 200 with expected build, reaction summary/recent emoji endpoints 200. All six live source hashes match approved local files. Previous build retained in `C:/ProgramData/Seerr/catalogue-20261105082846084-47786-release/previous`. No build-status polling; waited for command completion. No remote Git push.

## Pending avatar correction

Who-reacted API now includes avatar URLs from the existing batched user query. Roster uses CachedImage profile pictures; initials appear only for missing/failed images. Applies to review and comment reactions. API contract covers populated avatars and missing users. Not deployed.
