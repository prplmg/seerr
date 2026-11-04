# Mini storage audit — 2026-11-04

Read-only investigation; no deletion, settings changes, service restarts or deployment. C: has 4,439,605,248 bytes free (4.13 GiB), total 60,714,643,456 bytes (56.55 GiB). D: has about160GiB free; E: about85GiB.

Catalogue direct-directory inventory on C: totals approximately8.77GiB of file payload:

- 92 release-backup directories:3.697GiB.
- 19 benchmark/performance-capture directories:2.555GiB.
- 80 native/build/stage directories:1.389GiB.
- Running app:0.826GiB, with linked entries excluded.
- Other small runtime/log/data directories make up the remainder.

Today’s three native/release pairs total246,070,707bytes (234.67MiB), so today’s retained release artifacts do not explain a several-GiB drop on their own. Hibernation file2.34GiB and pagefile1.17GiB are additional C: consumers, not proven recent growth. No pre-change disk baseline available.

Sizes are file payload measured with GetCompressedFileSizeW, excluding reparse-linked entries; this is not a guarantee of reclaimable allocation (hardlinks/cluster overhead affect that). Directory attribute8208 means directory + not-content-indexed, not compression; an initial commentary misreading was corrected. The broad whole-C metadata scan completed normally before a stop-only-our-audit command ran; there was no remaining audit process to stop. Its readable-file totals skip junctions and deduplicate hardlinks globally, so totals are approximate and Windows hardlinks can be attributed to whichever directory was encountered first. Protected/unreadable entries are excluded.

Recommend reviewing/removing obsolete benchmark traces and build-stage folders and applying bounded rollback retention, keeping current live and recent verified rollback versions. No deletion authorized in this turn. Preserve the current rollback C:/ProgramData/Seerr/catalogue-20261104135754812-1043-release. Consider D: for future build workspace after checking dependencies and rollback design; not changed.

Evidence: mini-storage-audit-20261104.json. No Git push.

## Completed broad scan

Additional non-overlapping consumers: Windows readable-file payload about12.09GiB; WindowsApps6.79GiB; Homebridge5.60GiB (disk4.10GiB plus VM state1.50GiB); Caddy VHD/checkpoint files2.66GiB plus VM state0.58GiB; Users1.92GiB; recovery payload1.33GiB. Windows Delivery Optimization cache0.74GiB and GoogleUpdater cache0.49GiB are included in the broader directory totals, not extra on top.

Both Homebridge and Caddy VMs are running. Caddy has an automatic checkpoint dated2025-10-18; its current differencing disk is1.87GiB. These active VM files are not cleanup-by-file-deletion candidates. Current free-space recheck4,455,026,688bytes (4.15GiB). No historical baseline establishes which exact sizes changed since the user's prior approximately10GiB reading.
