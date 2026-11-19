// AWD cycle analytics: drying time (pump OFF -> FLOAT_LOW DRY) and fill time
// (pump ON -> FLOAT_HIGH WET), averages over the last 10 cycles, next-irrigation
// estimate and simple anomaly flags. Pure C++, no Arduino calls.
#pragma once
#include <stdint.h>

#include "AwdTypes.h"

namespace srf {

struct Cycle {
  uint32_t dryingS;
  uint32_t fillS;
};

class Analytics {
 public:
  static constexpr int kMaxCycles = 10;
  static constexpr int kMinCyclesForAnomaly = 3;

  // Call after every controller tick. Returns event flags (CYCLE_COMPLETE, WARNING).
  uint32_t update(uint64_t nowMs, Mode mode, bool pump, bool manual, FloatState low,
                  FloatState high);

  int count() const { return count_; }
  uint32_t totalCycles() const { return total_; }
  uint32_t avgDryingS() const;
  uint32_t avgFillS() const;
  uint32_t warnings() const { return warnings_; }
  // Monotonic ms of the estimated next pump start, or 0 if no estimate.
  uint64_t nextIrrigationAtMs() const;

  // Oldest first. For NVS persistence.
  int history(Cycle* out, int max) const;
  void restore(const Cycle* cycles, int n, uint32_t total);

 private:
  enum class Phase : uint8_t { IDLE, FILLING, FILLED, DRYING, WAIT_PUMP };
  void push(const Cycle& c);
  uint32_t avg(bool drying, int n) const;

  Phase phase_ = Phase::IDLE;
  bool prevPump_ = false;
  bool runManual_ = false;
  uint64_t fillStart_ = 0;
  uint64_t dryStart_ = 0;
  uint64_t lastOff_ = 0;
  bool pendingValid_ = false;
  uint32_t pendingDryingS_ = 0;

  Cycle ring_[kMaxCycles] = {};
  int head_ = 0;  // next write position
  int count_ = 0;
  uint32_t total_ = 0;
  uint32_t warnings_ = 0;
};

}  // namespace srf
