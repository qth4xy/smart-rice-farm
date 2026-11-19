#include "Net.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <string.h>
#include <time.h>

#include "ca_cert.h"
#include "config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

// ---------------- shared state between the two cores ----------------
namespace {
constexpr size_t EVT_LEN = 384;
constexpr size_t CMD_LEN = 512;
constexpr size_t STATE_LEN = 1024;
constexpr size_t CFG_LEN = 768;
struct EvtMsg { char s[EVT_LEN]; };
struct CmdMsg { char s[CMD_LEN]; };

QueueHandle_t g_evtQ = nullptr;
QueueHandle_t g_cmdQ = nullptr;
SemaphoreHandle_t g_lock = nullptr;
char g_state[STATE_LEN] = "";
bool g_stateDirty = false;
char g_cfg[CFG_LEN] = "";
bool g_cfgDirty = false;
NetStatus g_status;
portMUX_TYPE g_statusMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool g_portalReq = false;

// ---------------- net-task-only objects ----------------
WiFiManager g_wm;
WiFiClient g_plain;
WiFiClientSecure g_secure;
PubSubClient g_mqtt;
Net* g_self = nullptr;
TaskHandle_t netTaskHandle = nullptr;
char g_cmdTopic[48] = "";

WiFiManagerParameter* p_host;
WiFiManagerParameter* p_port;
WiFiManagerParameter* p_user;
WiFiManagerParameter* p_pass;
WiFiManagerParameter* p_tls;
WiFiManagerParameter* p_insecure;
WiFiManagerParameter* p_root;

bool validRoot(const char* s) {
  const size_t n = strlen(s);
  if (n < 3 || n > 23) return false;
  for (size_t i = 0; i < n; i++) {
    const char c = s[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
  }
  return true;
}

bool g_portalActive = false;
bool g_needSave = false;

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  if (strcmp(topic, g_cmdTopic) != 0) return;
  CmdMsg m{};
  if (len >= CMD_LEN) len = CMD_LEN - 1;
  memcpy(m.s, payload, len);
  m.s[len] = 0;
  xQueueSend(g_cmdQ, &m, 0);
}

void onPortalSave() { g_needSave = true; }

void netTask(void* arg) { static_cast<Net*>(arg)->taskLoop(); }
}  // namespace

// ---------------- API used by the control loop ----------------
void Net::begin(const char* deviceId) {
  strncpy(deviceId_, deviceId, sizeof deviceId_ - 1);
  snprintf(apName_, sizeof apName_, "SRF-Setup-%s", deviceId + 4);  // SRF-Setup-cc2468
  g_evtQ = xQueueCreate(16, sizeof(EvtMsg));
  g_cmdQ = xQueueCreate(4, sizeof(CmdMsg));
  g_lock = xSemaphoreCreateMutex();
  g_self = this;
  loadSettings();
  // Core 0, below the loop task's priority. 12 KB stack for TLS.
  xTaskCreatePinnedToCore(netTask, "net", 12288, this, 1, &netTaskHandle, 0);
}

void Net::postEvent(const char* json) {
  if (!g_evtQ || strlen(json) >= EVT_LEN) return;
  EvtMsg m{};
  strcpy(m.s, json);
  xQueueSend(g_evtQ, &m, 0);
}

void Net::setState(const char* json) {
  if (!g_lock || xSemaphoreTake(g_lock, 0) != pdTRUE) return;  // never wait; next tick retries
  strncpy(g_state, json, STATE_LEN - 1);
  g_stateDirty = true;
  xSemaphoreGive(g_lock);
}

void Net::setConfig(const char* json) {
  if (!g_lock || xSemaphoreTake(g_lock, pdMS_TO_TICKS(5)) != pdTRUE) return;
  strncpy(g_cfg, json, CFG_LEN - 1);
  g_cfgDirty = true;
  xSemaphoreGive(g_lock);
}

bool Net::popCommand(char* buf, size_t len) {
  CmdMsg m;
  if (!g_cmdQ || xQueueReceive(g_cmdQ, &m, 0) != pdTRUE) return false;
  strncpy(buf, m.s, len - 1);
  buf[len - 1] = 0;
  return true;
}

NetStatus Net::status() {
  NetStatus s;
  portENTER_CRITICAL(&g_statusMux);
  s = g_status;
  portEXIT_CRITICAL(&g_statusMux);
  return s;
}

