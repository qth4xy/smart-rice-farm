// OPTIONAL development defaults. Copy to secrets.h (git-ignored) and fill in.
// At the venue nothing here is needed: Wi-Fi and MQTT settings are entered in the
// Wi-Fi setup portal and stored in NVS, which always takes priority over these.
#pragma once

#define SRF_MQTT_HOST "xxxxxxxx.s1.eu.hivemq.cloud"
#define SRF_MQTT_PORT 8883
#define SRF_MQTT_USER "srf-device"
#define SRF_MQTT_PASS "change-me"
#define SRF_MQTT_TLS 1
