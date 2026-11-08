# Detail score fallback and AI placeholder — local only

Movie/series detail score lookups now reuse the persisted list-sort last-known rating when their normal Letterboxd lookup returnsnull (including temporary failures and cached failures). Successful detail lookup wins. Cached values validated0–5, scoped by media type/TMDBid; absence staysnull. Fallback links use Letterboxd's TMDB redirect rather than guessing a slug. Last-known values may be older than their refresh deadline; serving fallback does not mark them fresh or change that deadline.

The existing list-cache loader is shared with a read-only getter. No queue/enqueue/network work or cache write is introduced by fallback; saved metadata loads once per process. Normal lookup retry/backoff remains. Upstream exceptions now log title ID/type/status/error code, not credentials/response bodies. No log on each cached miss. Does not solve Letterboxd's upstream403 itself or invent scores for titles with no previously saved value.

Four focused tests execute actual compiled modules with fixtures: persisted expired score survives detail miss, fresh preference, missing/invalid scores, movie/TV isolation, zero, no fallback requests/writes; actual403 path emits one diagnostic and cached retry still returns fallback. Client/server types and focused lint pass. Evidence outputs/lb-score-fallback-20261108/tests.log. No live data/toggle changes or deployment.

AI Search placeholder exactly: Adult stop motion movies from the 2010s, under two hours, with a Letterboxd score between 3.5 and 4.5

Notification previews regenerated from current components: enable banner, install banner and simplified instructions; Not now right-aligned. Evidence outputs/mobile-push-prompt-20261108. All pending notification changes remain undeployed. No push; unrelated next-env.d.ts excluded.
