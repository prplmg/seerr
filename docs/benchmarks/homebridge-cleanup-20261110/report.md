# Homebridge accessory cleanup — 2026-11-10

User authorized Levoit plugin and Aire Cuarto/Oficina removal, preserving Sala, checking toggle dependencies and measuring savings.

Dependency audit: three virtual switches are standalone configurations, no Homebridge references beyond their own names. Apple Home automations are external and not verified. Retained all three switches to avoid breaking unverified automation; virtual-switch process needed for Sala anyway. Removed LevoitAirPurifiers platform and its package dependency; moved exact plugin directory out of node_modules into private rollback backup, without npm re-resolving other dependencies or overwriting Broadlink/Ring local patches. Removed only Aire Cuarto/Oficina from Broadlink accessories. Backup: /homebridge/backups/remove-unused-1794370617837 (config/package JSON and plugin; secrets stay on guest).

Restarted Homebridge container. Verified Sala configuration hash and entire virtual-switch configuration hash identical, only Sala in Broadlink config, external Sala publication retained, Ring still only Timbre, no Levoit platform/package/process. No physical IR command sent; Sala end-to-end hardware response not tested. Cached purifier or removed-AC tiles may persist in Apple Home; no pairing data manually erased.

Two idle60-second samples, seven observations10s apart, after retained plugin processes started: aggregate process proportional-set-size median566.14→520.21 MiB (45.93 MiB lower), MemAvailable441.74→488.67 MiB (46.93 MiB higher). No FFmpeg or swap in either sample. One before/after comparison, restart/GC variation not isolated; do not attribute every byte to one accessory. Savings roughly consistent with removed Levoit45 MiB process. VM allocation unchanged1536 MiB.

Memory accounting: Hyper-V assignment includes the whole guest. Linux exposes~1425 MiB, plugin/service PSS~520 MiB after cleanup; RAM-backed root filesystem and shared/tmpfs data~300 MiB, plus kernel/Docker/other processes, reclaimable cache and free headroom. Cached/Shmem/PSS overlap: do not sum them as exclusive buckets. MemAvailable is an estimate of reclaimable headroom, not a separate allocated category. Freed guest memory need not reduce host-assigned memory. No recommendation to reduce VM allocation based solely on this modest saving.

Rollback: restore Levoit platform/package entry and plugin from backup; merge original Cuarto/Oficina accessory entries into current config, preserving newly rotated Ring credentials and current unrelated settings. Restart service. Avoid blindly overwriting full old config.
