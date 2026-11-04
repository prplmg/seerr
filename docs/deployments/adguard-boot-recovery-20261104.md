# AdGuard postboot recovery — 2026-11-04

Verified AdGuardHome STOPPED, local port3001 refused, direct DNS to100.118.63.67 timed out, network.prpl.com.mx returned502. Service is AUTO_START LocalSystem with no failure-retry actions. System event7009 at epoch1793746226854 records45000ms service-connect timeout during the prior reboot. Underlying startup delay not established.

Started existing AdGuardHome service, preserving configuration. Verified RUNNING, example.com direct DNS answers, torrent.prpl.com.mx direct DNS resolves100.87.16.107, HTTPS network UI302/login.html. No reboot and no automation installed. Recovery proposal should include both Tailscale and AdGuard readiness/retry; Tailscale alone does not recover a stopped DNS service.

Ten-minute viewing association remains proposed. Performance validation should compare identical isolated builds feature off/on, alternate runs, cover warm/cold review-open and save latency plus concurrent saves, and confirm no added Discovery/detail request calls. Prefer background-cached playback state, no synchronous Plex/Tautulli fetch per page. Test delayed/missing completion, unrelated movies and duplicate prevention separately. No performance measurements claimed yet.
