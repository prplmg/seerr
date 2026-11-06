# List page titles and recent movie import audit — 2026-11-06

Local change, not deployed: add PageTitle to My Lists, Explore (including media scope), and list details in loading, success and error states. Existing PageTitle supplies the application suffix. Source harness, client TypeScript and focused ESLint passed.

Read-only production audit at approximately 15:12 America/Merida. Compared Radarr files imported in the last seven days with catalogue availability, checked relevant disk files and Plex metadata.

- Musk (2026), TMDB 1096228: first 720p import 03:50:01; upgraded to 1080p at 07:43:03. Current file exists (4,711,318,108 bytes), Plex key 23967, catalogue AVAILABLE. Times UTC−6.
- The Ritual (2017), TMDB 433808: imported 12:55:01, file exists (1,861,781,965 bytes), Plex key 23971 in enabled Movies library 23. Catalogue remains PROCESSING. Only mismatch among the recent Radarr imports checked.
- Plex metadata for The Ritual has no Guid array, despite its Plex identity and file being present. Catalogue logs repeatedly report `No Guid metadata for this title. Skipping` from 12:55 through 13:05. Recent scans run every minute but query only the last scan minus ten minutes, advance the watermark despite item failures, and stop revisiting this item. Full Plex scan scheduled 03:00, Radarr scan 04:00; neither guarantees missing Plex identifiers will resolve.
- Musk also had missing-Guid errors at initial import, although its catalogue state is now available. Do not infer its recovery mechanism from this evidence alone.
- Diarios de motocicleta / The Motorcycle Diaries: completed download awaiting manual import because Radarr reports movie title mismatch. La belle verte remains queued.

No library, request, torrent, publishing toggle or schedule was changed. Follow-up: refresh/repair The Ritual's Plex metadata then reconcile catalogue identity; consider durable bounded retries for failed scanner items instead of relying only on the ten-minute overlap. Review the title-mismatch download before any manual import.
