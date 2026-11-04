# TheRARBG title-search recovery, 2026-11-03

Mini Jackett v0.24.3003.0, indexer therarbg, selected site https://therarbg.to/.

The exact JSON endpoint for recent releases and title queries returned 200 with results. IMDb query tt0304141 redirected 302 to /imdb-detail/tt0304141/, an HTML page, even with format:json. Same result on therarbg.com. Installed upstream definition matched official master at inspection.

Applied override at C:/ProgramData/Jackett/cardigann/definitions/therarbg.yml, copied from installed Definitions/therarbg.yml with only movie-search capability changed from [q, imdbid] to [q]. Custom directory loads first. Original stock definition retained. Restarted only Jackett. Exact IMDb callers would still fail if they ignore capabilities; integrations should use q after refreshing caps. Revisit override when upstream repairs IMDb search.

Verified Torznab caps advertises q only. Latest search returned 50 items and title query Harry Potter and the Prisoner of Azkaban returned 27. Sonarr indexer 5 and Radarr indexer 4 both passed test (200), then re-saved identical existing settings (202) to refresh capabilities. All three enable flags true before saves. No grab requested. No full Radarr automatic movie search performed. IndexerStatus diagnostic path returned empty response, so no independent disabled-until verification.

Rollback by removing only this custom definition and restarting Jackett.

Deferred user request remains pending go-ahead: bounded Tailscale boot retry, real torrent URL/Catalogue rows+poster/Plex media reads from both shares, test without reboot, update Network docs.
