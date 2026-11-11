# Catalogue sections after PRPL-PC reboot — November 11, 2026

Recovered automatically; user confirmed Lists/Releases work after refresh. No application deployment, service restart, toggle change, or Letterboxd resubmission performed. Pending Finder AI-notice copy change remains local.

Evidence (America/Merida): PC boot09:20:14; logon worker task started09:21:04 and is Running (267009 is running, not a failure). Existing browser launcher opened all six configured profiles on queued work. All six report extension0.2.50 and recent heartbeats (0–28s in samples); recent six export_scan jobs succeeded/complete. Server bindings enabled with no current issue and succeeded jobs. Historical retired instance heartbeat is not an active account. Old browser-launcher-health failure file is datedNov4, not evidence of a current failure.

Mini logs:09:21:02 Plex scan ECONNREFUSED100.72.204.19:32400;09:21:32 shared playback history ECONNREFUSED;09:22:03 and09:24:06 history refresh failed.09:28 and later Plex scans and catalogue-history refresh completed. No pending Plex import repairs in sampled scan logs.

Authenticated native endpoint checks for user1: status200; discovery-lists?filter=discover200 (~936ms); releases200 (~307ms); watchlists200 (~199ms). Earlier ordinary My Lists request also200. This verifies current recovery; exact earlier HTTP error response was not captured. Plex downtime is confirmed during reboot, but the precise causal chain for both unavailable UI messages is not proven. No browser/session credentials extracted.

Pre-reboot PC trouble and original browser alert cause remain unproven. Recent Windows event query returned no records but exit1 with suppressed errors, so this is not conclusive evidence of absence of OS errors.

Recommendations: keep existing logon worker/launcher and durable retries (they recovered successfully). Improve Lists/Releases transient error UX with explicit retry/recovery feedback; add sanitized server diagnostics for discovery failures before broad cache/invalidation changes. Do not expose stale private data as fallback or blindly retry uncertain writes. Current SWR already has default retries/focus recovery; do not claim retries are absent. Browser launcher is logon-triggered, not a pre-login service.

No Git push. Read-only diagnostic scripts are under outputs/catalogue-outage-20261111.
