#include "App.h"

#include <Arduino.h>
#include <Wire.h>
#include <esp_mac.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <math.h>
#include <string.h>
#include <time.h>

#include <initializer_list>

#include "config.h"

using namespace srf;

static constexpr int64_t kBangkokOffsetS = 7 * 3600;  // UTC+7, no DST
static constexpr int64_t kMinValidEpoch = 1700000000;

uint64_t App::nowMs() const { return static_cast<uint64_t>(esp_timer_get_time() / 1000); }

void App::begin() {
  buzzer_.begin();
  // Buzzer self-test at power-on (before the watchdog is armed).
  digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_HIGH ? HIGH : LOW);
  delay(BUZZER_SELFTEST_MS);
  digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_HIGH ? LOW : HIGH);

  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  snprintf(deviceId_, sizeof deviceId_, "srf-%02x%02x%02x", mac[3], mac[4], mac[5]);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!display_.begin()) Serial.println("[WARN] OLED not found at 0x3C/0x3D, continuing without it");

  // Defaults from config.h, then whatever NVS has.
  settings_.awd.debounceS = DEFAULT_DEBOUNCE_S;
  settings_.awd.pumpMaxRunS = DEFAULT_PUMP_MAX_RUN_S;
  settings_.awd.pumpMinOffS = DEFAULT_PUMP_MIN_OFF_S;
  settings_.awd.soilDryAlertPct = DEFAULT_SOIL_DRY_ALERT_PCT;
  settings_.awd.soilBackupDelayS = DEFAULT_SOIL_BACKUP_DELAY_S;
  settings_.awd.soilBackupCanStartPump = DEFAULT_SOIL_BACKUP_CAN_START_PUMP;
  settings_.soilRawDry = DEFAULT_SOIL_RAW_DRY;
  settings_.soilRawWet = DEFAULT_SOIL_RAW_WET;
  if (storage_.begin()) {
    storage_.load(settings_);
    storage_.loadAnalytics(analytics_);
  } else {
    Serial.println("[WARN] NVS unavailable, using defaults");
  }
  ctl_.setConfig(settings_.awd);
  ctl_.setMode(settings_.mode);

  sensors_.begin();
  sensors_.setSoilCal(settings_.soilRawDry, settings_.soilRawWet);
  pinMode(PIN_BOOT, INPUT_PULLUP);

  net_.begin(deviceId_);  // runs on core 0; never blocks this loop
  publishConfig();

  // Task watchdog: a hung loop resets the chip, and boot drives the pump OFF first.
  esp_task_wdt_config_t wdt = {};
  wdt.timeout_ms = WDT_TIMEOUT_S * 1000;
  wdt.idle_core_mask = 0;
  wdt.trigger_panic = true;
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
  esp_task_wdt_add(nullptr);

  JsonDocument d;
  d["fw"] = FW_VERSION;
  d["mode"] = modeName(ctl_.mode());
  d["reset"] = static_cast<int>(esp_reset_reason());
  emit("boot", d.as<JsonObjectConst>());
}

void App::loop() {
  esp_task_wdt_reset();
  const uint32_t ms = millis();
  const uint64_t now = nowMs();

  if (now - lastCtl_ >= FLOAT_POLL_MS) {
    lastCtl_ = now;
    controlStep(now);
  }
  sensors_.poll(ms);
  buzzer_.update(ms);

  if (ms - lastSchedule_ >= 60000UL || lastSchedule_ == 0) {
    lastSchedule_ = ms ? ms : 1;
    applySchedule();
  }

  pollMqttCommands();
  pollBootButton(ms);

  if (ms - lastSnap_ >= OLED_REFRESH_MS || lastSnap_ == 0) {
    lastSnap_ = ms ? ms : 1;
    const Snapshot s = snapshot();
    display_.update(ms, s);
    publishState(s);
  }

  if (rebootPending_ && static_cast<int32_t>(ms - rebootAt_) >= 0) {
    pump_.set(false);
    ESP.restart();
  }
}

