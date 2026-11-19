// Safe AWD irrigation controller. Pure C++: no Arduino calls, no blocking, no I/O.
// The caller feeds float readings (already mapped to wet/dry) and a monotonic time in ms.
// Behaviour is specified by shared/awd-test-vectors.json and docs/control-logic.md.
#pragma once
#include <stdint.h>

#include "AwdTypes.h"

namespace srf {

struct AwdConfig {
  uint32_t debounceS = 3;          // a float state counts after being stable this long
  uint32_t pumpMaxRunS = 300;      // continuous auto run limit -> PUMP_TIMEOUT
  uint32_t pumpMinOffS = 60;       // FLOOD mode: minimum off time between runs
  uint32_t soilDryAlertPct = 30;   // soil backup threshold
  uint32_t soilBackupDelayS = 600; // soil must stay dry this long (10 min)
  bool soilBackupCanStartPump = false;
  // AWD timed fill: 0 = classic float table. >0 = when FLOAT_LOW is DRY, run the pump this many
  // seconds (stopping early if FLOAT_HIGH goes WET), then rest pumpMinOffS before the next fill.
  // For a build where FLOAT_HIGH is unavailable. Must be below pumpMaxRunS.
  uint32_t timedFillS = 0;
};

struct AwdInputs {
  bool lowWet = false;   // FLOAT_LOW (-15 cm) raw reading, already polarity-mapped
  bool highWet = false;  // FLOAT_HIGH (+5 cm)
  int soilPct = -1;      // soil moisture %, < 0 = invalid / not available
};

class Debouncer {
 public:
  // Returns true when the stable state changed.
  bool update(bool raw, uint64_t nowMs, uint32_t debounceMs);
  FloatState state() const { return stable_; }

 private:
  bool init_ = false;
  bool candidate_ = false;
  uint64_t since_ = 0;
  FloatState stable_ = FloatState::UNKNOWN;
};

class AwdController {
 public:
  explicit AwdController(const AwdConfig& cfg = AwdConfig()) : cfg_(cfg) {}

  void setConfig(const AwdConfig& cfg) { cfg_ = cfg; }
  const AwdConfig& config() const { return cfg_; }

  // --- commands (return event flags) ---
  uint32_t setMode(Mode m);
  // on=true: run for `seconds` (capped at pumpMaxRunS). Rejected (returns false) during a fault
  // or when seconds == 0. on=false: cancel a manual run and stop any auto fill.
  bool manualPump(bool on, uint32_t seconds, uint64_t nowMs);
  uint32_t clearFault();
  // Fill now: run the pump until FLOAT_HIGH reads WET (the latch keeps it on through the middle
  // band). It is an automatic run, so PUMP_TIMEOUT still applies. Rejected during a fault, in OFF
  // mode, or when FLOAT_HIGH is not DRY. Cancels a manual run.
  bool startFill();
  // Auto run time carried over from before a reset (the pump was running and the chip restarted).
  // It counts toward pumpMaxRunS, so repeated resets cannot keep a dry pump running forever.
  void setCarryRunMs(uint32_t ms) { carryMs_ = ms; }
  uint32_t carryRunMs() const { return carryMs_; }
  // Run time that would carry over if the chip reset now (0 when the pump is off).
  uint32_t unconfirmedRunMs(uint64_t nowMs) const {
    return pump_ ? carryMs_ + static_cast<uint32_t>(nowMs - pumpOnSince_) : 0;
  }

  // --- main step, call every ~50 ms ---
  uint32_t tick(uint64_t nowMs, const AwdInputs& in);

  // --- state ---
  Mode mode() const { return mode_; }
  bool pump() const { return pump_; }
  bool filling() const { return filling_; }
  bool manualActive() const { return manualActive_; }
  Fault fault() const { return fault_; }
  uint32_t warnings() const { return warnings_; }
  FloatState floatLow() const { return low_.state(); }
  FloatState floatHigh() const { return high_.state(); }
  Zone zone() const;
  uint32_t pumpRunS(uint64_t nowMs) const;
  uint64_t pumpOnSinceMs() const { return pumpOnSince_; }
  uint64_t pumpOffSinceMs() const { return pumpOffSince_; }

 private:
  uint32_t setPump(bool on, uint64_t nowMs);
  uint32_t raise(Fault f);

  AwdConfig cfg_;
  Mode mode_ = Mode::AWD;
  Debouncer low_, high_;
  bool pump_ = false;
  bool filling_ = false;   // the latch: true while a fill is in progress
  Fault fault_ = Fault::NONE;
  uint32_t warnings_ = 0;
  bool manualActive_ = false;
  uint64_t manualUntil_ = 0;
  uint64_t pumpOnSince_ = 0;
  uint64_t pumpOffSince_ = 0;
  bool pumpHasRun_ = false;
  uint32_t carryMs_ = 0;
  bool soilDryValid_ = false;
  uint64_t soilDrySince_ = 0;
};

}  // namespace srf
