# Mini resource audit — 2026-11-10

Read-only investigation after transient catalogue timeout. Last boot Nov 3; native API recovered and public status 200 in 0.66s without restart. Root cause not established.

Usable RAM 5.85 GiB; available initially 327 MiB, subsequently approximately 640 MiB. Sample paging rate zero; pagefile usage 557 MiB (peak 1173 MiB). Aggregate process working sets 3632 MiB (includes shared pages), private bytes 2822 MiB, 189 processes. Catalogue node approximately 489 MiB working set / 573 MiB private bytes. Nonpaged pool 289 MiB, paged pool 383 MiB. No single runaway process established; these snapshots do not identify all physical memory categories.

C: approximately 6.46 GiB free of 56.55 GiB. pagefile.sys 3.41 GiB; hiberfil.sys 2.34 GiB. Retained 41 catalogue release directories; each previous build payload approximately 54–56 MiB logical, roughly 2.2 GiB combined. Files have compression attributes, so logical bytes are not reclaimable allocated-byte estimates. Broad directory audit stopped to avoid prolonged I/O; full disk attribution remains incomplete.

Recommendations: bounded release retention with active/current rollback protection and preserved receipts/state; assess unused staging copies before deletion. Keep pagefile. Disabling hibernation is optional and also removes Hibernate/Fast Startup. Assess background services before changing them; no service disabled, reboot, production data cleanup or app deployment performed.