void App::controlStep(uint64_t now) {
  sensors_.pollFloats();
  const SensorReadings& r = sensors_.r();
  AwdInputs in;
  in.lowWet = r.lowWet;
  in.highWet = r.highWet;
  in.soilPct = r.soilPct;
  uint32_t ev = ctl_.tick(now, in);
  pump_.set(ctl_.pump());
  ev |= analytics_.update(now, ctl_.mode(), ctl_.pump(), ctl_.manualActive(), ctl_.floatLow(), ctl_.floatHigh());
  handleEvents(ev, nullptr);
}

void App::handleEvents(uint32_t ev, const char* reason) {
  const uint32_t ms = millis();
  if (ev & Ev::PUMP_ON) {
    buzzer_.beeps(1);
    JsonDocument d;
    d["reason"] = ctl_.manualActive() ? "manual" : (reason ? reason : "auto");
    d["mode"] = modeName(ctl_.mode());
    emit("pump_on", d.as<JsonObjectConst>());
  }
  if (ev & Ev::PUMP_OFF) {
    buzzer_.beeps(2);
    JsonDocument d;
    d["runS"] = static_cast<uint32_t>((ctl_.pumpOffSinceMs() - ctl_.pumpOnSinceMs()) / 1000);
    if (ctl_.fault() != Fault::NONE) d["reason"] = "fault";
    emit("pump_off", d.as<JsonObjectConst>());
  }
  if (ev & Ev::FAULT) {
    buzzer_.setFaultAlarm(true, ms);
    JsonDocument d;
    d["fault"] = faultName(ctl_.fault());
    emit("fault", d.as<JsonObjectConst>());
  }
  if (ev & Ev::FAULT_CLEARED) {
    buzzer_.setFaultAlarm(ctl_.fault() != Fault::NONE, ms);
    emitSimple("fault_cleared");
  }
  const uint32_t w = ctl_.warnings() | analytics_.warnings();
  if ((ev & Ev::WARNING) || w != lastWarnings_) {
    if (w & ~lastWarnings_) {
      JsonDocument d;
      JsonArray a = d["warnings"].to<JsonArray>();
      if (w & Warn::FLOAT_LOW_SUSPECT) a.add("FLOAT_LOW_SUSPECT");
      if (w & Warn::SLOW_FILL) a.add("SLOW_FILL");
      if (w & Warn::FAST_DRAIN) a.add("FAST_DRAIN");
      emit("warning", d.as<JsonObjectConst>());
      buzzer_.beeps(1);
    }
    lastWarnings_ = w;
  }
  if (ev & Ev::CYCLE_COMPLETE) {
    Cycle last[Analytics::kMaxCycles];
    const int n = analytics_.history(last, Analytics::kMaxCycles);
    JsonDocument d;
    if (n > 0) {
      d["dryingS"] = last[n - 1].dryingS;
      d["fillS"] = last[n - 1].fillS;
    }
    d["avgDryingS"] = analytics_.avgDryingS();
    d["avgFillS"] = analytics_.avgFillS();
    d["cycles"] = analytics_.totalCycles();
    emit("cycle_complete", d.as<JsonObjectConst>());
    storage_.saveAnalytics(analytics_);
  }
}

void App::emit(const char* name, JsonObjectConst detail) {
  JsonDocument d;
  d["event"] = name;
  for (JsonPairConst kv : detail) d[kv.key()] = kv.value();
  const time_t t = time(nullptr);
  if (t >= kMinValidEpoch) d["ts"] = static_cast<int64_t>(t);
  char buf[384];
  const size_t n = serializeJson(d, buf, sizeof buf);
  Serial.print("[EVT] ");
  Serial.println(buf);
  if (n < sizeof buf - 1) net_.postEvent(buf);
}

