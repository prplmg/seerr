# Mini resource audit — 2026-11-10

Read-only investigation after transient catalogue timeout. Last boot Nov 3; native API recovered and public status 200 in 0.66s without restart. Root cause not established.

Usable RAM 5.85 GiB; available initially 327 MiB, subsequently approximately 640 MiB. Sample paging rate zero; pagefile usage 557 MiB (peak 1173 MiB). Aggregate process working sets 3632 MiB (includes shared pages), private bytes 2822 MiB, 189 processes. Catalogue node approximately 489 MiB working set / 573 MiB private bytes. Nonpaged pool 289 MiB, paged pool 383 MiB. No single runaway process established; these snapshots do not identify all physical memory categories.

C: approximately 6.46 GiB free of 56.55 GiB. pagefile.sys 3.41 GiB; hiberfil.sys 2.34 GiB. Retained 41 catalogue release directories; each previous build payload approximately 54–56 MiB logical, roughly 2.2 GiB combined. Files have compression attributes, so logical bytes are not reclaimable allocated-byte estimates. Broad directory audit stopped to avoid prolonged I/O; full disk attribution remains incomplete.

Recommendations: bounded release retention with active/current rollback protection and preserved receipts/state; assess unused staging copies before deletion. Keep pagefile. Disabling hibernation is optional and also removes Hibernate/Fast Startup. Assess background services before changing them; no service disabled, reboot, production data cleanup or app deployment performed.

Follow-up: Hyper-V explains substantial RAM outside ordinary process working sets: Homebridge assigned 1536 MiB; Caddy assigned 650 MiB. Do not stop Caddy (catalogue routing) or reduce guest memory without measuring demand. Optional-service candidates observed: Windows Search 127 MiB, Bluetooth group 19 MiB, DiagTrack 15 MiB, Intel Graphics Command Center 10 MiB, Print Spooler 6 MiB. These are approximate host-process working sets, not guaranteed recoverable savings. None stopped.

PostHog is browser-side. Separate analytics-trial metrics POSTs run every 30 seconds, at most 10 reports per effect instance (also reports on visibility change); server validates and defers log writing with setImmediate, with a 20 requests/minute/user rate limiter. No accumulated metrics history in application memory. Standard logger rotates 20 MB files, retains normal logs seven days and machine logs one day; total log bytes are not capped at 20 MB. Nonzero request/log I/O overhead, not an established memory-pressure cause.

Single-rollback retention implemented in tools/build-host/retention.cjs and called after verified successful deployment under its exclusive lock. Updated legacy seerr-fork wrapper as well as this checkout. Tests cover sole rollback, receipt retention, linked-target safety, repeated runs and refusal on unknown live build. Hibernation/VM/service settings unchanged.

Cleanup completed: removed274 obsolete artifact paths. C: free increased from6944808960 to10479853568 bytes (about3.29 GiB reclaimed;9.76 GiB free). Exactly one previous directory remains: catalogue-20261110185303791-49437-release, rollback BUILD_ID NjOCFnENLnSOYrlfKXRFg. Live BUILD_ID unchanged EJkMjUh3XYLMOExpGTMKG. Lock absent; native version3.4.1, public HTTP200 in0.619s. Receipt on Mini in retained release/retention.json. No application deployment or Git push.
