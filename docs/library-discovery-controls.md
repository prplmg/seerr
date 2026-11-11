# Library discovery controls — 2026-11-10 (local)

Recently Added now links to Find something to watch with a lilac lightbulb. Removed its broad random picker and the For you header lightbulb. For you sliders hide arrow controls while retaining swipe/scroll.

Find something to watch defaults to all available movies and series, including watched titles, ordered by actual mediaAddedAt descending. Selecting a type narrows the pool; clicking it again restores both. Existing unwatched/people filters remain available. Sort and people controls sit alongside the availability subtitle. Library sorting excludes Best match. AI Search retains Best match and gains Recently added, with unknown library dates last. Backend and OpenAPI both accept the new field and library allTypes flag.

Pick for me appears above filters on both pages. AI picks among its current filtered shortlist; library picks a random index across the complete matching result count and loads that page. Normal library browsing still uses infinite scroll. Default added-only ordering happens before metadata pagination and does not force a full-library metadata scan.

Validation: TypeScript; focused lint; 9 sort/library tests including mixed-type recent ordering; HTTP contract regression; local Chrome mobile390/desktop1280 checks for deselection/default sort/no Best match. Fresh fixture screenshots in outputs/library-refresh-20261110. No deployment or cache policy changes.

Recently added sort now displays its full text plus direction arrow instead of a calendar, including on initial load. Fresh mobile/desktop previews: outputs/library-recent-label-20261110. TypeScript and browser checks passed.

Label refinement: full Recently added text is restricted to the library finder with a single sort. AI Search and multi-sort combinations retain compact icons; accessible labels still name the complete order. TypeScript and focused lint passed.

2026-11-10 local icon refinement: Recently added uses the existing Multimeldia app mark inside a20px circular lilac-outline badge. Finder's single added sort keeps text; AI/multiple-sort compact controls use badge plus direction. No new asset/download endpoint; reuses apple-touch-icon.png. TypeScript and real-component Chrome fixture checks passed; fresh previews outputs/library-logo-badge-20261110. Not deployed.

2026-11-10 replacement preview: outlined Multimeldia mark with top-right plus, currentColor lilac, transparent SVG and no circular badge. Original mark geometry reused with fine outline for small gaps. New files outputs/library-outline-plus-20261110 include icon-drawing.png and mobile/default/compact screenshots; previous preview directory untouched. TypeScript/browser fixture checks passed. Local only.

2026-11-10 local icon revision: lower play/pause shapes filled currentColor to match lilac outline; upper M stays outlined. Fresh previews outputs/library-filled-bottom-20261110, prior files unchanged. Not deployed.

2026-11-10 local refinement: filled lower play/pause shapes explicitly stroke=none to avoid overlapping upper outline. Fresh previews outputs/library-fill-only-20261110; not deployed.