void App::publishConfig() {
  JsonDocument d;
  const AwdConfig& c = ctl_.config();
  d["fw"] = FW_VERSION;
  d["deviceId"] = deviceId_;
  d["mode"] = modeName(ctl_.mode());
  d["debounceS"] = c.debounceS;
  d["pumpMaxRunS"] = c.pumpMaxRunS;
  d["pumpMinOffS"] = c.pumpMinOffS;
  d["soilDryAlertPct"] = c.soilDryAlertPct;
  d["soilBackupDelayS"] = c.soilBackupDelayS;
  d["soilBackupCanStartPump"] = c.soilBackupCanStartPump;
  d["floodAfterTransplantDays"] = FLOOD_AFTER_TRANSPLANT_DAYS;
  d["floweringWindowDays"] = FLOWERING_WINDOW_DAYS;
  char date[11];
  int y;
  unsigned mo, da;
  if (settings_.transplantDay != kNoDate && settings_.floweringDay != kNoDate) {
    civilFromDays(settings_.transplantDay, y, mo, da);
    snprintf(date, sizeof date, "%04d-%02u-%02u", y, mo, da);
    d["transplantDate"] = date;
    civilFromDays(settings_.floweringDay, y, mo, da);
    snprintf(date, sizeof date, "%04d-%02u-%02u", y, mo, da);
    d["floweringDate"] = date;
  } else {
    d["transplantDate"] = nullptr;
    d["floweringDate"] = nullptr;
  }
  d["soilRawDry"] = settings_.soilRawDry;
  d["soilRawWet"] = settings_.soilRawWet;
  char buf[768];
  serializeJson(d, buf, sizeof buf);
  net_.setConfig(buf);
}

// Telemetry: immediately on any discrete state change, otherwise every TELEMETRY_MS.
void App::publishState(const Snapshot& s) {
  const uint32_t ms = millis();
  const uint32_t key = static_cast<uint32_t>(s.mode) | static_cast<uint32_t>(s.pump) << 2 |
                       static_cast<uint32_t>(s.zone) << 3 | static_cast<uint32_t>(s.fault) << 6 |
                       s.warnings << 8 | static_cast<uint32_t>(s.manual) << 12 |
                       static_cast<uint32_t>(s.low) << 13 | static_cast<uint32_t>(s.high) << 15 |
                       static_cast<uint32_t>(s.muted) << 17 | static_cast<uint32_t>(s.stage) << 18 |
                       static_cast<uint32_t>(s.net.mqttConnected) << 22;
  if (key == lastStateKey_ && ms - lastTelemetry_ < TELEMETRY_MS) return;
  lastStateKey_ = key;
  lastTelemetry_ = ms ? ms : 1;

  JsonDocument d;
  if (s.epoch) d["ts"] = s.epoch;
  else d["ts"] = nullptr;
  d["mode"] = modeName(s.mode);
  d["pump"] = s.pump;
  d["pumpRunS"] = s.pumpRunS;
  d["manual"] = s.manual;
  d["filling"] = s.filling;
  d["floatLow"] = floatName(s.low);
  d["floatHigh"] = floatName(s.high);
  d["zone"] = zoneName(s.zone);
  if (s.fault == Fault::NONE) d["fault"] = nullptr;
  else d["fault"] = faultName(s.fault);
  JsonArray w = d["warnings"].to<JsonArray>();
  if (s.warnings & Warn::FLOAT_LOW_SUSPECT) w.add("FLOAT_LOW_SUSPECT");
  if (s.warnings & Warn::SLOW_FILL) w.add("SLOW_FILL");
  if (s.warnings & Warn::FAST_DRAIN) w.add("FAST_DRAIN");
  if (s.soilPct >= 0) d["soilPct"] = s.soilPct;
  else d["soilPct"] = nullptr;
  d["soilRaw"] = s.soilRaw;
  if (s.dhtOk) {
    d["airTempC"] = roundf(s.airTempC * 10) / 10;
    d["airRh"] = roundf(s.airRh);
  } else {
    d["airTempC"] = nullptr;
    d["airRh"] = nullptr;
  }
  if (s.nextIrrigationInS >= 0 && s.epoch) d["nextIrrigationEta"] = s.epoch + s.nextIrrigationInS;
  else d["nextIrrigationEta"] = nullptr;
  d["avgDryingS"] = s.avgDryingS;
  d["avgFillS"] = s.avgFillS;
  d["cycles"] = s.totalCycles;
  d["stage"] = stageName(s.stage);
  d["muted"] = s.muted;
  if (s.net.wifiConnected) d["rssi"] = s.net.rssi;
  else d["rssi"] = nullptr;
  d["uptimeS"] = s.uptimeS;
  d["fw"] = FW_VERSION;
  char buf[1024];
  serializeJson(d, buf, sizeof buf);
  net_.setState(buf);
}

