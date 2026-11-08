# AI Search header shortcut — local only

Moved AI Search from the desktop sidebar and mobile More menu to a lilac sparkles link immediately right of the main search input, before the profile avatar. Shared layout makes it available on mobile and desktop. The link has a 44px target, AI Search accessible name/tooltip, keyboard focus ring and active-page highlight. Search flex containers can shrink on narrow screens.

Validation: client TypeScript, focused ESLint, Prettier and diff review. Existing Discover sparkles/menu links remain intact. No backend, API, credential or toggle changes; no deployment or push. Unrelated next-env.d.ts excluded. Pending alongside the active-filter/text-color fixes.
