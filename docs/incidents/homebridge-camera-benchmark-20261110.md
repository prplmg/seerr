# Homebridge camera benchmark

No VM memory/CPU changes yet. Windows Search, Spooler, bthserv, BTAGService, BthAvctpSvc and RtkBtManServ stopped and Disabled by explicit user instruction. Bluetooth per-user instance stopped before its base service; original service states saved on Mini at C:/ProgramData/Seerr/service-before-20261110.json. No arbitrary dependent service forced off.

Homebridge has one vCPU, 1536 MiB assigned. Historical camera inventory: Entrada, Jardin, Pasillo, Timbre. User confirms doorbell battery depleted: exclude it from current active-stream test and do not treat expected offline as a failure. Preserve all pairings/plugins/cameras. No camera removal authorized.

Host sampler: tools/diagnostics/homebridge-benchmark.ps1; installed at C:/ProgramData/Seerr/tools. Captures every five seconds: host available RAM/CPU/paging and VM CPU/assigned/reported-demand. No secrets/video. Guest access pending explicit credential approval after automatic approval review rejected use of stored Homebridge SSH credentials. Key-based access failed. Guest demand=0 is not proof of zero usage.

Proposed controlled phases at unchanged allocation: idle2min; one online live camera3min; all online live cameras5min; recovery2min. User opens Apple TV cameras at coordinated start. Verify actual simultaneous live streams (not cached thumbnails) with guest FFmpeg process count/counters. Record guest MemAvailable, swap activity, CPU, process RSS/FFmpeg codecs, stream-start latency, stalls and timeouts. Do not record frames/audio. Compare guest memory high-water mark and recovery; corroborate with host paging and catalogue status latency. If no guest access, host-only results cannot establish safe lower RAM.

Repeat load phase once for variation. Doorbell remains untested until charged. Any later RAM reduction requires measured safety margin and a repeat of identical phases, with original1536 MiB restored if swapping/stream failures appear. Avoid interpreting sum of process RSS as unique physical memory. One vCPU may limit transcoding before RAM. A single initial idle-labelled sample is observational: active streams not yet independently confirmed absent.
