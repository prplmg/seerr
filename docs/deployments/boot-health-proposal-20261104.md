# Boot recovery and health-email proposal — 2026-11-04

Proposal only. No automation, startup order, service recovery settings, logging settings or timeout registry values changed. No reboot performed or requested for validation.

## What happened to AdGuard

AdGuardHome and Tailscale hit Windows Service Control Manager 7009 45-second startup-handshake timeouts after the forced power-off. Recorded events were only 1.6 seconds apart. AdGuard remained stopped despite AUTO_START. No service-failure retry actions were configured. Starting it later worked immediately; direct DNS and its web interface then passed.

No AdGuard crash/application error was found in the inspected boot window. AdGuard v0.107.79 has log.file empty and verbose false. No custom ServicesPipeTimeout registry value was present. The queried Diagnostics-Performance window returned no usable records. The exact reason the services missed startup remains unproven. Concurrent failures suggest shared boot contention or readiness delay, but do not identify a disk/CPU/driver cause. Hyper-V initialization events with IDs 7/129/153 must not be mislabeled as disk errors.

Root-focused approach: keep DNS early; collect bounded service-event/CPU/disk diagnostics during the next natural boot and persist application startup diagnostics. Identify/stagger heavy startup tasks if measurements show contention. Avoid inventing dependencies or delaying DNS blindly. Microsoft documents extending ServicesPipeTimeout as a workaround; it is global and not proof of an underlying fix, so do not change it now. Source: https://learn.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/service-not-start-events-7000-7011-time-out-error

## Proposed recovery on Mini

A SYSTEM boot task, independent of login, checks both AdGuard and Tailscale. Start a stopped service, allow bounded readiness time, then retry at increasing intervals (15, 30, 60, 120 seconds), with one task instance and a fixed attempt cap. Never launch a duplicate application process, restart healthy services, terminate downloads, or reboot automatically. Service running status must be followed by readiness checks: DNS answers for AdGuard, Tailscale connected state and peer reachability for Tailscale. Keep local logs even when DNS or network is unavailable. Configure native service recovery for genuine crashes as a complementary mechanism; verify how startup failures behave rather than assuming crash-recovery covers them.

## Broader checker

Run on native prpl-pc, independent of Catalogue/Seerr and interactive login. Caddy is a Mini-hosted VM and cannot be the sole Mini-down detector. Check at boot and every minute during recovery, then network checks every minute and application/media checks every five minutes.

| Check | Evidence |
|---|---|
| Mini reachability | LAN and Tailscale paths separately, distinguishing host versus tunnel outage |
| AdGuard | Direct public-domain DNS and expected private-host rewrite through Mini |
| Torrent URL | HTTPS torrent.prpl.com.mx expected qBittorrent response, distinguish login from proxy failure |
| Catalogue | Authenticated representative Discovery/For you response schemas and a real poster download, not only homepage200 |
| Plex | Identity/library API plus bounded media reads through both Movies and TV shares, using Plex's actual serving context |
| Import services | Sonarr/Radarr API availability; optionally Jackett connection health without searches/grabs |

Use small media ranges and cached representative files. This verifies media accessibility, not Apple TV decoding or a user's full playback experience. Do not start streams, background analysis or library scans. Legitimately empty personalized rows are healthy; validate response schemas and known stable test targets rather than requiring every row to contain media. Re-select representative media if removed instead of treating one deleted film as a global outage.

## Email policy

Send through existing SMTP2GO to the existing admin recipient, using protected credentials independently of Catalogue. Five-minute boot grace; alert after three consecutive failed probes. One incident email groups downstream failures under the likely shared cause, states last success, first failure, error, and attempted recovery. One recovery email after two passing checks. Persist incident IDs across restarts and avoid repeating unchanged alerts; optionally one reminder after an hour unresolved. Do not turn off existing application-specific notifications.

If SMTP/DNS/WAN is unavailable, spool alerts and send when connectivity returns, clearly retaining the original failure time. A local checker cannot immediately email during a whole-home Internet/power outage, and prpl-pc being off is another blind spot. An external heartbeat would cover that separately if desired; existing cloud-node ownership/access is not yet verified.

## Test without reboot

Test retry logic with injected stopped/slow/failed service responses, duplicate execution, deadlines and recovery. Test DNS/HTTP/schema/image/SMB classifications with controlled failures and real read-only healthy probes. Test alert grouping, deduplication, restart persistence, SMTP failure queueing and recovery mail with a captured test transport. A real test email would be explicitly labeled and sent only as part of approved installation/testing. Do not interrupt current playback or downloads. Document that a genuine future boot is still required to establish cold-boot reliability.
