// Smart Rice Farm firmware entry point. Thin on purpose: App does the work.
#include <Arduino.h>
#include <ArduinoJson.h>

#include "Actuators.h"
#include "App.h"
#include "Display.h"
#include "config.h"

static App g_app;

static void printHelp() {
  Serial.println(
      "Commands:\n"
      "  help | status | net | test (toggle raw test page)\n"
      "  mode awd|flood|off        pump on <seconds> | pump off\n"
      "  clear                     clear a latched fault\n"
      "  mute <minutes> | unmute   cal dry | cal wet (soil calibration)\n"
      "  set <key> <value>         debounceS pumpMaxRunS pumpMinOffS soilDryAlertPct\n"
      "                            soilBackupDelayS soilBackupCanStartPump(true|false)\n"
      "  schedule <YYYY-MM-DD transplant> <YYYY-MM-DD flowering> | schedule clear\n"
      "  wifi reset                open the Wi-Fi setup portal (Phase 4)\n"
      "  reboot | json {\"cmd\":...}  raw MQTT-style JSON command");
}

static void printStatus() {
  const Snapshot s = g_app.snapshot();
  char d[12];
  Serial.printf("id=%s up=%lus mode=%s pump=%s%s run=%lus zone=%s low=%s high=%s\n", s.deviceId,
                (unsigned long)s.uptimeS, srf::modeName(s.mode), s.pump ? "ON" : "off", s.manual ? "(manual)" : "",
                (unsigned long)s.pumpRunS, srf::zoneName(s.zone), srf::floatName(s.low), srf::floatName(s.high));
  Serial.printf("fault=%s warnings=0x%lx soil=%d%% (raw %d, cal dry %d wet %d) air=%s\n",
                s.fault == srf::Fault::NONE ? "none" : srf::faultName(s.fault), (unsigned long)s.warnings, s.soilPct,
                s.soilRaw, s.soilCalDry, s.soilCalWet,
                s.dhtOk ? (String(s.airTempC, 1) + "C " + String(s.airRh, 0) + "%").c_str() : "DHT fail");
  formatDuration(s.avgDryingS, d, sizeof d);
  Serial.printf("cycles=%lu avgDrying=%s ", (unsigned long)s.totalCycles, d);
  formatDuration(s.avgFillS, d, sizeof d);
  Serial.printf("avgFill=%s nextPumpEst=%s muted=%s\n", d,
                s.nextIrrigationInS < 0 ? "none" : (String((long)s.nextIrrigationInS) + "s").c_str(),
                s.muted ? "yes" : "no");
}

// Turns a console line into the same JSON command the MQTT `cmd` topic uses.
static void handleLine(String line) {
  line.trim();
  if (line.isEmpty()) return;
  static bool testOn = false;
  JsonDocument cmd;
  String a[4];
  int n = 0, from = 0;
  while (n < 4 && from < (int)line.length()) {
    int sp = line.indexOf(' ', from);
    if (sp < 0) sp = line.length();
    if (sp > from) a[n++] = line.substring(from, sp);
    from = sp + 1;
  }
  a[0].toLowerCase();

  if (a[0] == "help") return printHelp();
  if (a[0] == "status") return printStatus();
  if (a[0] == "net") return g_app.printNet();
  if (a[0] == "json") {
    if (deserializeJson(cmd, line.substring(5))) {
      Serial.println("bad JSON");
      return;
    }
  } else if (a[0] == "test") {
    testOn = !testOn;
    cmd["cmd"] = "testPage";
    cmd["on"] = testOn;
  } else if (a[0] == "mode" && n == 2) {
    a[1].toUpperCase();
    cmd["cmd"] = "setMode";
    cmd["mode"] = a[1];
  } else if (a[0] == "pump" && n >= 2 && a[1] == "on") {
    cmd["cmd"] = "pump";
    cmd["on"] = true;
    cmd["seconds"] = n >= 3 ? a[2].toInt() : 10;
  } else if (a[0] == "pump" && n == 2 && a[1] == "off") {
    cmd["cmd"] = "pump";
    cmd["on"] = false;
  } else if (a[0] == "clear") {
    cmd["cmd"] = "clearFault";
  } else if (a[0] == "mute") {
    cmd["cmd"] = "mute";
    cmd["minutes"] = n >= 2 ? a[1].toInt() : 30;
  } else if (a[0] == "unmute") {
    cmd["cmd"] = "mute";
    cmd["minutes"] = 0;
  } else if (a[0] == "cal" && n == 2) {
    cmd["cmd"] = "calibrateSoil";
    cmd["point"] = a[1];
  } else if (a[0] == "set" && n == 3) {
    cmd["cmd"] = "setConfig";
    if (a[2] == "true" || a[2] == "false") cmd[a[1]] = a[2] == "true";
    else cmd[a[1]] = a[2].toInt();
  } else if (a[0] == "schedule" && n == 2 && a[1] == "clear") {
    cmd["cmd"] = "setSchedule";
    cmd["transplantDate"] = nullptr;
    cmd["floweringDate"] = nullptr;
  } else if (a[0] == "schedule" && n == 3) {
    cmd["cmd"] = "setSchedule";
    cmd["transplantDate"] = a[1];
    cmd["floweringDate"] = a[2];
  } else if (a[0] == "wifi" && n == 2 && a[1] == "reset") {
    cmd["cmd"] = "wifiPortal";
  } else if (a[0] == "reboot") {
    cmd["cmd"] = "reboot";
  } else {
    Serial.printf("unknown: '%s' (type help)\n", line.c_str());
    return;
  }
  JsonDocument ack;
  g_app.runCommand(cmd.as<JsonObjectConst>(), ack);  // the ack is printed as an [EVT] line
}

void setup() {
  Pump::beginSafe();  // FIRST: pump output OFF before anything else can happen
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== Smart Rice Farm %s ===\n", FW_VERSION);
  g_app.begin();
  printHelp();
}

void loop() {
  static String line;
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) handleLine(line);
      line = "";
    } else if (line.length() < 120) {
      line += c;
    }
  }
  g_app.loop();
}
