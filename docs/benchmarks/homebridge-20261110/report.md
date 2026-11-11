# Homebridge camera load — November 10, 2026

User confirmed all online cameras live on Apple TV; doorbell excluded because depleted battery. Unchanged one vCPU/1536 MiB allocation. Guest sampled every5s for300s,61 samples. No footage, audio or secret URLs recorded.

CPU mean54.51%, peak100%, p9589.21% (five-second guest CPU intervals). Minimum MemAvailable344.12 MiB; swap0 throughout. FFmpeg process count2–6; not a count of cameras. Sanitized codec inspection found Opus audio processing; installed Ring camera-source.js forwards video packets and requests video:false on audio transcoding path. This is not evidence of H264 re-encoding. Baseline guest available370–384 MiB, container~639 MiB, no FFmpeg at two initial samples.

Recommendation: retain1536 MiB. A256 MiB reduction would consume most observed available headroom, leaving approximately88 MiB before missing doorbell/other activity;1024 MiB is not supported by this evidence. CPU saturation warrants investigating stream quality before considering a second vCPU. No allocation changed.

Limitations: one run, doorbell absent, user-perceived smoothness and recovery confirmation pending. No reduced-allocation test. Initial baseline short. Host sampler executes CIM reads between intervals and thus takes longer than nominal300s; align timestamps rather than assuming equal durations. Guest CPU can include other Homebridge plugin work.
