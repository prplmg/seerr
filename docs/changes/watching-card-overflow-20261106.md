# Watching now roster layout

1–3 standalone viewers keep avatar/name rows; 4+ use wrapping avatar-only rows. Other parties wrap too. Cards containing your own party use a single-line roster with +N so playback controls retain their space. +N opens names/profile pictures for hidden viewers. Detail-page roster behavior is preserved.

Cards retain 152px mobile / 200px desktop height. Multiple groups can scroll inside the roster area independently of playback controls. No server/API or sync-setting changes.

Validation: five focused layout/roster tests and client TypeScript passed. Actual components with mock data were visually checked at 375px: 12 standalone viewers, another 12-member party, and your own 12-member party. Screenshot: workspace outputs/watching-card-20261106/wrapped-mobile.png. Earlier checks also covered 320px/1280px and overflow-popover interaction.

Scoped release manifest: outputs/watching-rollout-20261106/release.json. Exclude unrelated next-env.d.ts and all other pending work. No remote push authorized.
