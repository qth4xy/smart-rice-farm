#include "Analytics.h"

namespace srf {

uint32_t Analytics::avg(bool drying, int n) const {
  if (n <= 0) return 0;
  uint64_t sum = 0;
  for (int i = 0; i < n; i++) {
    const Cycle& c = ring_[(head_ - 1 - i + kMaxCycles) % kMaxCycles];
    sum += drying ? c.dryingS : c.fillS;
  }
  return static_cast<uint32_t>((sum + n / 2) / n);
}

uint32_t Analytics::avgDryingS() const { return avg(true, count_); }
uint32_t Analytics::avgFillS() const { return avg(false, count_); }

uint64_t Analytics::nextIrrigationAtMs() const {
  if (phase_ != Phase::DRYING || count_ == 0) return 0;
  return lastOff_ + static_cast<uint64_t>(avgDryingS()) * 1000;
}

void Analytics::push(const Cycle& c) {
  ring_[head_] = c;
  head_ = (head_ + 1) % kMaxCycles;
  if (count_ < kMaxCycles) count_++;
  total_++;
}

int Analytics::history(Cycle* out, int max) const {
  int n = count_ < max ? count_ : max;
  for (int i = 0; i < n; i++) out[i] = ring_[(head_ - n + i + kMaxCycles) % kMaxCycles];
  return n;
}

void Analytics::restore(const Cycle* cycles, int n, uint32_t total) {
  head_ = 0;
  count_ = 0;
  for (int i = 0; i < n && i < kMaxCycles; i++) push(cycles[i]);
  total_ = total > static_cast<uint32_t>(count_) ? total : count_;
}

uint32_t Analytics::update(uint64_t nowMs, Mode mode, bool pump, bool manual, FloatState low,
                           FloatState high) {
  uint32_t ev = 0;
  const bool rising = pump && !prevPump_;
  const bool falling = !pump && prevPump_;
  prevPump_ = pump;

  // Only clean automatic AWD cycles are measured.
  if (mode != Mode::AWD || manual) {
    phase_ = Phase::IDLE;
    pendingValid_ = false;
    if (pump) runManual_ = runManual_ || manual;
    if (falling) runManual_ = false;
    return 0;
  }

  // 1) Drying ends when FLOAT_LOW goes DRY.
  if (phase_ == Phase::DRYING && low == FloatState::DRY) {
    pendingDryingS_ = static_cast<uint32_t>((nowMs - dryStart_) / 1000);
    pendingValid_ = true;
    phase_ = Phase::WAIT_PUMP;
  }

  // 2) Fill ends when FLOAT_HIGH goes WET.
  if (phase_ == Phase::FILLING && high == FloatState::WET) {
    const uint32_t fillS = static_cast<uint32_t>((nowMs - fillStart_) / 1000);
    if (pendingValid_ && !runManual_) {
      const Cycle c{pendingDryingS_, fillS};
      uint32_t w = 0;
      if (count_ >= kMinCyclesForAnomaly) {
        const uint32_t aFill = avgFillS(), aDry = avgDryingS();
        if (c.fillS > 2 * aFill) w |= Warn::SLOW_FILL;
        if (2 * c.dryingS < aDry) w |= Warn::FAST_DRAIN;
      }
      push(c);
      ev |= Ev::CYCLE_COMPLETE;
      if (w & ~warnings_) ev |= Ev::WARNING;
      warnings_ = w;
    }
    pendingValid_ = false;
    phase_ = Phase::FILLED;
  }

  // 3) Pump edges.
  if (rising) {
    runManual_ = false;
    if (phase_ != Phase::WAIT_PUMP) pendingValid_ = false;
    phase_ = Phase::FILLING;
    fillStart_ = nowMs;
  } else if (falling) {
    if (phase_ == Phase::FILLED && !runManual_) {
      phase_ = Phase::DRYING;
      dryStart_ = nowMs;
      lastOff_ = nowMs;
    } else {
      phase_ = Phase::IDLE;
    }
    runManual_ = false;
    pendingValid_ = false;
  }
  return ev;
}

}  // namespace srf
