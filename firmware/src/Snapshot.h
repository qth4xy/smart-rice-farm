// One read-only view of the whole device state, used by the OLED, the serial console and
// (Phase 4) the MQTT `state` message.
#pragma once
#include <stdint.h>

#include "AwdTypes.h"
#include "CropSchedule.h"

struct NetStatus {
  bool wifiConnected = false;
  bool portalActive = false;
  bool mqttConnected = false;
  bool timeValid = false;
  int rssi = 0;
  char ssid[33] = "";
  char ip[16] = "";
  char apName[32] = "";
};

struct Snapshot {
  uint32_t uptimeS = 0;
  int64_t epoch = 0;  // 0 = no valid time yet
  srf::Mode mode = srf::Mode::AWD;
  bool pump = false;
  bool manual = false;
  bool filling = false;
  uint32_t pumpRunS = 0;
  srf::FloatState low = srf::FloatState::UNKNOWN;
  srf::FloatState high = srf::FloatState::UNKNOWN;
  srf::Zone zone = srf::Zone::UNKNOWN;
  srf::Fault fault = srf::Fault::NONE;
  uint32_t warnings = 0;  // controller + analytics
  int lowRaw = 1, highRaw = 1;
  int soilRaw = -1, soilPct = -1;
  int soilCalDry = 0, soilCalWet = 0;
  float airTempC = 0, airRh = 0;
  bool dhtOk = false;
  uint32_t cycles = 0, totalCycles = 0, avgDryingS = 0, avgFillS = 0;
  int64_t nextIrrigationInS = -1;  // -1 = no estimate
  srf::CropStage stage = srf::CropStage::NONE;
  bool muted = false;
  NetStatus net;
  char deviceId[16] = "";
};
