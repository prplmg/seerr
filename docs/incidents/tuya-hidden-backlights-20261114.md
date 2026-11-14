# Cocina/Cuarto backlight visibility

User requested hiding only the extra backlight controls, without changing their states. Initial HomeKit readings: Cuarto backlight Off, Cocina backlight On. Existing global schema override already sets switch_backlight hidden=true, but installed @0x5e/homebridge-tuya-platform1.7.0-beta.58 SwitchAccessory.configureServices iterates raw device.schema and bypasses getSchema's hidden handling.

Scoped patch in /homebridge/node_modules/@0x5e/homebridge-tuya-platform/dist/accessory/SwitchAccessory.js: within schemata.forEach, for device UUID14f6242f457e2595 or6d5d44bf62591dbc and code switch_backlight, if getSchema returns undefined, remove the cached service if present and return. No sendCommands, characteristic writes, or device-state mutations. Other devices/channels unchanged. Backup /homebridge/backups/tuya-hide-backlight-20261114/SwitchAccessory.js. Three mocked service-exposure cases pass (two targets and unrelated control). Only Tuya child process restarted; garage/main bridge untouched.

Plugin updates can overwrite this local patch. Recheck whether upstream switch discovery respects hidden schema overrides after updates; reapply the scoped fix only if still needed. Restore the backed-up JS file and restart the Tuya child to roll back exposure, without changing physical states.

Live read-only HAP verification after reload: both accessories expose only switch_1/Luz and switch_2/Ventilador; switch_backlight absent. No backlight control command was sent. Hidden physical states were not independently re-read through Tuya after hiding; exposure removal itself does not write them. Normal fan state in Cuarto read On after reload versus Off before; no fan command was sent by this work (external change or refreshed status not isolated).
