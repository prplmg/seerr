# Watched-by disappearance — 2026-11-12

## Confirmed diagnosis
Nathan for You, TMDB58957/TVDB267002, catalogue media171: retained Nov11 database has Plex show6615; live record has24964, updated2026-11-12 05:38:05 UTC (Nov11 23:38:05 Merida). Tautulli retains71 playback rows on grandparent6615. Before repair, authenticated social/tv/58957 returned200, historyAvailable=true, empty watchers. The route searched only current ratingKey/ratingKey4k plus manually verified historyAliases. Scanner replacement/reset discarded the sole linkage to old playback history; watch rows were not deleted. Exact Plex reason for replacement (rescan/reimport/etc.) not established.

## Live repair
Verified stable identity against sole retained catalogue rollback database, not title similarity. Added6615 to existing social historyAliases['tv:58957'], preserving every other setting/toggle. Protected server-side preimage: C:/ProgramData/Seerr/weekly-repair-20261111/social-before-nathan.protected.json. No credentials copied to repo.
Post-check200/historyAvailable=true: six watchers restored (ykrn, misu, wampiro, dav, drackmarr, prplmg), including latest episode positions. Requesters unchanged. No new watch logs, Letterboxd writes, service restart or deployment.
Read-only comparison of all current movie/TV identities against retained backup found only Nathan changed in that interval; this does not audit older losses.

## Prevention, local only
New plex-history-keys.json persists prior already-associated Plex rating keys, keyed by Plex machineId and mediaType/TMDB identity. Standard and4K IDs deduplicated. Movie/TV scanner replacement, Media.resetServiceData and availability-removal clearing preserve old IDs before mutation. All existing social history consumers use retained keys alongside current IDs and explicit aliases. Current privacy mappings/opt-outs remain applied at serialization; no stored viewer cache or inferred title matching. Corrupt persistence fails rather than silently discarding history. Explicit media removal semantics unchanged.

Validation:4 new tests cover restart persistence, movie/TV/4K replacement and clearing, identity/server isolation, duplicate scans, corrupt-file preservation, and actual BaseScanner movie/TV update paths.6 existing Plex scanner regression tests passed. TypeScript check passed. No general prevention deployment yet; unrelated next-env.d.ts preserved. No Git push.
