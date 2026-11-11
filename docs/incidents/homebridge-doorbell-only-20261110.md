# Doorbell-only Homebridge camera exposure

At user request, Ring hideDeviceIds now excludes Pasillo(c35aa465-420b-42fd-93c7-715ad466f750), Entrada(ac606f17-0236-4fcb-826c-b501238d0be5), Jardin(a1704e29-4ba5-49c8-a0d5-cc45fef6109b). Timbre(eaf81636-3848-472b-98ab-c3f5fbe3172a) remains exposed. Existing exclusions merged, no Ring account camera removal. Non-camera configuration unchanged. Config backup remains on guest at /homebridge/backups/doorbell-only-1794369732628.json (contains credentials; never export into Git).

Child/main process reload attempts did not establish updated publication; clean docker restart homebridge succeeded. Startup log explicitly confirms Configured camera Timbre and Hidden accessory for the other three. Pairing records not manually deleted. Doorbell battery depleted per user, so live video not verified. Home app may retain stale external accessory tiles that user can remove.

Expected benefit is avoiding previews/live stream work for excluded cameras in Apple Home. Ring plugin and other accessories still run; no measured steady-state RAM reduction claimed, and no claim this fixes single-camera freezes. VM1536 MiB/one vCPU unchanged.

Rollback: remove only these three UUIDs from current Ring hideDeviceIds and restart Homebridge. Avoid restoring the whole old configuration because Ring credentials may have rotated since backup. Existing pairing data intentionally preserved.
