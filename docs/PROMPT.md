# Smart Rice Farm — AIoT AWD irrigation (ESP32-S3) + presentation simulator

> Paste this whole file into Claude Code, run in an empty folder. Or save it there as `PROMPT.md` and tell Claude Code: "Read PROMPT.md and follow it."

## 0. How to work

1. Read this whole file before doing anything.
2. Ask me the questions in **§10 Ask me first** in one message, then wait for my answers.
3. Show a short plan (the phases in §9), then build one phase at a time.
4. After each phase: build, run the tests, update the docs, commit. You can't see my hardware, so give me clear step-by-step checks to do on the bench and wait for my results before moving on.
5. Keep everything in one git repo (§8). Never commit passwords or keys.
6. If something here is unclear or looks wrong, ask instead of guessing. Explain setup and wiring steps clearly, one step at a time.
7. Write all code, comments, docs and UI text in English.

## 1. What we're building

Smart Rice Farm is an AIoT system for a national innovation competition in Thailand. It automates **Safe AWD (Alternate Wetting and Drying)** irrigation for rice paddies. The demo is a scale model with a 5 V pump, but the control logic must be the real AWD logic.

**How AWD works:** a perforated observation pipe, 30 cm long, is buried 20 cm into the soil with 10 cm above the surface. The water level inside it equals the field's water level, above or below the soil surface. Let the water drop to **15 cm below** the surface (−15 cm), then pump water in until it is **5 cm above** the surface (+5 cm), stop, and repeat. These levels follow IRRI's Safe AWD guideline, which says there's no yield loss at the −15 cm threshold.

Three deliverables in one repo:

1. **Firmware** for an ESP32-S3: the AWD controller, sensors, OLED, buzzer, Wi-Fi and MQTT.
2. **Web simulator and live dashboard**, shown on a projector to the judges. It must work offline with no hardware attached.
3. **Docs**: wiring, MQTT contract, control logic and a presentation script.

## 2. Hardware

| Part | Notes |
|---|---|
| ESP32-S3 dev board | Built-in Wi-Fi. Exact module: ask me (§10). |
| 0.96" OLED, SSD1306 128×64, I2C | Address 0x3C (try 0x3D). Some modules have a yellow top band 16 px high, so keep a 16 px header bar. |
| 1-channel relay module, **HIGH-level trigger** | GPIO HIGH = relay on = pump ON. |
| 5 V DC water pump | Switched by the relay. |
| 2 × vertical float switches (2-wire) | Both inside the observation pipe. |
| Capacitive soil moisture sensor (analog) | Pushed into the soil, separate from the pipe. |
| DHT11 | Air temperature and humidity. |
| Active buzzer | Alerts. |
| Onboard BOOT button (GPIO0) | Reused while running: hold 5 s → Wi-Fi setup portal. |

**Floats:** `FLOAT_LOW` sits at −15 cm (starts the pump) and `FLOAT_HIGH` at +5 cm (stops it). Measured from the bottom of the pipe, that's 5 cm and 25 cm.

**Observation pipe:** perforated all around, 10–15 cm in diameter, wrapped in mesh so mud can't jam the floats.

**Default pin map.** Put every pin in one config header.

| Signal | GPIO | Notes |
|---|---|---|
| OLED SDA / SCL | 8 / 9 | I2C |
| Soil moisture AOUT | 1 | Must be an ADC1 pin, because ADC2 is shared with Wi-Fi |
| DHT11 DATA | 4 | 10 kΩ pull-up if it's a bare sensor |
| FLOAT_LOW | 5 | INPUT_PULLUP, other wire to GND |
| FLOAT_HIGH | 6 | INPUT_PULLUP, other wire to GND |
| Relay IN | 7 | Active HIGH |
| Buzzer | 15 | Through an NPN transistor unless it's a module |
| BOOT button | 0 | Read as an input only after boot |

Avoid: strapping pins 0/3/45/46 for outputs, GPIO19/20 (USB), GPIO26–37 (flash/PSRAM), and the onboard RGB LED pin (GPIO48 or GPIO38, depending on the board version).

**Electrical rules.** Also write these into `docs/wiring.md`.