void Net::requestPortal() { g_portalReq = true; }

void Net::printDiagnostics() {
  const NetStatus s = status();
  Serial.printf("wifi: saved=%s connected=%s ssid='%s' ip=%s rssi=%d portal=%s ap=%s\n",
                g_wm.getWiFiIsSaved() ? "yes" : "no", s.wifiConnected ? "yes" : "no", s.ssid, s.ip, s.rssi,
                s.portalActive ? "open" : "closed", s.apName);
  Serial.printf("mqtt: host='%s' port=%u user='%s' pass=%s tls=%d insecure=%d connected=%s state=%d time=%s\n"
                "topics: %s/%s/{state,event,config,status,cmd}\n",
                mqtt_.host, mqtt_.port, mqtt_.user, mqtt_.pass[0] ? "set" : "EMPTY", mqtt_.tls, mqtt_.insecure,
                s.mqttConnected ? "yes" : "no", g_mqtt.state(), s.timeValid ? "synced" : "not synced", mqtt_.root,
                deviceId_);
  Serial.printf("net task stack free: %lu bytes, heap free: %lu\n",
                (unsigned long)(netTaskHandle ? uxTaskGetStackHighWaterMark(netTaskHandle) : 0),
                (unsigned long)ESP.getFreeHeap());
}

// ---------------- settings (NVS namespace "srfnet") ----------------
void Net::loadSettings() {
#ifdef SRF_MQTT_HOST
  strncpy(mqtt_.host, SRF_MQTT_HOST, sizeof mqtt_.host - 1);
  mqtt_.port = SRF_MQTT_PORT;
  strncpy(mqtt_.user, SRF_MQTT_USER, sizeof mqtt_.user - 1);
  strncpy(mqtt_.pass, SRF_MQTT_PASS, sizeof mqtt_.pass - 1);
  mqtt_.tls = SRF_MQTT_TLS;
#endif
  Preferences p;
  if (!p.begin("srfnet", false)) return;
  // Topic root: random per device on first boot, so topics are not guessable on a public broker.
  if (p.isKey("root")) {
    p.getString("root", mqtt_.root, sizeof mqtt_.root);
  } else {
    snprintf(mqtt_.root, sizeof mqtt_.root, "srf-%08lx", (unsigned long)esp_random());
    p.putString("root", mqtt_.root);
  }
  if (p.isKey("host")) {
    p.getString("host", mqtt_.host, sizeof mqtt_.host);
    mqtt_.port = p.getUShort("port", mqtt_.port);
    p.getString("user", mqtt_.user, sizeof mqtt_.user);
    p.getString("pass", mqtt_.pass, sizeof mqtt_.pass);
    mqtt_.tls = p.getBool("tls", mqtt_.tls);
    mqtt_.insecure = p.getBool("insecure", mqtt_.insecure);
  }
  p.end();
}

void Net::saveSettings() {
  MqttSettings n = mqtt_;
  strncpy(n.host, p_host->getValue(), sizeof n.host - 1);
  n.host[sizeof n.host - 1] = 0;
  const long port = atol(p_port->getValue());
  if (port > 0 && port < 65536) n.port = static_cast<uint16_t>(port);
  strncpy(n.user, p_user->getValue(), sizeof n.user - 1);
  n.user[sizeof n.user - 1] = 0;
  if (strlen(p_pass->getValue()) > 0) {  // blank = keep the current password
    strncpy(n.pass, p_pass->getValue(), sizeof n.pass - 1);
    n.pass[sizeof n.pass - 1] = 0;
  }
  n.tls = strcmp(p_tls->getValue(), "0") != 0;
  n.insecure = strcmp(p_insecure->getValue(), "1") == 0;
  if (validRoot(p_root->getValue())) strncpy(n.root, p_root->getValue(), sizeof n.root - 1);

  Preferences p;
  if (p.begin("srfnet", false)) {
    p.putString("host", n.host);
    p.putUShort("port", n.port);
    p.putString("user", n.user);
    p.putString("pass", n.pass);
    p.putBool("tls", n.tls);
    p.putBool("insecure", n.insecure);
    p.putString("root", n.root);
    p.end();
  }
  mqtt_ = n;
  settingsChanged_ = true;
  Serial.printf("[NET] MQTT settings saved: %s:%u tls=%d user=%s root=%s\n", n.host, n.port, n.tls, n.user, n.root);
}

