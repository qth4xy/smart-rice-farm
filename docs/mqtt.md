# MQTT contract

The website, the logger and the firmware all depend on this contract. Change it only by adding
fields; never rename or remove one.

- Base topic: `<root>/<deviceId>/`, for example `srf-7c8c8fcb/srf-cc2468/`.
- `<root>` is the topic root. Each device generates a random one (`srf-` + 8 hex digits) on first
  boot and stores it in NVS; it can be changed in the setup portal. The OLED network page and the
  serial `net` command show it. On a private broker you may set it to plain `srf`.
- The device id is `srf-` plus the last 6 hex digits of the Wi-Fi MAC. It is also the MQTT client id.
- Times (`ts`, `nextIrrigationEta`) are Unix seconds (UTC), or `null` before the clock is synced
  over NTP.

## Topics

| Topic | Direction | Retained | QoS | Payload |
|---|---|---|---|---|
| `status` | device → | yes | 1 | `online`, or `offline` (the last will, also sent if the device drops off) |
| `state` | device → | yes | 0 | full JSON snapshot, on every discrete change and every 10 s |
| `event` | device → | no | 0 | one JSON event (see below) |
| `config` | device → | yes | 0 | current settings JSON, at boot, on reconnect and after any change |
| `cmd` | → device | no | 1 | one JSON command (see below) |

## `state`

```json
{"ts":1763550000,"mode":"AWD","pump":true,"pumpRunS":42,"manual":false,"filling":true,
 "floatLow":"WET","floatHigh":"DRY","zone":"BETWEEN","fault":null,"warnings":[],
 "soilPct":63,"soilRaw":2100,"airTempC":31.2,"airRh":71,"nextIrrigationEta":null,
 "avgDryingS":640000,"avgFillS":180,"cycles":12,"stage":"VEGETATIVE","muted":false,
 "rssi":-58,"uptimeS":3600,"fw":"0.4.0"}
```

| Field | Type | Notes |
|---|---|---|
| `ts` | int \| null | device clock |
| `mode` | `AWD` \| `FLOOD` \| `OFF` | |
| `pump` | bool | actual pump output |
| `pumpRunS` | int | seconds the pump has been running (0 when off) |
| `manual` | bool | a manual run is active |
| `filling` | bool | the AWD fill latch |
| `floatLow`, `floatHigh` | `WET` \| `DRY` \| `UNKNOWN` | debounced |
| `zone` | `BELOW` \| `BETWEEN` \| `ABOVE` \| `INVALID` \| `UNKNOWN` | see control-logic.md |
| `fault` | `FLOAT_CONFLICT` \| `PUMP_TIMEOUT` \| null | latched |
| `warnings` | string[] | `FLOAT_LOW_SUSPECT`, `SLOW_FILL`, `FAST_DRAIN` |
| `soilPct` | int \| null | null = reading invalid |
| `soilRaw` | int | raw ADC (0–4095) |
| `airTempC`, `airRh` | number \| null | null = no good DHT11 reading in the last 30 s |
| `dhtFails` | int | DHT11 read failures since boot (single misses are normal) |
| `nextIrrigationEta` | int \| null | **an estimate**: last pump-off + average drying time |
| `avgDryingS`, `avgFillS` | int | over the last 10 recorded cycles, 0 if none |
| `cycles` | int | total recorded cycles |
| `stage` | `NONE` \| `PRE_TRANSPLANT` \| `ESTABLISHMENT` \| `VEGETATIVE` \| `FLOWERING` \| `RIPENING` | crop schedule |
| `muted` | bool | buzzer muted |
| `rssi` | int \| null | Wi-Fi signal in dBm |
| `uptimeS` | int | |
| `fw` | string | firmware version |

There is no continuous water level: the floats give only zones. Displays must not invent one.

## `event`

Every event is `{"event":"<name>", "ts":<unix, if known>, ...details}`.

| Event | Details |
|---|---|
| `boot` | `fw`, `mode`, `reset` (ESP reset reason code) |
| `pump_on` | `reason` (`auto` \| `manual` \| `command`), `mode` |
| `pump_off` | `runS`, `reason: "fault"` if a fault stopped it |
| `fault` | `fault` |
| `fault_cleared` | |
| `warning` | `warnings` (the full current list, sent when a new warning appears) |
| `mode_changed` | `mode`, `reason` (`command` \| `schedule`) |
| `cycle_complete` | `dryingS`, `fillS`, `avgDryingS`, `avgFillS`, `cycles` |
| `portal` | `reason: "button"` (BOOT held 5 s) |
| `ack` | `cmd`, `ok`, `error` (if not ok), plus command-specific fields |

## `cmd`