- ESP32 logic is 3.3 V. Power the OLED, DHT11 and soil sensor from 3.3 V, which keeps the soil sensor's output inside the ADC range.
- The pump runs from its own 5 V supply through the relay's COM/NO contacts, so pump current never goes through the ESP32 board. Put a flyback diode (1N4007 or 1N5819) across the pump, cathode to +.
- Set the relay pin LOW as the very first thing in `setup()` so the pump can't start at boot. If the pump still twitches at power-on, add a 10 kΩ pull-down on Relay IN.
- If the relay doesn't switch reliably from 3.3 V, use a transistor or a 3.3 V-compatible module.
- Put the electronics in a waterproof box. Only the floats and the soil probe touch water or soil.

## 3. Control logic (the core: get this exactly right)

Each float reads **WET** (water at or above it) or **DRY**. Whether a closed switch means WET depends on how the float is mounted, so make it a config flag for each float, and show the raw states on the OLED test page. Water ripples make the switches flicker, so a float state counts only after it has been stable for `DEBOUNCE_S` (default 3 s).

**AWD mode: state table**

| FLOAT_LOW (−15) | FLOAT_HIGH (+5) | Meaning | Pump |
|---|---|---|---|
| DRY | DRY | Water below −15 cm | ON (start filling) |
| WET | DRY | Between the floats | **Keep current state** |
| WET | WET | Reached +5 cm | OFF |
| DRY | WET | Impossible: stuck float or wiring fault | OFF + fault `FLOAT_CONFLICT` |

The latch in row 2 is essential. In the middle band the sensors read the same while filling and while drying, so the controller has to remember whether it is filling.

**Modes**

- `AWD`: the state table above.
- `FLOOD`: keep the field flooded. Use FLOAT_HIGH only (DRY → ON, WET → OFF), and enforce `PUMP_MIN_OFF_S` (default 60 s) so the pump doesn't switch on and off rapidly.
- `OFF`: the pump never runs automatically.
- Manual pump command: runs the pump for N seconds (capped by `PUMP_MAX_RUN_S`), then returns to the current mode.

**Crop schedule (optional automatic mode switching).** If a transplant date and an expected flowering date are set, switch modes by date. Store the dates in NVS and get the time from NTP (time zone Asia/Bangkok). If no schedule is set, keep whatever mode was set by command.

| Crop stage | Mode |
|---|---|
| Transplanting → +14 days (`FLOOD_AFTER_TRANSPLANT_DAYS`) | FLOOD |
| From then until 7 days before flowering | AWD |
| 7 days before → 7 days after flowering | FLOOD |
| After that, until harvest | AWD |

**Safety (non-negotiable)**

- The pump is OFF at boot, on any fault, and on a crash (enable the task watchdog).
- `PUMP_MAX_RUN_S` defaults to 300 s for the scale model; I'll tune it after measuring the real fill time. If FLOAT_HIGH doesn't go WET in time, turn the pump OFF and raise fault `PUMP_TIMEOUT`. Causes include an empty water source, the pump running dry, a leak or a stuck float.
- Faults latch: the pump stays OFF until a `clearFault` command. After a reboot, the fault comes back if the condition is still there.
- Soil moisture backup: if soil moisture stays below `SOIL_DRY_ALERT_PCT` (default 30%) for 10 minutes while FLOAT_LOW still reads WET, raise warning `FLOAT_LOW_SUSPECT`. By default this only alerts. The flag `SOIL_BACKUP_CAN_START_PUMP` (default false) lets it start the pump; we haven't decided on that yet.
- The control loop never waits on Wi-Fi, MQTT or the display, and irrigation works fully offline.
- A failed DHT11 or soil reading is reported, but it never stops the irrigation logic.

**Timing:** poll the floats every 50 ms, the soil sensor every 2 s (average several samples) and the DHT11 every 5 s (never faster than every 2 s). Refresh the OLED about 4 times a second. Send telemetry every 10 s and immediately on any state change.

## 4. AIoT: lightweight on-device intelligence (keep it honest)

- **Cycle analytics:** for each AWD cycle, record the drying time (pump OFF → FLOAT_LOW goes DRY) and the fill time (pump ON → FLOAT_HIGH goes WET). Keep the last 10 cycles in NVS and publish the averages.
- **Next irrigation estimate:** last pump-off time + average drying time → `nextIrrigationEta`. Label it as an estimate everywhere.
- **Anomaly flags:**
  - A fill time over 2× the average raises `SLOW_FILL` (weak water source or a leak).
  - A drying time under 0.5× the average raises `FAST_DRAIN` (possible leak in the field bund).
