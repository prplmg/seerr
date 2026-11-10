# Review footer, episode shortcut and AI example — pending deployment

Review actions use a nonwrapping Edit label, compact accessible green checkmark for Letterboxd synced status, or spinner for syncing. Labels remain available to assistive technology and as titles. Existing external Letterboxd links and interactions retained. Browser verified the actual MovieReviews component at320/375/390/1280px: single-line edit, no horizontal overflow, both status icons, edit opens rating form. Three existing source/footer tests pass.

Series Seasons heading now has Last watched SxxExx when the current user's existing social history identifies an episode in a visible season. Uses the same SWR key/deduplication as existing social badges and server latestEpisode data (including party-attributed watches); no new backend or Plex query path. Reuses reviewSeason/viewEpisode deep-link handling to open the season and scroll without opening the review modal or starting playback. Repeated clicks remount the selected season, including if manually collapsed. No shortcut for unknown episodes or hidden specials. Episode selection follows last watch timestamp, not highest episode number. This navigation was type/lint checked; live user interaction is not claimed before deployment.

AI Search selects a random initial example on client mount to avoid server/client hydration mismatch. Existing8second rotation and pause-on-focus/input/history behavior retained; typed/restored query untouched.

Client TypeScript and focused ESLint passed. No deployment, settings changes or Git push. Letterboxd's deployed migration/reviewed-diary association behavior consolidated separately in the Network journal; these UI changes do not change synchronization.

Deployed2026-11-09 (America/Merida) as -aO7yYScrUQYCzawZBkKF. Earlier pending statements superseded; see [release receipt](../deployments/review-ui-20261109/README.md).
