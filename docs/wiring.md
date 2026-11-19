# Wiring

Board: ESP32-S3 dev board (16 MB flash, 8 MB PSRAM). Program and power it through the USB port
marked **UART/COM** (CH343 chip, appears as COM4 on the development PC).

## Pin table

All pins are defined in `firmware/include/config.h`.

| Part | Part pin | ESP32-S3 | Notes |
|---|---|---|---|
| OLED SSD1306 (I2C) | VCC | 3V3 | |
| | GND | GND | |
| | SDA | GPIO8 | |
| | SCL | GPIO9 | address 0x3C (0x3D also tried) |
| Soil moisture (capacitive) | VCC | 3V3 | 3.3 V keeps AOUT inside the ADC range |
| | GND | GND | |
| | AOUT | GPIO1 | ADC1 (ADC2 can't be used with Wi-Fi) |
| DHT11 | VCC | 3V3 | |
| | GND | GND | |
| | DATA | GPIO4 | a bare 4-pin DHT11 needs 10 kΩ from DATA to 3V3; a 3-pin module already has it |
| FLOAT_LOW (−15 cm) | wire 1 | GPIO5 | internal pull-up |
| | wire 2 | GND | |
| FLOAT_HIGH (+5 cm) | wire 1 | GPIO6 | internal pull-up |
| | wire 2 | GND | |
| Pump module | IN | GPIO7 | HIGH = pump runs (check on the bench, `PUMP_ACTIVE_HIGH`) |
| | DC+ | + of the separate 5 V pump supply | |
| | DC− | − of the pump supply **and** ESP32 GND | common ground is required for IN to work |
| Buzzer module | VCC | 3V3 | |
| | GND | GND | |
| | I/O | GPIO15 | polarity: `BUZZER_ACTIVE_HIGH` (many 3-pin modules beep on LOW) |
| BOOT button | onboard | GPIO0 | hold 5 s while running → Wi-Fi setup portal |

Do not use: GPIO0/3/45/46 as outputs (strapping), GPIO19/20 (native USB), GPIO26–37
(flash/PSRAM), GPIO38/48 (onboard RGB LED).

## Diagram

```
                 ESP32-S3 dev board
               ┌─────────────────────┐
  OLED SDA ────┤ GPIO8          3V3  ├──── VCC: OLED, soil, DHT11, buzzer
  OLED SCL ────┤ GPIO9          GND  ├──┬─ GND: all parts
  Soil AOUT ───┤ GPIO1               │  │
  DHT DATA ────┤ GPIO4               │  │
  FLOAT_LOW ───┤ GPIO5               │  ├─ other wire of both floats
  FLOAT_HIGH ──┤ GPIO6               │  │
  Pump IN ─────┤ GPIO7               │  │
  Buzzer I/O ──┤ GPIO15              │  │
               └─────────────────────┘  │
                                        │
  5 V pump supply (+) ── Pump module DC+ │
  5 V pump supply (−) ── Pump module DC− ┘   (common ground)
```

## Electrical rules

1. ESP32 logic is 3.3 V. Power the OLED, DHT11, soil sensor and buzzer from **3V3**, never 5 V.
2. The pump gets its own 5 V supply (a separate USB charger or power bank) through the pump
   module's DC+/DC−. Pump current must never flow through the ESP32 board.
3. Connect the pump supply's − to ESP32 GND. Without a common ground, IN does nothing or acts
   randomly.
4. A motor needs a flyback diode (1N4007 or 1N5819, cathode/stripe to +) across its terminals.
   Many pump modules already have one; check the board, and add one across the pump wires if not.
5. The firmware drives the pump pin to "off" as the very first thing at boot. If the pump still
   twitches at power-on, add a 10 kΩ resistor from GPIO7 to GND.
6. If the pump module doesn't switch reliably from 3.3 V, drive IN through an NPN transistor (or
   a logic-level MOSFET) and tell us, so the polarity flag can be updated.
7. Put the electronics in a waterproof box. Only the floats and the soil probe touch water or soil.

## Observation pipe

- 30 cm perforated pipe, 10–15 cm diameter, wrapped in mesh, buried 20 cm deep (10 cm above
  the soil).
- FLOAT_LOW at 5 cm from the pipe bottom (−15 cm), FLOAT_HIGH at 25 cm (+5 cm).
- Mount the floats so that "water at or above the float" gives a clear switch state. If WET
  turns out to mean OPEN, flip `FLOAT_LOW_CLOSED_IS_WET` / `FLOAT_HIGH_CLOSED_IS_WET`.
- **This build (bench-verified 2026-11-20):** the vertical reed floats are mounted normally-closed:
  switch CLOSED when dry, OPEN in water, so both flags are `false`. This is fail-safe: a broken
  float wire reads WET, so the pump does not start and the field cannot overflow (the soil
  moisture check still warns if the field dries out).
- The OLED main page and the dashboard show each float's raw switch (OPEN/CLOSED) for wiring
  checks. The serial command `pinscan` reports which GPIO a wire touched to GND is on.