- Publish everything over MQTT so a logger can keep the history for future ML. Make no fake "AI" claims in the UI.

## 5. Firmware

- `firmware/` is a PlatformIO project using the Arduino framework, board `esp32-s3-devkitc-1`, with flash and PSRAM set to match my module. Pin every library version in `platformio.ini`.
- Libraries: U8g2 (OLED), Adafruit DHT sensor library, ArduinoJson 7, PubSubClient (call `setBufferSize(1024)` or more), WiFiManager (tzapu), Preferences (NVS), ESPmDNS.
- Code structure:
  - a thin `main.cpp`
  - `config.h` for pins and defaults
  - `AwdController` written as **pure C++ with no Arduino calls**, so it can be unit-tested on the PC
  - the modules `Sensors`, `Actuators` (relay, buzzer), `Display`, `Net` (Wi-Fi + MQTT), `Storage` (NVS) and `Analytics`.

**Wi-Fi setup over the air (no reflashing at the venue)**

- Use a WiFiManager captive portal. The access point is `SRF-Setup-<id>`, with extra fields for MQTT host, port, user, password and TLS on/off. Save everything in NVS.
- Open the portal automatically when there's no saved Wi-Fi or Wi-Fi fails for 60 s after boot. Holding BOOT for 5 s, or the MQTT `wifiPortal` command, also opens it.
- The portal must not block (`setConfigPortalBlocking(false)` + `process()` in the loop), so irrigation keeps running while it's open.
- Reconnect automatically with backoff. The mDNS name is `smartricefarm`.
- The OLED shows the portal's AP name, or the IP and RSSI once connected.

**MQTT client**

- The client id is the device id: `srf-` + the last 6 hex digits of the MAC.
- Set the last-will message `offline` on the `status` topic.
- Reconnect with backoff, without blocking.
- TLS (WiFiClientSecure) is optional, for cloud brokers. Allow `setInsecure()` only behind a config flag for demos.

**OLED pages.** Rotate every 4 s; a fault page overrides them. Use English text and the 16 px header bar.

1. Mode, pump ON/OFF + runtime, a water zone graphic (the pipe with two float markers), OK or fault.
2. Soil moisture %, air temperature, humidity.
3. Wi-Fi SSID + RSSI, IP, MQTT status, device id.
4. Next irrigation estimate, average drying and fill times.

Also add a test page showing the raw float pins and the raw soil ADC value, opened by a serial or MQTT command.

**Other firmware features**

- **Buzzer:**
  - Pump ON = 1 short beep; pump OFF = 2 short beeps.
  - Fault = 3 beeps every 10 s for 1 minute, then every 5 minutes until cleared.
  - It can be muted over MQTT.
- **Serial console** for bring-up: `help`, `status`, `test`, `pump on 5`, `mode awd|flood|off`, `wifi reset`, `clear`.
- **NVS:** config, mode, schedule, soil calibration (raw dry and raw wet values) and analytics history. Write only when something changes, to spare the flash.
- **Tests:** `pio test -e native` for `AwdController` and `Analytics`, driven by the shared test vectors (§8).

## 6. MQTT contract

Write this into `docs/mqtt.md` and keep it stable, because the website depends on it.

Base topic: `srf/<deviceId>/`

| Topic | Direction | Retained | Payload |
|---|---|---|---|
| `status` | device → | yes | `online` / `offline` (last will) |
| `state` | device → | yes | Full JSON snapshot, sent on every change and every 10 s |
| `event` | device → | no | `boot`, `pump_on`, `pump_off`, `fault`, `fault_cleared`, `warning`, `mode_changed`, `cycle_complete`, `ack` |
| `config` | device → | yes | Current config JSON |
| `cmd` | → device | no | JSON commands |

Example `state`:

```json
{"ts":1763550000,"mode":"AWD","pump":true,"pumpRunS":42,"floatLow":"WET","floatHigh":"DRY","zone":"BETWEEN","fault":null,"warnings":[],"soilPct":63,"airTempC":31.2,"airRh":71,"nextIrrigationEta":1763600000,"avgDryingS":640000,"avgFillS":180,"rssi":-58,"uptimeS":3600,"fw":"1.0.0"}
```

