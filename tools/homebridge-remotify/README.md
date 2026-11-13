# Garage remote (Remotify)

Private Homebridge accessory. Separate from Portón (Tuya gate power).

Status 2026-11-13: staged at `/homebridge/remotify-remote` on Homebridge; NOT registered, no configuration changed or service restarted. Awaiting tenant and dedicated login credentials. Five mocked tests passed locally and on target. No live activation issued.

Configuration after read-only authenticated device discovery:

```json
{"accessory":"RemotifyRemote","name":"Garage remote","credentialsFile":"/homebridge/secrets/remotify.json","deviceId":"REPLACE_WITH_VERIFIED_DEVICE_ID"}
```

Credential file (mode 0600) contains `tenant`, `email`, `password`. Never commit it. Session cookies stay in memory. API host is fixed to remotify.mx, redirects rejected. No external dependencies.

Startup and characteristic reads do not call the network. Off/reset performs no remote action. On authenticates if necessary, checks device availability, then sends one POST access. The activation request is never retried, including authentication failure or timeout. Tile resets after one second; short cooldown blocks duplicate taps. Reset indicates readiness, not gate position or confirmed physical success. Failed/uncertain requests report an error.

Before enabling: validate login and GET devices without POST access; back up Homebridge config; add plugin and accessory without modifying Tuya; restart Homebridge using established procedure; verify tile/service registration read-only. Physical activation testing requires a separate user-authorized test. HomeKit switch has switch semantics, not garage-door security semantics.