void App::pollMqttCommands() {
  char buf[512];
  for (int i = 0; i < 2 && net_.popCommand(buf, sizeof buf); i++) {
    JsonDocument cmd, ack;
    if (deserializeJson(cmd, buf) || !cmd.is<JsonObject>()) {
      ack["cmd"] = nullptr;
      ack["ok"] = false;
      ack["error"] = "invalid JSON";
      emit("ack", ack.as<JsonObjectConst>());
      continue;
    }
    runCommand(cmd.as<JsonObjectConst>(), ack);
  }
}

// Hold BOOT for 5 s while running -> Wi-Fi setup portal.
void App::pollBootButton(uint32_t ms) {
  const bool down = digitalRead(PIN_BOOT) == LOW;
  if (!down) {
    bootDown_ = false;
    bootFired_ = false;
    return;
  }
  if (!bootDown_) {
    bootDown_ = true;
    bootSince_ = ms;
  } else if (!bootFired_ && ms - bootSince_ >= 5000) {
    bootFired_ = true;
    buzzer_.beeps(1);
    net_.requestPortal();
    emitSimple("portal", "reason", "button");
  }
}

void App::emitSimple(const char* name, const char* key, const char* value) {
  JsonDocument d;
  if (key) d[key] = value;
  emit(name, d.as<JsonObjectConst>());
}

void App::persist() {
  settings_.awd = ctl_.config();
  settings_.mode = ctl_.mode();
  storage_.save(settings_);
  publishConfig();
}

bool App::applyMode(Mode m, const char* reason) {
  const uint32_t ev = ctl_.setMode(m);
  if (!ev) return false;
  persist();
  JsonDocument d;
  d["mode"] = modeName(m);
  d["reason"] = reason;
  emit("mode_changed", d.as<JsonObjectConst>());
  return true;
}

void App::applySchedule() {
  const time_t t = time(nullptr);
  if (t < kMinValidEpoch) return;  // no NTP time yet (Phase 4)
  const int32_t today = static_cast<int32_t>((static_cast<int64_t>(t) + kBangkokOffsetS) / 86400);
  const StageResult r = cropStage(today, settings_.transplantDay, settings_.floweringDay,
                                  FLOOD_AFTER_TRANSPLANT_DAYS, FLOWERING_WINDOW_DAYS);
  // Act only when the stage changes, so a manual mode change holds until the next stage.
  if (stageInit_ && r.stage == lastStage_) return;
  stageInit_ = true;
  lastStage_ = r.stage;
  if (r.hasMode) applyMode(r.mode, "schedule");
}

Snapshot App::snapshot() {
  Snapshot s;
  const uint64_t now = nowMs();
  s.uptimeS = static_cast<uint32_t>(now / 1000);
  const time_t t = time(nullptr);
  s.epoch = t >= kMinValidEpoch ? static_cast<int64_t>(t) : 0;
  s.mode = ctl_.mode();
  s.pump = ctl_.pump();
  s.manual = ctl_.manualActive();
  s.filling = ctl_.filling();
  s.pumpRunS = ctl_.pumpRunS(now);
  s.low = ctl_.floatLow();
  s.high = ctl_.floatHigh();
  s.zone = ctl_.zone();
  s.fault = ctl_.fault();
  s.warnings = ctl_.warnings() | analytics_.warnings();
  const SensorReadings& r = sensors_.r();
  s.lowRaw = r.lowRaw;
  s.highRaw = r.highRaw;
  s.soilRaw = r.soilRaw;
  s.soilPct = r.soilPct;
  s.soilCalDry = sensors_.soilRawDry();
  s.soilCalWet = sensors_.soilRawWet();
  s.dhtOk = r.dhtOk;
  s.airTempC = r.airTempC;
  s.airRh = r.airRh;
  s.cycles = analytics_.count();
  s.totalCycles = analytics_.totalCycles();
  s.avgDryingS = analytics_.avgDryingS();
  s.avgFillS = analytics_.avgFillS();
  const uint64_t eta = analytics_.nextIrrigationAtMs();
  s.nextIrrigationInS = eta == 0 ? -1 : (eta > now ? static_cast<int64_t>((eta - now) / 1000) : 0);
  s.stage = lastStage_;
  s.muted = buzzer_.muted(millis());
  s.net = net_.status();
  strncpy(s.deviceId, deviceId_, sizeof s.deviceId - 1);
  return s;
}