Commands. Validate every field, reject unknown commands, and reply to each with an `ack` event.

```json
{"cmd":"setMode","mode":"AWD"}
{"cmd":"pump","on":true,"seconds":30}
{"cmd":"clearFault"}
{"cmd":"setConfig","pumpMaxRunS":300,"debounceS":3,"soilDryAlertPct":30}
{"cmd":"setSchedule","transplantDate":"2026-12-01","floweringDate":"2027-02-15"}
{"cmd":"calibrateSoil","point":"dry"}
{"cmd":"mute","minutes":30}
{"cmd":"wifiPortal"}
{"cmd":"reboot"}
```

**Broker:** I'll tell you which one I use (§10).

- The website connects with MQTT over WebSockets, so the broker needs a WebSocket port.
- For a local broker, add `tools/mosquitto/mosquitto.conf` with a listener on 1883 (MQTT), one on 9001 (WebSockets) and a password file.
- A page served over https (GitHub Pages) can only use `wss://`. A local `ws://` broker works only when the site runs locally (over http, or as the single-file build).

## 7. Web simulator and live dashboard (for the projector presentation)

**Purpose:** show the judges how the system works, on a projector, with no internet and no hardware. It has to look polished.

**One UI with two data sources**

- **Simulation** (the default): runs the same AWD logic ported to TypeScript, tested against the same shared test vectors as the firmware, plus a water-level model.
  - Speeds: 1×, 60×, 600×, 3600×; play/pause; reset.
  - These assumptions are editable and shown in a settings panel: water drops 1 cm/day above the soil and 4 cm/day below it; the pump fills at 5 cm/min.
  - Soil moisture and DHT values are simulated and clearly labeled.
- **Live**: connects to the broker over WebSockets (mqtt.js), shows real data and sends commands.
  - Connection settings are kept in localStorage; the password is saved only if I tick "remember".
  - Manual pump and mode changes ask for confirmation.
- A large, always-visible badge says **SIMULATION** or **LIVE · srf-xxxxxx**, so nobody mixes them up.

**Layout.** One screen with no scrolling at 1920×1080 and 1280×720, still usable at 1024×768 (4:3 projectors).

- **Hero:** an animated cross-section of the paddy and pipe: soil, water level, both floats lighting up when wet, the pump showing water flow when ON, and level marks at +10 / +5 / 0 / −15 / −20 cm.
- **Status strip:** mode, pump state + runtime, water zone, OK/fault, and Wi-Fi/MQTT status in live mode.
- **Water level chart over time:** the sawtooth, with threshold lines at +5 and −15 cm and the pump-ON periods shaded. In live mode the floats only give zones, so show zone bands and pump periods. Never draw a fake continuous level.
- **Logic panel:** the 4-row state table with the current row highlighted. This is how we explain the latch to the judges.
- **Sensor cards:** soil moisture, air temperature, humidity.
- **Crop timeline:** transplant → flowering → harvest, showing the current stage and mode.
- **Analytics:** cycle count, average drying and fill times, next irrigation estimate, total pump runtime and estimated water pumped (the pump flow rate is a setting).
- **Event log:** the last 20 events.
- **Controls:** mode buttons, manual pump, clear fault, scenario picker, speed.

**Scenarios** (simulation), each with a one-sentence caption for the judges:

1. Normal AWD cycle.
2. Flowering → FLOOD mode.
3. Float conflict fault.
4. Pump timeout (water source empty).
5. Stuck FLOAT_LOW, caught by the soil moisture backup.
6. Wi-Fi drop: the device keeps irrigating offline.

**Presentation mode**

- `F` toggles fullscreen.
- `P` toggles presentation mode, which hides the controls and enlarges the type.
- `Space` plays/pauses; `←` / `→` go to the previous/next scenario; `1`–`4` set the speed.
- The cursor hides after 3 s idle.
- A "guided tour" plays through the scenarios with their captions.

**UX/UI rules for projectors**

