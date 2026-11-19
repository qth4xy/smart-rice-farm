// All pins and defaults in one place. See docs/wiring.md.
#pragma once
#include <stdint.h>

#define FW_VERSION "0.2.0"

// ---------------- Pins ----------------
constexpr int PIN_I2C_SDA = 8;
constexpr int PIN_I2C_SCL = 9;
constexpr int PIN_SOIL = 1;        // ADC1_CH0 (ADC2 is unusable with Wi-Fi)
constexpr int PIN_DHT = 4;
constexpr int PIN_FLOAT_LOW = 5;   // INPUT_PULLUP, other wire to GND
constexpr int PIN_FLOAT_HIGH = 6;  // INPUT_PULLUP, other wire to GND
constexpr int PIN_PUMP = 7;        // pump module IN
constexpr int PIN_BUZZER = 15;     // buzzer module I/O
constexpr int PIN_BOOT = 0;        // onboard BOOT button, input only after boot

// ---------------- Polarity (check on the bench) ----------------
// Pump module: true = IN HIGH runs the pump.
constexpr bool PUMP_ACTIVE_HIGH = true;
// Buzzer module: true = I/O HIGH beeps. Bench-verified 2026-11-19: active-LOW
// (I/O held LOW = constant sound).
constexpr bool BUZZER_ACTIVE_HIGH = false;
// Buzzer self-test at power-on.
constexpr uint32_t BUZZER_SELFTEST_MS = 3000;
// Float switch closed (pin reads LOW with the pull-up) means WET?
constexpr bool FLOAT_LOW_CLOSED_IS_WET = true;
constexpr bool FLOAT_HIGH_CLOSED_IS_WET = true;

// ---------------- OLED ----------------
constexpr uint8_t OLED_ADDR_PRIMARY = 0x3C;
constexpr uint8_t OLED_ADDR_SECONDARY = 0x3D;

// ---------------- Control defaults (overridable over MQTT, stored in NVS) ----------------
constexpr uint32_t DEFAULT_DEBOUNCE_S = 3;
constexpr uint32_t DEFAULT_PUMP_MAX_RUN_S = 300;
constexpr uint32_t DEFAULT_PUMP_MIN_OFF_S = 60;
constexpr uint32_t DEFAULT_SOIL_DRY_ALERT_PCT = 30;
constexpr uint32_t DEFAULT_SOIL_BACKUP_DELAY_S = 600;
constexpr bool DEFAULT_SOIL_BACKUP_CAN_START_PUMP = false;
constexpr uint32_t FLOOD_AFTER_TRANSPLANT_DAYS = 14;
constexpr uint32_t FLOWERING_WINDOW_DAYS = 7;

// Soil calibration defaults (raw 12-bit ADC). Capacitive sensors read HIGH when dry.
constexpr int DEFAULT_SOIL_RAW_DRY = 3000;
constexpr int DEFAULT_SOIL_RAW_WET = 1300;

// ---------------- Timing ----------------
constexpr uint32_t FLOAT_POLL_MS = 50;
constexpr uint32_t SOIL_POLL_MS = 2000;
constexpr int SOIL_SAMPLES = 16;
constexpr uint32_t DHT_POLL_MS = 5000;  // never faster than 2000
constexpr uint32_t OLED_REFRESH_MS = 250;
constexpr uint32_t OLED_PAGE_MS = 4000;
constexpr uint32_t TELEMETRY_MS = 10000;
constexpr uint32_t WDT_TIMEOUT_S = 10;
