#include "Display.h"

#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>
#include <stdio.h>

#include "config.h"

using namespace srf;

static U8G2_SSD1306_128X64_NONAME_F_HW_I2C g_oled(U8G2_R0, U8X8_PIN_NONE, PIN_I2C_SCL, PIN_I2C_SDA);

void formatDuration(uint32_t s, char* out, unsigned len) {
  if (s < 60) snprintf(out, len, "%lus", (unsigned long)s);
  else if (s < 3600) snprintf(out, len, "%lum%02lus", (unsigned long)(s / 60), (unsigned long)(s % 60));
  else if (s < 86400) snprintf(out, len, "%luh%02lum", (unsigned long)(s / 3600), (unsigned long)(s / 60 % 60));
  else snprintf(out, len, "%lud%02luh", (unsigned long)(s / 86400), (unsigned long)(s / 3600 % 24));
}

bool Display::begin() {
  uint8_t addr = 0;
  for (uint8_t a : {OLED_ADDR_PRIMARY, OLED_ADDR_SECONDARY}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      addr = a;
      break;
    }
  }
  if (!addr) return ok_ = false;
  g_oled.setI2CAddress(addr << 1);
  g_oled.setBusClock(400000);
  g_oled.begin();
  return ok_ = true;
}

// Header in the top 16 px (the yellow band on two-colour modules).
void Display::header(const char* left, const char* right) {
  g_oled.setFont(u8g2_font_7x14B_tf);
  g_oled.drawStr(0, 12, left);
  if (right) g_oled.drawStr(128 - g_oled.getStrWidth(right), 12, right);
  g_oled.drawHLine(0, 15, 128);
}

// Pipe: -20 cm at y=62 ... +10 cm at y=18 (30 cm over 44 px).
static int levelY(int cm) { return 62 - (cm + 20) * 44 / 30; }

void Display::pageMain(const Snapshot& s) {
  char right[16];
  if (s.pump) snprintf(right, sizeof right, "PUMP %lus", (unsigned long)s.pumpRunS);
  else snprintf(right, sizeof right, "PUMP OFF");
  header(modeName(s.mode), right);

  // Pipe outline, soil line, water fill by zone, float markers.
  const int x = 6, w = 14, top = levelY(10), bot = levelY(-20);
  g_oled.drawFrame(x, top, w, bot - top + 1);
  g_oled.drawHLine(0, levelY(0), x);  // soil surface
  g_oled.drawHLine(x + w, levelY(0), 4);
  int fillTo = 999;
  switch (s.zone) {
    case Zone::BELOW: fillTo = -18; break;
    case Zone::BETWEEN: fillTo = -5; break;
    case Zone::ABOVE: fillTo = 7; break;
    default: break;
  }
  if (fillTo != 999) {
    const int y = levelY(fillTo);
    g_oled.drawBox(x + 2, y, w - 4, bot - y - 1);
  }
  for (int i = 0; i < 2; i++) {
    const int y = levelY(i == 0 ? -15 : 5);
    const FloatState st = i == 0 ? s.low : s.high;
    g_oled.setDrawColor(2);
    if (st == FloatState::WET) g_oled.drawDisc(x + w + 4, y, 2);
    else g_oled.drawCircle(x + w + 4, y, 2);
    g_oled.setDrawColor(1);
    g_oled.drawHLine(0, y, 4);
  }

  g_oled.setFont(u8g2_font_6x10_tf);
  char b[24];
  snprintf(b, sizeof b, "Zone %s", zoneName(s.zone));
  g_oled.drawStr(32, 27, b);
  const char* phase = s.manual ? "Manual run" : s.pump ? "Filling" : s.mode == Mode::OFF ? "Auto off" : "Drying";
  g_oled.drawStr(32, 39, phase);
  snprintf(b, sizeof b, "L:%s H:%s", s.low == FloatState::WET ? "WET" : s.low == FloatState::DRY ? "DRY" : "?",
           s.high == FloatState::WET ? "WET" : s.high == FloatState::DRY ? "DRY" : "?");
  g_oled.drawStr(32, 51, b);
  g_oled.setFont(u8g2_font_7x14B_tf);
  g_oled.drawStr(32, 63, s.warnings ? "OK  WARN" : "OK");
}

void Display::pageSensors(const Snapshot& s) {
  header("SENSORS", nullptr);
  char b[24];
  g_oled.setFont(u8g2_font_7x14B_tf);
  if (s.soilPct >= 0) snprintf(b, sizeof b, "Soil  %d%%", s.soilPct);
  else snprintf(b, sizeof b, "Soil  --");
  g_oled.drawStr(0, 32, b);
  if (s.dhtOk) {
    snprintf(b, sizeof b, "Air   %.1f C", s.airTempC);
    g_oled.drawStr(0, 47, b);
    snprintf(b, sizeof b, "Humid %.0f%%", s.airRh);
    g_oled.drawStr(0, 62, b);
  } else {
    g_oled.drawStr(0, 47, "Air   --");
    g_oled.setFont(u8g2_font_6x10_tf);
    g_oled.drawStr(0, 62, "DHT11 read failed");
  }
}