- Use high contrast, because projectors wash out pale colors. Dark theme by default, with a light theme toggle.
- At 1080p: body text at least 20 px, key numbers at least 48 px, lines at least 3 px.
- Show every state with a color, an icon and a label, never color alone.
- Keep colors consistent: water = blue, pump running = amber, OK = green, fault = red, idle = gray.
- Keep animation smooth and subtle, and respect `prefers-reduced-motion`.
- Use plain English on the main screen, with AWD explained in one line.

**Tech**

- `web/`: Vite + React + TypeScript, SVG for the cross-section, a small chart library (uPlot or Chart.js) and mqtt.js.
- Bundle every asset and font locally, with no CDNs, so it runs offline.
- `npm run build` makes the hosted site. `npm run build:single` (vite-plugin-singlefile) makes `presentation.html`, which opens with a double-click: no server, no internet.
- Tests: vitest for the simulator logic, using the shared test vectors. Check the layout at all three screen sizes (Playwright screenshots if available).

## 8. Repo, git and docs

```
smart-rice-farm/
  CLAUDE.md                      # short project memory: pins, safety rules, commands, layout
  README.md                      # what it is, quick start, demo steps
  docs/PROMPT.md                 # this prompt, verbatim
  docs/wiring.md                 # pin table, wiring diagram, electrical rules
  docs/mqtt.md                   # topic + JSON contract
  docs/control-logic.md          # state table, modes, safety, Mermaid state diagram
  docs/presentation.md           # how to run the demo + the scenario script for the judges
  firmware/                      # PlatformIO project
  web/                           # simulator + dashboard
  shared/awd-test-vectors.json   # used by BOTH the firmware native tests and the web tests
  tools/mqtt_logger.py           # subscribes and saves CSV for analysis
  tools/mosquitto/               # local broker config
  .github/workflows/             # firmware build check, web build + GitHub Pages deploy
```

- Run `git init` first. `.gitignore` covers `.pio/`, `node_modules/`, `dist/`, `firmware/include/secrets.h`, `.env` and OS files.
- Never commit secrets. Commit only `secrets.example.h` / `.env.example`. Wi-Fi and broker credentials come from the portal (stored in NVS) or from the ignored files.
- Commit in small steps after each thing that works, in Conventional Commits style (`feat(firmware): …`, `fix(web): …`). Every commit builds and passes its tests.
- Ask me before creating a GitHub repo or pushing. Tag `v1.0.0` when everything passes.
- Keep `CLAUDE.md` under about 100 lines and up to date.

## 9. Phases and acceptance

| # | Phase | Done when |
|---|---|---|
| 0 | Setup: repo, folders, CLAUDE.md, docs/PROMPT.md, .gitignore | First commit made |
| 1 | Core logic: `AwdController` (C++) + TypeScript port + shared test vectors | Native and vitest tests pass and cover every row of the state table, debounce, timeout, FLOOD mode and faults |
| 2 | Firmware bring-up, one part at a time: I2C scan, OLED, DHT11, raw soil value, raw floats, relay click with the pump disconnected, buzzer | `pio run` builds, and I confirm each part on the bench |
| 3 | Firmware control: logic wired to real I/O, safety, buzzer, NVS, OLED pages | Bench test passes with the floats moved by hand: pump disconnected first, then connected |
| 4 | Wi-Fi portal + MQTT + NTP + crop schedule + analytics | Works with MQTT Explorer or mosquitto_pub/sub, and the logger saves CSV |
| 5 | Web simulation: all panels, scenarios and presentation mode | Runs offline from `presentation.html`, and screenshots at all 3 sizes look right |
| 6 | Web live mode | Works end-to-end with the real device |
| 7 | Polish: README, wiring doc, presentation script, Pages deploy, tag | v1.0.0 tagged |

Out of scope unless I ask:

- user accounts or a cloud database
- a mobile app
- OTA firmware updates
- camera or vision
- phone notifications
- a continuous water-level sensor (possible later; keep the code ready for it)

## 10. Ask me first (one message, then wait)

1. Which ESP32-S3 board/module exactly (for example ESP32-S3-DevKitC-1 N16R8)? Are my relay and buzzer modules or bare parts?
2. MQTT broker: local Mosquitto on my laptop, or a cloud broker (for example HiveMQ Cloud)?
3. GitHub: should you create a repo and push? What should it be called?
4. Website: local only, or on GitHub Pages too?