void Net::topic(char* out, size_t len, const char* leaf) const {
  snprintf(out, len, "%s/%s/%s", mqtt_.root, deviceId_, leaf);
}

// ---------------- the net task ----------------
void Net::startPortal(bool fromFailure) {
  if (g_portalActive) return;
  // With saved Wi-Fi, close the portal after 5 minutes and go back to retrying the network.
  g_wm.setConfigPortalTimeout(g_wm.getWiFiIsSaved() ? 300 : 0);
  g_wm.startConfigPortal(apName_);
  g_portalActive = true;
  Serial.printf("[NET] setup portal open: join Wi-Fi '%s' (%s)\n", apName_,
                fromFailure ? "Wi-Fi failed" : "requested");
}

void Net::updateStatus() {
  NetStatus s;
  s.wifiConnected = WiFi.status() == WL_CONNECTED;
  s.portalActive = g_portalActive;
  s.mqttConnected = g_mqtt.connected();
  s.timeValid = time(nullptr) > 1700000000;
  if (s.wifiConnected) {
    s.rssi = WiFi.RSSI();
    strncpy(s.ssid, WiFi.SSID().c_str(), sizeof s.ssid - 1);
    strncpy(s.ip, WiFi.localIP().toString().c_str(), sizeof s.ip - 1);
  }
  strncpy(s.apName, apName_, sizeof s.apName - 1);
  strncpy(s.topicRoot, mqtt_.root, sizeof s.topicRoot - 1);
  portENTER_CRITICAL(&g_statusMux);
  g_status = s;
  portEXIT_CRITICAL(&g_statusMux);
}

