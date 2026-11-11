# Homebridge camera load — November 10, 2026

User confirmed all online cameras live on Apple TV; doorbell excluded because depleted battery. Unchanged one vCPU/1536 MiB allocation. Guest sampled every5s for300s,61 samples. No footage, audio or secret URLs recorded.

CPU mean54.51%, peak100%, p9589.21% (five-second guest CPU intervals). Minimum MemAvailable344.12 MiB; swap0 throughout. FFmpeg process count2–6; not a count of cameras. Sanitized codec inspection found Opus audio processing; installed Ring camera-source.js forwards video packets and requests video:false on audio transcoding path. This is not evidence of H264 re-encoding. Baseline guest available370–384 MiB, container~639 MiB, no FFmpeg at two initial samples.

Recommendation: retain1536 MiB. A256 MiB reduction would consume most observed available headroom, leaving approximately88 MiB before missing doorbell/other activity;1024 MiB is not supported by this evidence. CPU saturation warrants investigating stream quality before considering a second vCPU. No allocation changed.

Limitations: one run, doorbell absent, user-perceived smoothness and recovery confirmation pending. No reduced-allocation test. Initial baseline short. Host sampler executes CIM reads between intervals and thus takes longer than nominal300s; align timestamps rather than assuming equal durations. Guest CPU can include other Homebridge plugin work.

Completed host sampler60 samples: minimum host available931 MiB; peak host CPU100%, reported VM CPU43%, Pages/sec1370. Host collection includes CIM overhead and extends beyond guest window; host CPU attribution is not isolated, and Pages/sec includes file-backed paging. Guest swap remained0 in matched guest run. Raw host timestamps retained for alignment.


Recovery/user confirmation: user observed freezes/reconnects with simultaneous views, then confirmed all views closed. Two-minute recovery: {"samples": 25, "meanCpu": 3.8296698692559246, "lastMinuteMeanCpu": 1.569879650654656, "peakCpu": 28.0561122244489, "lastAvailableMiB": 358.53515625, "swapMiB": 0.0, "maxFFmpeg": 0}. No FFmpeg in any recovery sample. Mini CPU is Intel Celeron N3350, two cores/two logical processors. No allocation changed. Recent20-minute aggregate logs had17 stream starts/17 stops and108 Ring connection-pattern lines; broad regex counts do not establish failure cause or exclude offline doorbell and normal teardown. Eight unattributed timeout lines cannot be assigned to cameras. CPU contention is plausible, not proven. Recommend keeping1536 MiB and next comparing one live camera against concurrent streams; adding vCPU alone does not add host capacity.
