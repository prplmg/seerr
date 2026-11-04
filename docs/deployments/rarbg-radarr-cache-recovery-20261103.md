# Rarbg Radarr capability-cache recovery — 2026-11-03

The prior Jackett override successfully advertised movie-search q only, but Radarr continued sending imdbid searches at 18:54 Merida. Jackett rejected those as unsupported. Test/save had not refreshed Radarr's effective search capabilities, so the earlier successful indexer test was insufficient evidence of an operational Radarr movie search.

Verified Radarr had no started/queued commands, then restarted only its service. No media downloads were grabbed or changed. Indexer test returned 200. Interactive GET /api/v3/release?movieId=323&indexerId=4 returned 200 with 26 releases, all attributed to Rarbg, for Harry Potter and the Prisoner of Azkaban. Radarr logged processing 26 releases at 19:02:03 Merida. Subsequent health response no longer listed Rarbg; existing 1337x/YTS and update warnings remain. Requested CheckHealth refresh afterward. Unsupported child-category warnings are nonblocking; movie category 2000 remains usable.

Lesson: verify an actual movie search through the consuming application after capabilities changes, not only the indexer test and direct Jackett query. Radarr required a service restart in this case.

Boot-recovery automation remains deferred until user confirms both urgent issues. Proposed review grace window is 15 minutes before completion, scoped to a positively identified same-user/same-movie playback session. Save review immediately, delay diary creation while awaiting that session's watched event, retain ambiguity protection and explicit separate-viewing intent. This is a proposal, not implemented or deployed.