void Net::mqttStep(uint32_t now) {
  static uint32_t nextTry = 0, backoff = 2000;
  static bool wasConnected = false;
  char t[64];

  if (settingsChanged_) {
    settingsChanged_ = false;
    if (g_mqtt.connected()) g_mqtt.disconnect();
    nextTry = 0;
    backoff = 2000;
  }
  if (WiFi.status() != WL_CONNECTED || mqtt_.host[0] == 0) {
    wasConnected = false;
    return;
  }

  if (!g_mqtt.connected()) {
    if (wasConnected) {
      Serial.println("[NET] MQTT disconnected");
      wasConnected = false;
    }
    if (static_cast<int32_t>(now - nextTry) < 0) return;
    if (mqtt_.tls) {
      if (mqtt_.insecure) g_secure.setInsecure();
      else g_secure.setCACert(CA_BUNDLE);
      g_secure.setHandshakeTimeout(10);
      g_mqtt.setClient(g_secure);
    } else {
      g_mqtt.setClient(g_plain);
    }
    g_mqtt.setServer(mqtt_.host, mqtt_.port);
    g_mqtt.setBufferSize(1024);
    g_mqtt.setKeepAlive(30);
    g_mqtt.setSocketTimeout(5);
    g_mqtt.setCallback(onMqttMessage);
    topic(t, sizeof t, "status");
    const bool ok = g_mqtt.connect(deviceId_, mqtt_.user[0] ? mqtt_.user : nullptr,
                                   mqtt_.user[0] ? mqtt_.pass : nullptr, t, 1, true, "offline", true);
    if (!ok) {
      Serial.printf("[NET] MQTT connect to %s:%u failed (state %d), retry in %lus\n", mqtt_.host, mqtt_.port,
                    g_mqtt.state(), (unsigned long)(backoff / 1000));
      nextTry = now + backoff;
      backoff = backoff >= 30000 ? 60000 : backoff * 2;
      return;
    }
    Serial.printf("[NET] MQTT connected to %s:%u\n", mqtt_.host, mqtt_.port);
    wasConnected = true;
    backoff = 2000;
    g_mqtt.publish(t, "online", true);
    topic(g_cmdTopic, sizeof g_cmdTopic, "cmd");
    g_mqtt.subscribe(g_cmdTopic, 1);
    if (xSemaphoreTake(g_lock, pdMS_TO_TICKS(20)) == pdTRUE) {  // republish retained topics
      g_stateDirty = g_state[0] != 0;
      g_cfgDirty = g_cfg[0] != 0;
      xSemaphoreGive(g_lock);
    }
  }

  g_mqtt.loop();

  EvtMsg m;
  topic(t, sizeof t, "event");
  for (int i = 0; i < 6 && xQueueReceive(g_evtQ, &m, 0) == pdTRUE; i++) g_mqtt.publish(t, m.s, false);

  static char buf[STATE_LEN];
  bool sendState = false, sendCfg = false;
  if (xSemaphoreTake(g_lock, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (g_stateDirty) {
      strcpy(buf, g_state);
      g_stateDirty = false;
      sendState = true;
    }
    xSemaphoreGive(g_lock);
  }
  if (sendState) {
    topic(t, sizeof t, "state");
    g_mqtt.publish(t, buf, true);
  }
  if (xSemaphoreTake(g_lock, pdMS_TO_TICKS(5)) == pdTRUE) {
    if (g_cfgDirty) {
      strcpy(buf, g_cfg);
      g_cfgDirty = false;
      sendCfg = true;
    }
    xSemaphoreGive(g_lock);
  }
  if (sendCfg) {
    topic(t, sizeof t, "config");
    g_mqtt.publish(t, buf, true);
  }
}

void Net::taskLoop() {
  static char portStr[6], tlsStr[2], insecureStr[2];
  snprintf(portStr, sizeof portStr, "%u", mqtt_.port);
  snprintf(tlsStr, sizeof tlsStr, "%d", mqtt_.tls ? 1 : 0);
  snprintf(insecureStr, sizeof insecureStr, "%d", mqtt_.insecure ? 1 : 0);
  p_host = new WiFiManagerParameter("mqhost", "MQTT host", mqtt_.host, 63);
  p_port = new WiFiManagerParameter("mqport", "MQTT port (8883 TLS, 1883 plain)", portStr, 5);
  p_user = new WiFiManagerParameter("mquser", "MQTT user", mqtt_.user, 47);
  p_pass = new WiFiManagerParameter("mqpass", "MQTT password (blank = keep current)", "", 63);
  p_tls = new WiFiManagerParameter("mqtls", "TLS 1=on 0=off", tlsStr, 1);
  p_insecure = new WiFiManagerParameter("mqins", "Skip cert check (demo only) 1=yes", insecureStr, 1);
  p_root = new WiFiManagerParameter("mqroot", "Topic root (a-z 0-9 - _), keep it secret on a public broker", mqtt_.root, 23);
  for (auto* p : {p_host, p_port, p_user, p_pass, p_tls, p_insecure, p_root}) g_wm.addParameter(p);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  g_wm.setTitle("Smart Rice Farm");
  g_wm.setConfigPortalBlocking(false);
  g_wm.setSaveConfigCallback(onPortalSave);
  g_wm.setSaveParamsCallback(onPortalSave);
  g_wm.setConnectTimeout(15);
  g_wm.setDebugOutput(false);

  const bool saved = g_wm.getWiFiIsSaved();
  const uint32_t bootMs = millis();
  bool everConnected = false, failurePortalDone = false, servicesStarted = false;
  if (saved) {
    WiFi.begin();
    Serial.println("[NET] connecting to saved Wi-Fi");
  } else {
    startPortal(false);
  }

  for (;;) {
    const uint32_t now = millis();
    if (g_portalReq) {
      g_portalReq = false;
      startPortal(false);
    }
    if (g_portalActive) {
      g_wm.process();
      if (!g_wm.getConfigPortalActive()) {
        g_portalActive = false;
        Serial.println("[NET] setup portal closed");
        if (WiFi.status() != WL_CONNECTED) WiFi.begin();
      }
    }
    if (g_needSave) {
      g_needSave = false;
      saveSettings();
    }
    const bool connected = WiFi.status() == WL_CONNECTED;
    if (connected && !everConnected) {
      everConnected = true;
      Serial.printf("[NET] Wi-Fi connected: %s, IP %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
    }
    if (!connected && !everConnected && saved && !failurePortalDone && !g_portalActive && now - bootMs > 60000) {
      failurePortalDone = true;
      startPortal(true);
    }
    if (connected && !servicesStarted) {
      servicesStarted = true;
      configTzTime("<+07>-7", "pool.ntp.org", "time.google.com", "time.cloudflare.com");
      MDNS.begin("smartricefarm");
    }
    mqttStep(now);
    updateStatus();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
