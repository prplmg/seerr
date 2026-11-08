# AI Search people popover

Local only; no deployment, API spend, push or live toggle changes.

Replaced the full-width “Watching with” disclosure below the input with the same UsersIcon used by Watch Together/mobile Users navigation, placed to the right of “What are you in the mood for?”. The lilac44px target opens a right-aligned, viewport-bounded Headless UI popover with a scrollable single-column people list. It uses existing avatars/fallbacks, loading/retry/empty handling, and selected checkboxes. A small badge counts selected other viewers; accessible name describes the selection. Self remains included; at most five additional viewers. Updated the watched-filter explanation to point to the icon.

Done, Escape and outside click close the popover, with keyboard focus restored by the existing Headless UI primitive. Opening/closing/selecting does not submit a search or call AI. Selection state, history restoration and submitted people IDs continue through the existing page state and API; backend untouched.

Validation: client typecheck, focused lint/format/diff checks pass. Actual-component browser checks with mocked data at320/390/1440px cover open/close, selected count, five-person limit and re-enabling after deselection, Escape focus restoration, outside click, Enter/Done, no early request, submitted selected IDs and no horizontal overflow. Screenshots in outputs/ai-search-people-popover-20261107 (mock users without avatar URLs use initials; production retains profile images). Existing unrelated next-env.d.ts preserved.
