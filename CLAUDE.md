# Smart Rice Farm â€” project memory

AIoT Safe AWD irrigation for rice: ESP32-S3 firmware + web simulator/live dashboard.
Full spec: `docs/PROMPT.md`. Decisions below override the spec where they differ.

## Decisions (2026-11-19)
- Board: ESP32-S3 (QFN56 rev v0.2), 16 MB QIO flash, 8 MB embedded octal PSRAM (â‰ˆ N16R8).
  PlatformIO `esp32-s3-devkitc-1`, `board_build.arduino.memory_type = qio_opi`.
- USB: board's CH343 UART bridge on COM4. Device id: `srf-cc2468` (MAC d8:85:ac:cc:24:68).
- Pump: a pump module with pins IN / DC+ / DC- (no relay contacts). DC+/DC- go to a separate 5 V
  supply; IN goes to GPIO7. Common GND with the ESP32. Trigger polarity: config flag, check on the bench.
- Buzzer: active buzzer module with pins GND / I/O / VCC. Polarity: config flag (often active-LOW).
- Bench 2026-11-19 (bring-up fw): OLED 0x3C OK, DHT11 OK, soil raw ~2580 in air, BOOT OK,
  pump IN active-HIGH confirmed (ran 3 s), buzzer module active-LOW confirmed (3 s self-test at boot).
  Floats not yet tested by hand (both read OPEN at rest).
- Toolchain: PlatformIO's downloader stalls on this network. Fetch packages with curl and
  `pio pkg install -g -t <file>`, then fix `.piopm` spec to the registry owner/name/id.
- Broker: HiveMQ Cloud (TLS 8883 for the device, wss 8884 for the web). Local Mosquitto is a backup.
- Hosting: GitHub repo `smart-rice-farm` (public) â†’ Vercel (replaces GitHub Pages in the spec).

## Safety rules (never break)
- Pump OFF at boot (first line of setup), on any fault and on a crash (task watchdog on).
- `PUMP_MAX_RUN_S` timeout â†’ OFF + `PUMP_TIMEOUT`. Faults latch until `clearFault`.
- The control loop never blocks on Wi-Fi/MQTT/display. A failed sensor never stops irrigation.
- `AwdController` is pure C++ (no Arduino calls). Logic changes must update
  `shared/awd-test-vectors.json` and pass in both C++ and TS.

## Pins (firmware/include/config.h)
OLED SDA 8 / SCL 9 Â· Soil 1 (ADC1) Â· DHT11 4 Â· FLOAT_LOW 5 Â· FLOAT_HIGH 6 Â· Pump IN 7 Â· Buzzer 15 Â· BOOT 0

## Commands
- Firmware: `cd firmware && pio run`, `pio run -t upload --upload-port COM4`, `pio device monitor -b 115200`
- Firmware tests: `cd firmware && pio test -e native`
- Web: `cd web && npm run dev | npm test | npm run build | npm run build:single`

## Layout
docs/ firmware/ web/ shared/ tools/ .github/workflows/ â€” see docs/PROMPT.md Â§8.

## Git
Conventional Commits, small steps, every commit builds + passes tests. Never commit secrets
(`firmware/include/secrets.h`, `.env`). Ask before pushing.
