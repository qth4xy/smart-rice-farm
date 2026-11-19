#include "Sensors.h"

#include <Arduino.h>
#include <DHT.h>

#include "config.h"

static DHT g_dht(PIN_DHT, DHT11);

void Sensors::begin() {
  pinMode(PIN_FLOAT_LOW, INPUT_PULLUP);
  pinMode(PIN_FLOAT_HIGH, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);
  g_dht.begin();
  pollFloats();
}

void Sensors::pollFloats() {
  r_.lowRaw = digitalRead(PIN_FLOAT_LOW);
  r_.highRaw = digitalRead(PIN_FLOAT_HIGH);
  const bool lowClosed = r_.lowRaw == LOW;
  const bool highClosed = r_.highRaw == LOW;
  r_.lowWet = lowClosedIsWet_ ? lowClosed : !lowClosed;
  r_.highWet = highClosedIsWet_ ? highClosed : !highClosed;
}

int Sensors::readSoilRawNow() {
  long sum = 0;
  for (int i = 0; i < SOIL_SAMPLES; i++) sum += analogRead(PIN_SOIL);
  return static_cast<int>(sum / SOIL_SAMPLES);
}

void Sensors::setSoilCal(int rawDry, int rawWet) {
  rawDry_ = rawDry;
  rawWet_ = rawWet;
  if (r_.soilRaw >= 0) r_.soilPct = soilPctFromRaw(r_.soilRaw);
}

int Sensors::soilPctFromRaw(int raw) const {
  // A disconnected input or a shorted sensor sits at the rails.
  if (raw <= 50 || raw >= 4050) return -1;
  const int span = rawDry_ - rawWet_;  // capacitive sensors read higher when dry
  if (span < 100) return -1;
  long pct = (static_cast<long>(rawDry_ - raw) * 100 + span / 2) / span;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return static_cast<int>(pct);
}

void Sensors::poll(uint32_t nowMs) {
  if (first_ || nowMs - lastSoil_ >= SOIL_POLL_MS) {
    lastSoil_ = nowMs;
    r_.soilRaw = readSoilRawNow();
    r_.soilPct = soilPctFromRaw(r_.soilRaw);
  }
  if (first_ || nowMs - lastDht_ >= DHT_POLL_MS) {
    lastDht_ = nowMs;
    const float t = g_dht.readTemperature();
    const float h = g_dht.readHumidity();
    if (isnan(t) || isnan(h)) {
      // The DHT11 misses an occasional read. Keep the last good value for up to DHT_STALE_MS,
      // then report the sensor as failed. Failures are always counted.
      r_.dhtFailCount++;
      if (!r_.dhtOk || nowMs - lastDhtOk_ > DHT_STALE_MS) {
        r_.dhtOk = false;
        r_.airTempC = NAN;
        r_.airRh = NAN;
      }
    } else {
      r_.dhtOk = true;
      lastDhtOk_ = nowMs;
      r_.airTempC = t;
      r_.airRh = h;
    }
  }
  first_ = false;
}