// ---------------- Commands ----------------

static bool onlyKeys(JsonObjectConst o, std::initializer_list<const char*> keys, const char*& bad) {
  for (JsonPairConst kv : o) {
    bool found = false;
    for (const char* k : keys) found = found || strcmp(kv.key().c_str(), k) == 0;
    if (!found) {
      bad = kv.key().c_str();
      return false;
    }
  }
  return true;
}

void App::runCommand(JsonObjectConst cmd, JsonDocument& ack) {
  ack.clear();
  const char* name = cmd["cmd"] | "";
  ack["cmd"] = name;
  const char* err = nullptr;
  const char* bad = nullptr;
  const uint64_t now = nowMs();
  static char errBuf[48];

  auto badField = [&](const char* k) {
    snprintf(errBuf, sizeof errBuf, "unknown field '%s'", k);
    return errBuf;
  };

  if (!strcmp(name, "setMode")) {
    Mode m;
    if (!onlyKeys(cmd, {"cmd", "mode"}, bad)) err = badField(bad);
    else if (!cmd["mode"].is<const char*>() || !parseMode(cmd["mode"], m)) err = "mode must be AWD, FLOOD or OFF";
    else {
      applyMode(m, "command");
      ack["mode"] = modeName(m);
    }
  } else if (!strcmp(name, "pump")) {
    if (!onlyKeys(cmd, {"cmd", "on", "seconds"}, bad)) err = badField(bad);
    else if (!cmd["on"].is<bool>()) err = "'on' must be true or false";
    else if (cmd["on"].as<bool>()) {
      if (!cmd["seconds"].is<uint32_t>() || cmd["seconds"].as<uint32_t>() < 1 || cmd["seconds"].as<uint32_t>() > 3600)
        err = "'seconds' must be an integer 1..3600";
      else if (!ctl_.manualPump(true, cmd["seconds"].as<uint32_t>(), now)) err = "rejected: a fault is active";
      else ack["seconds"] = min(cmd["seconds"].as<uint32_t>(), ctl_.config().pumpMaxRunS);
    } else {
      ctl_.manualPump(false, 0, now);
    }
  } else if (!strcmp(name, "clearFault")) {
    if (!onlyKeys(cmd, {"cmd"}, bad)) err = badField(bad);
    else handleEvents(ctl_.clearFault(), "command");
  } else if (!strcmp(name, "setConfig")) {
    AwdConfig c = ctl_.config();
    int n = 0;
    for (JsonPairConst kv : cmd) {
      const char* k = kv.key().c_str();
      JsonVariantConst v = kv.value();
      if (!strcmp(k, "cmd")) continue;
      n++;
      auto u32In = [&](uint32_t lo, uint32_t hi, uint32_t& out) {
        if (!v.is<uint32_t>() || v.as<uint32_t>() < lo || v.as<uint32_t>() > hi) {
          snprintf(errBuf, sizeof errBuf, "'%s' must be an integer %lu..%lu", k, (unsigned long)lo, (unsigned long)hi);
          err = errBuf;
        } else {
          out = v.as<uint32_t>();
        }
      };
      if (!strcmp(k, "debounceS")) u32In(0, 60, c.debounceS);
      else if (!strcmp(k, "pumpMaxRunS")) u32In(10, 3600, c.pumpMaxRunS);
      else if (!strcmp(k, "pumpMinOffS")) u32In(0, 3600, c.pumpMinOffS);
      else if (!strcmp(k, "soilDryAlertPct")) u32In(0, 100, c.soilDryAlertPct);
      else if (!strcmp(k, "soilBackupDelayS")) u32In(60, 86400, c.soilBackupDelayS);
      else if (!strcmp(k, "soilBackupCanStartPump")) {
        if (!v.is<bool>()) err = "'soilBackupCanStartPump' must be true or false";
        else c.soilBackupCanStartPump = v.as<bool>();
      } else err = badField(k);
      if (err) break;
    }
    if (!err && n == 0) err = "no settings given";
    if (!err) {
      ctl_.setConfig(c);
      persist();
    }
  } else if (!strcmp(name, "setSchedule")) {
    int32_t tp = kNoDate, fl = kNoDate;
    if (!onlyKeys(cmd, {"cmd", "transplantDate", "floweringDate"}, bad)) err = badField(bad);
    else if (cmd["transplantDate"].isNull() && cmd["floweringDate"].isNull()) {
      // both null/missing = clear the schedule
    } else if (!parseDate(cmd["transplantDate"] | "", tp) || !parseDate(cmd["floweringDate"] | "", fl)) {
      err = "dates must be YYYY-MM-DD (or both null to clear)";
    } else if (fl <= tp) {
      err = "floweringDate must be after transplantDate";
    }
    if (!err) {
      settings_.transplantDay = tp;
      settings_.floweringDay = fl;
      persist();
      stageInit_ = false;
      lastStage_ = CropStage::NONE;
      applySchedule();
      ack["scheduled"] = tp != kNoDate;
    }
  } else if (!strcmp(name, "calibrateSoil")) {
    const char* p = cmd["point"] | "";
    if (!onlyKeys(cmd, {"cmd", "point"}, bad)) err = badField(bad);
    else if (strcmp(p, "dry") && strcmp(p, "wet")) err = "point must be 'dry' or 'wet'";
    else {
      const int raw = sensors_.readSoilRawNow();
      const int dry = !strcmp(p, "dry") ? raw : settings_.soilRawDry;
      const int wet = !strcmp(p, "wet") ? raw : settings_.soilRawWet;
      if (raw <= 50 || raw >= 4050) err = "sensor reading out of range (disconnected?)";
      else if (dry - wet < 200) err = "dry must read at least 200 higher than wet; calibrate the other point";
      if (!err) {
        settings_.soilRawDry = dry;
        settings_.soilRawWet = wet;
        sensors_.setSoilCal(dry, wet);
        persist();
      }
      ack["raw"] = raw;
    }
  } else if (!strcmp(name, "mute")) {
    if (!onlyKeys(cmd, {"cmd", "minutes"}, bad)) err = badField(bad);
    else if (!cmd["minutes"].is<uint32_t>() || cmd["minutes"].as<uint32_t>() > 1440) err = "'minutes' must be 0..1440";
    else buzzer_.mute(cmd["minutes"].as<uint32_t>(), millis());
  } else if (!strcmp(name, "testPage")) {
    if (!onlyKeys(cmd, {"cmd", "on"}, bad)) err = badField(bad);
    else if (!cmd["on"].is<bool>()) err = "'on' must be true or false";
    else display_.setTestPage(cmd["on"].as<bool>());
  } else if (!strcmp(name, "wifiPortal")) {
    if (!onlyKeys(cmd, {"cmd"}, bad)) err = badField(bad);
    else net_.requestPortal();
  } else if (!strcmp(name, "reboot")) {
    if (!onlyKeys(cmd, {"cmd"}, bad)) err = badField(bad);
    else {
      rebootPending_ = true;
      rebootAt_ = millis() + 500;
    }
  } else {
    err = *name ? "unknown command" : "missing 'cmd'";
  }

  ack["ok"] = err == nullptr;
  if (err) ack["error"] = err;
  emit("ack", ack.as<JsonObjectConst>());
}