void Display::pageNetwork(const Snapshot& s) {
  header("NETWORK", nullptr);
  g_oled.setFont(u8g2_font_5x8_tf);  // 25 chars x 6 lines
  char b[40];
  if (s.net.portalActive) {
    g_oled.drawStr(0, 24, "Setup portal open. Join:");
    g_oled.drawStr(0, 32, s.net.apName);
    g_oled.drawStr(0, 40, "then open 192.168.4.1");
    g_oled.drawStr(0, 48, "Irrigation keeps running");
  } else if (s.net.wifiConnected) {
    snprintf(b, sizeof b, "%.16s %ddBm", s.net.ssid, s.net.rssi);
    g_oled.drawStr(0, 24, b);
    snprintf(b, sizeof b, "IP %s", s.net.ip);
    g_oled.drawStr(0, 32, b);
    snprintf(b, sizeof b, "MQTT %s", s.net.mqttConnected ? "connected" : "offline");
    g_oled.drawStr(0, 40, b);
    snprintf(b, sizeof b, "Clock %s", s.net.timeValid ? "synced" : "not synced");
    g_oled.drawStr(0, 48, b);
  } else {
    g_oled.drawStr(0, 24, "Wi-Fi: offline");
    g_oled.drawStr(0, 32, "Irrigation runs");
    g_oled.drawStr(0, 40, "without network");
  }
  snprintf(b, sizeof b, "Root %s", s.net.topicRoot);
  g_oled.drawStr(0, 56, b);
  snprintf(b, sizeof b, "ID %s", s.deviceId);
  g_oled.drawStr(0, 64, b);
}

void Display::pageAnalytics(const Snapshot& s) {
  header("CYCLES", nullptr);
  g_oled.setFont(u8g2_font_6x10_tf);
  char b[32], d[12];
  if (s.nextIrrigationInS >= 0) {
    formatDuration(static_cast<uint32_t>(s.nextIrrigationInS), d, sizeof d);
    snprintf(b, sizeof b, "Next pump ~%s (est.)", d);
  } else {
    snprintf(b, sizeof b, "Next pump: no estimate");
  }
  g_oled.drawStr(0, 27, b);
  if (s.cycles) {
    formatDuration(s.avgDryingS, d, sizeof d);
    snprintf(b, sizeof b, "Avg drying %s", d);
    g_oled.drawStr(0, 39, b);
    formatDuration(s.avgFillS, d, sizeof d);
    snprintf(b, sizeof b, "Avg fill   %s", d);
    g_oled.drawStr(0, 51, b);
  } else {
    g_oled.drawStr(0, 39, "No full cycle yet");
  }
  snprintf(b, sizeof b, "Cycles %lu", (unsigned long)s.totalCycles);
  g_oled.drawStr(0, 63, b);
}

void Display::pageFault(const Snapshot& s, uint32_t nowMs) {
  // Blinking inverted header so the fault is visible from a distance.
  if ((nowMs / 500) % 2 == 0) {
    g_oled.drawBox(0, 0, 128, 15);
    g_oled.setDrawColor(0);
  }
  g_oled.setFont(u8g2_font_7x14B_tf);
  g_oled.drawStr(28, 12, "!! FAULT !!");
  g_oled.setDrawColor(1);
  g_oled.drawStr(0, 32, faultName(s.fault));
  g_oled.setFont(u8g2_font_6x10_tf);
  g_oled.drawStr(0, 45, "Pump is OFF.");
  g_oled.drawStr(0, 57, "Fix it, then clearFault");
}

void Display::pageTest(const Snapshot& s) {
  header("TEST", "raw");
  g_oled.setFont(u8g2_font_6x10_tf);
  char b[32];
  snprintf(b, sizeof b, "LOW  pin=%d %s", s.lowRaw, s.lowRaw ? "OPEN" : "CLOSED");
  g_oled.drawStr(0, 27, b);
  snprintf(b, sizeof b, "HIGH pin=%d %s", s.highRaw, s.highRaw ? "OPEN" : "CLOSED");
  g_oled.drawStr(0, 39, b);
  snprintf(b, sizeof b, "Soil raw=%d pct=%d", s.soilRaw, s.soilPct);
  g_oled.drawStr(0, 51, b);
  snprintf(b, sizeof b, "Cal dry=%d wet=%d", s.soilCalDry, s.soilCalWet);
  g_oled.drawStr(0, 63, b);
}

void Display::update(uint32_t nowMs, const Snapshot& s) {
  if (!ok_ || nowMs - lastDraw_ < OLED_REFRESH_MS) return;
  lastDraw_ = nowMs;
  if (nowMs - pageSince_ >= OLED_PAGE_MS) {
    pageSince_ = nowMs;
    page_ = (page_ + 1) % 4;
  }
  g_oled.clearBuffer();
  g_oled.setDrawColor(1);
  if (test_) pageTest(s);
  else if (s.fault != Fault::NONE) pageFault(s, nowMs);
  else switch (page_) {
      case 0: pageMain(s); break;
      case 1: pageSensors(s); break;
      case 2: pageNetwork(s); break;
      default: pageAnalytics(s); break;
    }
  g_oled.sendBuffer();
}