Every command gets exactly one `ack` event. Unknown commands, unknown fields and out-of-range
values are rejected (`ok:false` with an `error` message) and nothing changes.

| Command | Fields | Notes |
|---|---|---|
| `{"cmd":"setMode","mode":"AWD"}` | `mode`: `AWD` \| `FLOOD` \| `OFF` | saved to NVS |
| `{"cmd":"pump","on":true,"seconds":30}` | `on` bool; `seconds` 1–3600 when on | capped at `pumpMaxRunS`; refused during a fault. `on:false` stops a manual run and any auto fill |
| `{"cmd":"clearFault"}` | | re-raised at once if the cause is still there |
| `{"cmd":"setConfig", ...}` | any of `debounceS` 0–60, `pumpMaxRunS` 10–3600, `pumpMinOffS` 0–3600, `soilDryAlertPct` 0–100, `soilBackupDelayS` 60–86400, `soilBackupCanStartPump` bool | at least one field |
| `{"cmd":"setSchedule","transplantDate":"2026-12-01","floweringDate":"2027-02-15"}` | both `YYYY-MM-DD`, flowering after transplant; both `null` to clear | |
| `{"cmd":"calibrateSoil","point":"dry"}` | `point`: `dry` \| `wet` | stores the current raw reading; ack includes `raw` |
| `{"cmd":"mute","minutes":30}` | 0–1440 (0 = unmute) | |
| `{"cmd":"testPage","on":true}` | `on` bool | raw float/soil page on the OLED |
| `{"cmd":"wifiPortal"}` | | opens the setup portal; irrigation keeps running |
| `{"cmd":"reboot"}` | | after 0.5 s |

## `config`

```json
{"fw":"0.4.0","deviceId":"srf-cc2468","mode":"AWD","debounceS":3,"pumpMaxRunS":300,
 "pumpMinOffS":60,"soilDryAlertPct":30,"soilBackupDelayS":600,"soilBackupCanStartPump":false,
 "floodAfterTransplantDays":14,"floweringWindowDays":7,"transplantDate":null,
 "floweringDate":null,"soilRawDry":3000,"soilRawWet":1300}
```

## Brokers

**HiveMQ public broker** (current default, no account needed):

| Client | Endpoint |
|---|---|
| Device (ESP32) | `broker.hivemq.com:8883`, TLS, no login. The certificate chains to Amazon Root CA 1, which is built into the firmware. |
| Website on https (Vercel) | `wss://broker.hivemq.com:8884/mqtt` |
| Local page or tools | `ws://broker.hivemq.com:8000/mqtt` or TCP `1883` (unencrypted, testing only) |

The public broker is open to everyone. Anyone who subscribes to `#` can read every message, and
anyone who knows the topic root can send commands. Our rules for it:

- Send no passwords and no personal data. The device sends only farm readings and states.
- The random topic root keeps casual users off our topics, but it is not access control.
- What a stranger could do is limited by the firmware: every command is validated, a pump run is
  capped by `pumpMaxRunS`, and faults stop the pump. This is acceptable for the 5 V scale model,
  not for a real field pump.
- There is no uptime guarantee. Irrigation never depends on the broker.
- For a real deployment, use a private broker with logins and topic permissions (HiveMQ Cloud).

**HiveMQ Cloud** (private, for real use):

- Device: TLS on port **8883**. The certificate is checked against ISRG Root X1, which is built
  into the firmware.
- Website: secure WebSockets `wss://<cluster>.hivemq.cloud:8884/mqtt`.
- Use separate credentials for the device and for the website.

**Local Mosquitto** (offline backup): `tools/mosquitto/mosquitto.conf`.

- Port 1883 (MQTT) and port 9001 (WebSockets), both with a password file. Enter `0` for TLS in
  the portal.
- A page served over https (Vercel) can only reach `wss://` brokers. A local `ws://` broker works
  only from the local dev server or from `presentation.html` opened as a file.

## Device setup (no reflashing)

1. With no saved Wi-Fi, or after Wi-Fi fails for 60 s after boot, the device opens the access
   point `SRF-Setup-<id>`. Holding BOOT for 5 s, the `wifiPortal` command or `wifi reset` on the
   serial console also open it.
2. Join that Wi-Fi network from a phone. The portal page opens (or browse to 192.168.4.1).
3. Choose the farm Wi-Fi network (2.4 GHz). The MQTT fields are pre-filled for the HiveMQ public
   broker (`broker.hivemq.com`, 8883, TLS 1, no user), so they can stay as they are. For a private
   broker, fill in host, port, user, password and TLS. Leave the password blank to keep the saved one.
4. Save. The settings are stored in NVS, and the OLED network page shows the IP and MQTT status.
