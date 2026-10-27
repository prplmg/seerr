# Operational follow-up, 2026-10-27

Radarr: 11 collections migrated from stale E:\Movies configuration to the
existing accessible M:\Movies root. Zero old collection roots remain; all
movie paths and monitoring/quality settings unchanged. No disk files touched.
Backup: C:/ProgramData/Seerr/radarr-collection-roots-before-1793144063735.json.
Unavailable indexers: Sonarr 1337x and Anime Tosho; Radarr 1337x.

Verity playback ended 06:52:38 Mérida, intent created 06:54:29. Read-only browser
observation succeeded immediately beforehand. Exact payload accepted by deployed
validation, but write ID absent from active worker DB. Catalogue marks dispatched
before durable client acknowledgement; subsequent claims block dispatched jobs.
This explains the stranded handoff but does not establish the original exception.
Relevant current logs are empty; health only retains latest cycle and exception
type. Much-later PC shutdown is not an established cause. No retry performed.

No application deployment or feature-toggle changes. Journal Network docs updated.
