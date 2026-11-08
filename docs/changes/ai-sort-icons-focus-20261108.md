# Sort control icons and opening focus — 2026-11-08

Local only, not deployed. Removed Popover.Panel `focus`, which moved focus to the first native select on opening, consistent with the reported iPhone picker appearing immediately. Opening now leaves the dropdown alone; keyboard Tab still enters the form. Escape and existing dismissal behavior retained.

Uses existing Heroicons outline StarIcon/ClockIcon/CalendarIcon for rating/runtime/year with ArrowUp/Down direction. Secondary order uses a dot separator. Best match retains its arrows and label. Accessible button name and hover title still describe the full order; native form choices retain their readable names.

Validation: focused ESLint and client TypeScript pass. Actual-component mocked Chrome checks verify opening does not focus a SELECT, keyboard Tab enters first select, single/compound icon counts and direction payload, no horizontal overflow or page errors. Native iOS picker behavior requires on-device confirmation after deployment. Fresh screenshots: outputs/ai-search-sorting-20261108/icon-sort-*-mobile-20261108.png. No backend changes, paid calls, toggles or production changes.
