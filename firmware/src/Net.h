// Wi-Fi (WiFiManager portal), NTP and MQTT, running in their own FreeRTOS task on core 0.
// The control loop (core 1) talks to it only through queues and small locked buffers, so a slow
// TLS handshake, a broker outage or the setup portal can never stall irrigation.
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "Snapshot.h"

struct MqttSettings {
  char host[64] = "broker.hivemq.com";  // HiveMQ public broker: no account needed
  uint16_t port = 8883;
  char user[48] = "";
  char pass[64] = "";
  bool tls = true;
  bool insecure = false;  // skip certificate check: demos only
  char root[24] = "srf";   // topic root; a random one is generated on first boot
};

class Net {
 public:
  void begin(const char* deviceId);

  // ---- called from the control loop (core 1); never block ----
  void postEvent(const char* json);              // dropped if the queue is full
  void setState(const char* json);               // latest snapshot, published retained
  void setConfig(const char* json);              // config JSON, published retained
  bool popCommand(char* buf, size_t len);        // MQTT commands for App::runCommand
  NetStatus status();
  void requestPortal();
  void printDiagnostics();  // serial `net` command (password never printed)
  // Serial-only: change the topic root (nullptr or "" = new random one). Applied by the net task,
  // which first clears the retained messages under the old root.
  void requestNewRoot(const char* root);

  // ---- internal (net task) ----
  void taskLoop();

 private:
  void startPortal(bool fromFailure);
  void mqttStep(uint32_t nowMs);
  void loadSettings();
  void saveSettings();
  void updateStatus();
  void topic(char* out, size_t len, const char* leaf) const;

  char deviceId_[16] = "";
  char apName_[32] = "";
  MqttSettings mqtt_;
  bool settingsChanged_ = false;
};
