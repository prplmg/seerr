# City of God watched-source audit — avellana, 2026-11-09

Read-only investigation. Catalogue user7 / avellana maps explicitly to Plex/Tautulli user859039965; movie TMDB598, catalogue media471, Plex rating key24010. No movie_review rows exist for this title. The stored letterboxd-playback-events event is source tautulli, user7, account evegrissel, row1386, reference1344, occurredAt1794204329000, watchedDate2026-11-09. It is not an imported Letterboxd review or party-playback record.

Live Tautulli get_history (ungrouped, rating_key24010) returned two avellana records on Android / Sala de estar:
- Row1344: started2026-11-08T01:50:36Z, stopped2026-11-08T04:17:39Z;37%, watched_status0.25,2867seconds playback.
- Row1386: started2026-11-08T16:09:32Z, stopped2026-11-09T06:05:29Z;98%, watched_status1,4830seconds playback, reference1344.

Grouped query confirms group_count2, row1386/reference1344,98% watched,7697seconds accumulated playback. Its date field is the resumed start,2026-11-08T16:09:32Z, while group start is the first session onNov7 local time. In America/Cancun those sessions began Nov7 20:50:36 and Nov8 11:09:32, and the final stopped timestamp is Nov9 01:05:29. This provides a likely explanation for not seeing a new row under today's history: the watch is grouped with earlier playback. Actual Tautulli UI filtering/timezone selection was not inspected. Wall-clock elapsed time is not playback duration.

Catalogue /social/movie/598 returned200 with historyAvailable=true/historyStale=false and avellana in watchers. No watched data, reviews, sync state or settings changed. An initial optional get_history_metadata call returned400 (unsupported argument); the two successful history queries and persisted event are the evidence, without depending on that call. Evidence in parent outputs/avellana-city-of-god-20261109/{audit.log,history-confirmed.log}.
