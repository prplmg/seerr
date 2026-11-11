# Library discovery controls — 2026-11-10 (local)

Recently Added now links to Find something to watch with a lilac lightbulb. Removed its broad random picker and the For you header lightbulb. For you sliders hide arrow controls while retaining swipe/scroll.

Find something to watch defaults to all available movies and series, including watched titles, ordered by actual mediaAddedAt descending. Selecting a type narrows the pool; clicking it again restores both. Existing unwatched/people filters remain available. Sort and people controls sit alongside the availability subtitle. Library sorting excludes Best match. AI Search retains Best match and gains Recently added, with unknown library dates last. Backend and OpenAPI both accept the new field and library allTypes flag.

Pick for me appears above filters on both pages. AI picks among its current filtered shortlist; library picks a random index across the complete matching result count and loads that page. Normal library browsing still uses infinite scroll. Default added-only ordering happens before metadata pagination and does not force a full-library metadata scan.

Validation: TypeScript; focused lint; 9 sort/library tests including mixed-type recent ordering; HTTP contract regression; local Chrome mobile390/desktop1280 checks for deselection/default sort/no Best match. Fresh fixture screenshots in outputs/library-refresh-20261110. No deployment or cache policy changes.
