# Mini boot recovery installed — 2026-11-04

Installed Windows task `Mini Network Boot Recovery` on Mini. SYSTEM, highest privileges, no interactive login required; startup trigger delayed one minute, StartWhenAvailable, IgnoreNew multiple-instance policy, 12-minute task limit. Uses C:/ProgramData/Seerr/node/node.exe with C:/ProgramData/MiniRecovery/boot-recovery.cjs. Script SHA256 9b6ffa44bf1a4c4c41885c8c42845a430e6b325c801152e55a60c18b623586a5.

The script checks AdGuardHome and Tailscale in parallel. Starts only STOPPED services via the Windows service manager; never starts independent application processes, stops/restarts a running service, or forces a pending service to stop. Initial check plus retries after15/30/60/120 seconds, five rounds maximum, finite per-command timeouts and a ten-minute loop budget. Duplicate task prevention plus process/boot-aware lock. A running-but-unready service produces an unresolved result rather than disruptive restart.

Readiness: direct DNS queries to127.0.0.1 for example.com and expected torrent.prpl.com.mx rewrite100.87.16.107. Tailscale BackendState Running, self Online and successful ping to Caddy peer100.87.16.107. Caddy startup delay can therefore prolong readiness without causing a service restart. No Catalogue, torrent content, Plex, emails or other service mutations.

Protected directory ACLs: SYSTEM/Administrators full, Users read/execute, inherited permissions disabled. Local recovery.jsonl rotates at1MB with four archives; last-result.json records timestamp/result. Exit0 healthy, exit1 unresolved. This is boot-only recovery, not ongoing health monitoring.

Existing service settings preserved. Tailscale already has native crash-restart backoff (1–64 seconds); AdGuard has no native failure actions. This task specifically handles a stopped service after boot, which existing Tailscale native crash recovery did not repair. AdGuard native crash recovery remains a separate todo; no global ServicesPipeTimeout or startup priorities changed.

Validation: six simulated tests passed: healthy services untouched, stopped service retry, pending startup, exhausted attempts, running-but-unreachable, duplicate/prior-boot locks. Real installed task manually triggered under SYSTEM at02:43:03 Merida; both readiness checks passed on round0 and completed02:43:04, LastTaskResult0, no missed runs. No service start action was needed, no reboot or playback/download interruption. Actual cold-boot behavior awaits the next natural boot.

Rollback: disable or unregister only `Mini Network Boot Recovery`; preserve C:/ProgramData/MiniRecovery logs for diagnosis. Services' original auto-start/failure settings require no restoration because they were unchanged.

## Deferred Network todos

- [ ] Native prpl-pc checker for LAN vs Tailscale reachability and DNS readiness.
- [ ] Check public/private torrent URL through Caddy.
- [ ] Validate real Catalogue rows, response schemas and poster downloads.
- [ ] Verify bounded Plex media reads from both Movies and TV shares; distinguish from full client decoding tests.
- [ ] Optional Sonarr/Radarr/Jackett API health checks, without grabbing releases.
- [ ] SMTP2GO incident/recovery emails to existing admin recipient, persistent grouping/deduplication, boot grace and retry spool.
- [ ] External heartbeat proposal for whole-home outages/prpl-pc being off.
- [ ] Capture next natural boot's service/CPU/disk evidence to identify AdGuard/Tailscale startup delay; avoid claiming a proven root cause now.
- [ ] Evaluate AdGuard native crash-recovery policy separately, with bounded behavior.

The ten-minute review feature and notification persistence fix remain locally tested and undeployed. User recommendation: retain cached exact-session association; measured incremental lookup overhead is negligible, but whole-page browser overhead has not been measured. Avoid replacing exact-session matching with same-day/title guesses that could conflate rewatches.
