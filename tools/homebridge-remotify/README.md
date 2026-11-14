# Garage remote (Remotify)

Private Homebridge accessory. Separate from Portón (Tuya gate power).

Status 2026-11-13: installed from `/homebridge/remotify-remote` via local package dependency and node_modules symlink. Independent login and read-only device discovery succeeded (Garage, device 1, online). Configured as Garage remote on the existing main bridge. Existing platforms and bridge configuration preserved. Backup: `/homebridge/backups/remotify-20261113`. Five mocked tests passed locally and on target. No live activation issued.

Configuration after read-only authenticated device discovery:

```json
{"accessory":"RemotifyRemote","name":"Garage remote","credentialsFile":"/homebridge/secrets/remotify.json","deviceId":"REPLACE_WITH_VERIFIED_DEVICE_ID"}
```

Credential file (mode 0600) contains `tenant`, `email`, `password`. Never commit it. Session cookies stay in memory. API host is fixed to remotify.mx, redirects rejected. No external dependencies.

Startup and characteristic reads do not call the network. Off/reset performs no remote action. On authenticates if necessary, checks device availability, then sends one POST access. The activation request is never retried, including authentication failure or timeout. Tile resets after one second; short cooldown blocks duplicate taps. Reset indicates readiness, not gate position or confirmed physical success. Failed/uncertain requests report an error.

Before enabling: validate login and GET devices without POST access; back up Homebridge config; add plugin and accessory without modifying Tuya; restart Homebridge using established procedure; verify tile/service registration read-only. Physical activation testing requires a separate user-authorized test. HomeKit switch has switch semantics, not garage-door security semantics.

Verified main HAP service on port 51476: Garage remote aid 63, On=0. All child bridges restarted successfully. Tuya configuration unchanged; Ring refreshed its own token normally. Main bridge has zero paired clients: user pairing of Homebridge BA1C is still required. Do not claim visibility in Apple Home until paired. Rollback must remove only the Remotify addition, not overwrite fresh Ring credentials with the backup.

## Supervised calibration — 2026-11-14

User selected1500ms minimum command spacing for future estimated-state work after five consecutive observed open-then-stop successes from closed (request-start gaps1521,1516,1504,1509,1506ms).250–1000ms tests produced only one observed action;1250ms was inconsistent. The earlier1500ms closing test may have reversed instead of remaining stopped; closing behavior remains unresolved. HTTP success does not verify physical activation, and network timing varies. Full travel time remains unmeasured.

Tests used one-off pairs with no retries and user observation/reset between trials. No plugin settings changed: the existing duplicate guard remains, Portón unchanged. Estimated garage-door state tracking is not implemented. Do not treat this calibration record as authorization for unattended activation.

## Estimated garage-door accessory — local implementation, not enabled

New accessory `RemotifyGarageDoor` shares a1500ms request-start spacing controller with `RemotifyRemote` when the latter has `estimatedDoor:true`. Both need identical deviceId/credentialsFile and explicit travelSeconds, initialState and stateFile. Open/Close targets avoid redundant commands. Startup/GET/correction never activate the device. Closing interruption is uncertain because the supervised closing test possibly reversed. No synthesized multi-pulse reversal sequences. Opening interruption becomes Stopped; the next raw press reverses. Travel timers estimate endpoints only. Persisted state after restart requires correction rather than assuming no offline movement.

Secondary switches “Garage · Mark open” and “Garage · Mark closed” change the estimate without physical movement. Required HomeKit obstruction characteristic is false because no sensor is connected; this is not obstruction monitoring. Unknown/uncertain position is exposed as a communication error, not an invented HomeKit door-state value. Existing Portón remains separate. Ten mocked tests pass; live installation pending user-provided full-travel time and initial position. No actual pulses sent during implementation.
