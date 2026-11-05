# Compact reaction pickers — pending deployment

Quick reactions now open as an anchored, slim floating popover from Discovery reviews, detail reviews and comments. No card-height changes. Six defaults plus up to six distinct personal recent emojis scroll horizontally; the full-picker button stays fixed. Dialog portal avoids carousel clipping, repositions within the visual viewport, and supports Escape/outside dismissal and focus management.

Full picker uses a compact panel, search, scrollable category icons, selected-reaction highlighting, back and close controls. Full emoji data remains lazy-loaded. Reactions stay local; no backend/schema/notification changes.

Validation: full TypeScript check and focused ESLint passed. Actual components with mock API data passed Chrome at 320, 390 and 1280px: stable review dimensions, viewport containment, quick/recent scrolling, Escape and outside dismissal, expand/back/search, review and comment reaction writes, and no runtime errors or horizontal page overflow. Native iPhone Safari not tested. Preview harness remains outside application commits in seerr-social/interactions-preview/test-slim-picker.cjs.

Not deployed. No settings changed.
