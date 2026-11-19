// Phase 2 bring-up firmware: test each part on its own.
// Serial 115200. Type `help`. The full controller replaces this in Phase 3.
#include <Arduino.h>
#include <DHT.h>
#include <U8g2lib.h>
#include <Wire.h>

#include "config.h"

static void pumpWrite(bool on) { digitalWrite(PIN_PUMP, (on == PUMP_ACTIVE_HIGH) ? HIGH : LOW); }
static void buzzerWrite(bool on) { digitalWrite(PIN_BUZZER, (on == BUZZER_ACTIVE_HIGH) ? HIGH : LOW); }

static U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, PIN_I2C_SCL, PIN_I2C_SDA);
static DHT dht(PIN_DHT, DHT11);
static uint8_t oledAddr = 0;
static bool pumpOn = false;
static bool live = true;
static float tC = NAN, rh = NAN;
static int soilRaw = -1;

static void i2cScan() {
  Serial.println("I2C scan (SDA=8, SCL=9):");
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  found device at 0x%02X\n", a);
      n++;
    }
  }
  if (!n) Serial.println("  no devices found - check wiring and 3.3V/GND");
}

static uint8_t findOled() {
  for (uint8_t a : {OLED_ADDR_PRIMARY, OLED_ADDR_SECONDARY}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) return a;
  }
  return 0;
}

static int readSoil() {
  long sum = 0;
  for (int i = 0; i < SOIL_SAMPLES; i++) sum += analogRead(PIN_SOIL);
  return static_cast<int>(sum / SOIL_SAMPLES);
}

static void beep(int n, int ms = 80) {
  for (int i = 0; i < n; i++) {
    buzzerWrite(true);
    delay(ms);
    buzzerWrite(false);
    delay(ms);
  }
}

static void help() {
  Serial.println(
      "Commands:\n"
      "  help         this list\n"
      "  scan         I2C scan\n"
      "  pump on|off  switch the pump output (pump DISCONNECTED first!)\n"
      "  beep [n]     n short beeps\n"
      "  buzz on|off  hold the buzzer output\n"
      "  buzz high|low  raw GPIO15 level (polarity test)\n"
      "  tone [Hz]    1.5 s square wave (passive buzzer test)\n"
      "  live on|off  print readings every second\n");
}

static void handleLine(String s) {
  s.trim();
  if (s == "help" || s.isEmpty()) help();
  else if (s == "scan") i2cScan();
  else if (s == "pump on") { pumpOn = true; pumpWrite(true); Serial.println("PUMP OUTPUT ON"); }
  else if (s == "pump off") { pumpOn = false; pumpWrite(false); Serial.println("PUMP OUTPUT OFF"); }
  else if (s.startsWith("beep")) beep(s.length() > 5 ? s.substring(5).toInt() : 1);
  else if (s == "buzz on") buzzerWrite(true);
  else if (s == "buzz off") buzzerWrite(false);
  else if (s == "buzz high") { noTone(PIN_BUZZER); digitalWrite(PIN_BUZZER, HIGH); Serial.println("GPIO15 HIGH"); }
  else if (s == "buzz low") { noTone(PIN_BUZZER); digitalWrite(PIN_BUZZER, LOW); Serial.println("GPIO15 LOW"); }
  else if (s.startsWith("tone")) {  // for a passive buzzer: tone [Hz]
    int hz = s.length() > 5 ? s.substring(5).toInt() : 2700;
    tone(PIN_BUZZER, hz, 1500);
    Serial.printf("tone %d Hz 1.5 s\n", hz);
  }
  else if (s == "live on") live = true;
  else if (s == "live off") live = false;
  else Serial.printf("unknown: '%s' (type help)\n", s.c_str());
}

void setup() {
  // Safety first: pump output inactive before anything else.
  pinMode(PIN_PUMP, OUTPUT);
  pumpWrite(false);
  pinMode(PIN_BUZZER, OUTPUT);
  buzzerWrite(false);

  pinMode(PIN_FLOAT_LOW, INPUT_PULLUP);
  pinMode(PIN_FLOAT_HIGH, INPUT_PULLUP);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);

  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== Smart Rice Farm bring-up %s ===\n", FW_VERSION);
  Serial.printf("PSRAM: %u bytes, flash: %u bytes\n", ESP.getPsramSize(), ESP.getFlashChipSize());

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  i2cScan();
  oledAddr = findOled();
  if (oledAddr) {
    oled.setI2CAddress(oledAddr << 1);
    oled.begin();
    Serial.printf("OLED at 0x%02X\n", oledAddr);
  } else {
    Serial.println("OLED not found at 0x3C/0x3D");
  }
  dht.begin();
  help();
}

void loop() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) handleLine(line);
      line = "";
    } else if (line.length() < 64) {
      line += c;
    }
  }

  static uint32_t lastDht = 0, lastPrint = 0;
  const uint32_t now = millis();
  if (now - lastDht >= DHT_POLL_MS || lastDht == 0) {
    lastDht = now;
    tC = dht.readTemperature();
    rh = dht.readHumidity();
  }
  if (now - lastPrint < 1000) return;
  lastPrint = now;

  soilRaw = readSoil();
  const int fl = digitalRead(PIN_FLOAT_LOW), fh = digitalRead(PIN_FLOAT_HIGH);
  const int boot = digitalRead(PIN_BOOT);
  // Closed switch pulls the pin LOW.
  const char* flS = (fl == LOW) ? "CLOSED" : "OPEN";
  const char* fhS = (fh == LOW) ? "CLOSED" : "OPEN";

  if (live) {
    Serial.printf("floatLow=%s(%d) floatHigh=%s(%d) soilRaw=%d dht=%s boot=%s pump=%s\n", flS, fl, fhS,
                  fh, soilRaw,
                  isnan(tC) ? "FAIL" : String(String(tC, 1) + "C/" + String(rh, 0) + "%").c_str(),
                  boot == LOW ? "PRESSED" : "up", pumpOn ? "ON" : "off");
  }

  if (oledAddr) {
    oled.clearBuffer();
    oled.setFont(u8g2_font_6x10_tf);
    oled.drawBox(0, 0, 128, 16);
    oled.setDrawColor(0);
    oled.drawStr(2, 12, "SRF BRING-UP");
    oled.setDrawColor(1);
    char b[32];
    snprintf(b, sizeof b, "LOW : %s", flS);
    oled.drawStr(0, 27, b);
    snprintf(b, sizeof b, "HIGH: %s", fhS);
    oled.drawStr(0, 38, b);
    snprintf(b, sizeof b, "Soil raw: %d", soilRaw);
    oled.drawStr(0, 49, b);
    if (isnan(tC)) snprintf(b, sizeof b, "DHT: FAIL  P:%s", pumpOn ? "ON" : "off");
    else snprintf(b, sizeof b, "%.1fC %.0f%%  P:%s", tC, rh, pumpOn ? "ON" : "off");
    oled.drawStr(0, 60, b);
    oled.sendBuffer();
  }
}
