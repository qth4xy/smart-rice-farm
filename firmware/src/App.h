// The application hub: owns the controller, analytics, I/O modules and storage, runs the
// non-blocking main loop and executes commands from the serial console (and MQTT in Phase 4).
#pragma once
#include <ArduinoJson.h>
#include <stdint.h>

#include "Actuators.h"
#include "Analytics.h"
#include "AwdController.h"
#include "Display.h"
#include "Sensors.h"
#include "Snapshot.h"
#include "Storage.h"

class App {
 public:
  using EventSink = void (*)(const char* name, JsonObjectConst detail);

  void begin();
  void loop();

  // Validates and runs one JSON command. Fills `ack` with {cmd, ok, error?}.
  void runCommand(JsonObjectConst cmd, JsonDocument& ack);
  Snapshot snapshot() const;
  void setEventSink(EventSink s) { sink_ = s; }
  NetStatus& net() { return net_; }
  const char* deviceId() const { return deviceId_; }

 private:
  uint64_t nowMs() const;
  void controlStep(uint64_t now);
  void handleEvents(uint32_t ev, const char* reason);
  void emit(const char* name, JsonObjectConst detail);
  void emitSimple(const char* name, const char* key = nullptr, const char* value = nullptr);
  void persist();
  void applySchedule();
  bool applyMode(srf::Mode m, const char* reason);

  srf::AwdController ctl_;
  srf::Analytics analytics_;
  Sensors sensors_;
  Pump pump_;
  Buzzer buzzer_;
  Display display_;
  Storage storage_;
  PersistedSettings settings_;
  NetStatus net_;
  EventSink sink_ = nullptr;
  char deviceId_[16] = "";

  uint64_t lastCtl_ = 0;
  uint32_t lastSchedule_ = 0;
  srf::CropStage lastStage_ = srf::CropStage::NONE;
  bool stageInit_ = false;
  uint32_t lastWarnings_ = 0;
  bool rebootPending_ = false;
  uint32_t rebootAt_ = 0;
};
