# Mini storage audit — 2026-11-04

Read-only investigation; no deletion, settings changes, service restarts or deployment. C: has 4,439,605,248 bytes free (4.13 GiB), total 60,714,643,456 bytes (56.55 GiB). D: has about160GiB free; E: about85GiB.

Catalogue direct-directory inventory on C: totals approximately8.77GiB of file payload:

- 92 release-backup directories:3.697GiB.
- 19 benchmark/performance-capture directories:2.555GiB.
- 80 native/build/stage directories:1.389GiB.
- Running app:0.826GiB, with linked entries excluded.
- Other small runtime/log/data directories make up the remainder.

Today’s three native/release pairs total246,070,707bytes (234.67MiB), so today’s retained release artifacts do not explain a several-GiB drop on their own. Hibernation file2.34GiB and pagefile1.17GiB are additional C: consumers, not proven recent growth. No pre-change disk baseline available.

Sizes are file payload measured with GetCompressedFileSizeW, excluding reparse-linked entries; this is not a guarantee of reclaimable allocation (hardlinks/cluster overhead affect that). Directory attribute8208 means directory + not-content-indexed, not compression; an initial commentary misreading was corrected. Broad whole-C audit was stopped after targeted inventory completed to avoid an unnecessarily long background scan. Windows/user directory totals are not claimed from that incomplete scan.

Recommend reviewing/removing obsolete benchmark traces and build-stage folders and applying bounded rollback retention, keeping current live and recent verified rollback versions. No deletion authorized in this turn. Preserve the current rollback C:/ProgramData/Seerr/catalogue-20261104135754812-1043-release. Consider D: for future build workspace after checking dependencies and rollback design; not changed.

Evidence: mini-storage-audit-20261104.json. No Git push.
