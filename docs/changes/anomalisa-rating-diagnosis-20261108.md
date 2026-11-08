# Anomalisa missing detail score — read-only diagnosis

TMDB291270. Initial live /movie/291270/letterboxd returned rating:null; persistent list-sort cache already contained3.83. Fresh Mini requests to /tmdb/291270/ and /film/anomalisa/ returned200 and parsed3.83 with correct TMDB identity. No imported Letterboxd review URLs existed for this title, so no conflicting review-derived mapping was involved.

Later live detail request returned3.83 in693ms, while a separate exact /tmdb/291270 request returned403. Evidence supports intermittent upstream rejection plus negative caching; the precise original failed response is unavailable because lookup catches errors without diagnostics. Code caches transport failures5minutes, successful scores24hours in process; list-sort has a separate persisted7daycache not consulted by detail. Detail SWR does not revalidate on window focus. Refreshing the page should now show the recovered score. No code/cache deletion/review/sync toggle changes made.

Potential follow-up: use shared last-known score for detail fallback and distinguish temporary lookup failure from genuine absence; retain useful diagnostics. Evidence outputs/anomalisa-rating-20261108/check.log and mapping.log. The latter command exits1 for the intentionally observed external403 after reporting successful live endpoint recovery.
