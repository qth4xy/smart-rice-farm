// Floats, soil moisture and DHT11. Never blocks for long; failures are reported, not fatal.
#pragma once
#include <math.h>
#include <stdint.h>

struct SensorReadings {
  bool lowWet = false;   // polarity-mapped float states (before debounce)
  bool highWet = false;
  int lowRaw = 1;        // raw digitalRead (LOW = switch closed)
  int highRaw = 1;
  int soilRaw = -1;      // averaged 12-bit ADC, -1 = not read yet
  int soilPct = -1;      // -1 = invalid
  float airTempC = NAN;
  float airRh = NAN;
  bool dhtOk = false;
  uint32_t dhtFailCount = 0;
};

class Sensors {
 public:
  void begin();
  void pollFloats();             // every FLOAT_POLL_MS
  void poll(uint32_t nowMs);     // soil + DHT on their own schedules
  const SensorReadings& r() const { return r_; }

  // Float polarity: does a CLOSED switch mean WET? Per float, calibratable (NVS).
  void setFloatPolarity(bool lowClosedIsWet, bool highClosedIsWet) {
    lowClosedIsWet_ = lowClosedIsWet;
    highClosedIsWet_ = highClosedIsWet;
  }
  bool lowClosedIsWet() const { return lowClosedIsWet_; }
  bool highClosedIsWet() const { return highClosedIsWet_; }

  void setSoilCal(int rawDry, int rawWet);
  int soilRawDry() const { return rawDry_; }
  int soilRawWet() const { return rawWet_; }
  int readSoilRawNow();          // fresh averaged reading (for calibration)

 private:
  int soilPctFromRaw(int raw) const;
  SensorReadings r_;
  int rawDry_ = 3000;
  int rawWet_ = 1300;
  uint32_t lastSoil_ = 0;
  uint32_t lastDht_ = 0;
  uint32_t lastDhtOk_ = 0;
  bool first_ = true;
  bool lowClosedIsWet_ = true;
  bool highClosedIsWet_ = true;
};
