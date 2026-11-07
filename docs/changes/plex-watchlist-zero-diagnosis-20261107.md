# Plex watchlist transient zero — diagnosis, 2026-11-07

Network journal updated with co-viewer timing: inclusive20min from prior stop to next start; same account/player, same movie or same-series episode; hour gap requires re-adding; every qualifying session resets window. Watch-party room membership is separate.

Plex My lists diagnosis: discoveryWatchlists.ts plexInterests keeps snapshots only in process memory. A new entry starts items=[]; background fetch begins and returns interests=[]/updating=true immediately. The watchlists route makes a normal list summary from this array; ListCard unconditionally renders progress.total and available, showing0 instead of a loading state. Once a completed snapshot exists it is retained during refresh. Process restart discards it. Successful fetch freshness60s; failure preserves any existing items, sets failed=true/pending=false with5min backoff.

MyWatchlists refreshes every5s only while updating=true. Failure on initial load thus leaves an empty card, unresolved warning, and no scheduled polling once no other watchlist is pending; later page reload/focus may request again but server backoff still applies. This is a confirmed code path, not proof a particular observed incident had an upstream failure. Fetches page through Plex and resolve metadata for each entry before replacing a complete snapshot.

Live read-only summary for prplmg returned200 in927ms: Plex12items/11available; Letterboxd125/22; updating=true, unresolved=false. Did not reproduce zero in this live request.

Recommended correction (not implemented): explicit per-list readiness/error/retry state; render loading rather than0 before first successful load, retain last successful snapshot across restart, and schedule a bounded retry/revalidation after the backoff. True empty lists should only show0 after a successful complete fetch. No production configuration or list membership changed; no deploy.
