#include "AwdController.h"

namespace srf {

bool Debouncer::update(bool raw, uint64_t nowMs, uint32_t debounceMs) {
  if (!init_ || raw != candidate_) {
    init_ = true;
    candidate_ = raw;
    since_ = nowMs;
  }
  FloatState c = candidate_ ? FloatState::WET : FloatState::DRY;
  if (c != stable_ && nowMs - since_ >= debounceMs) {
    stable_ = c;
    return true;
  }
  return false;
}

Zone AwdController::zone() const {
  FloatState l = low_.state(), h = high_.state();
  if (l == FloatState::UNKNOWN || h == FloatState::UNKNOWN) return Zone::UNKNOWN;
  if (l == FloatState::DRY && h == FloatState::DRY) return Zone::BELOW;
  if (l == FloatState::WET && h == FloatState::DRY) return Zone::BETWEEN;
  if (l == FloatState::WET && h == FloatState::WET) return Zone::ABOVE;
  return Zone::INVALID;
}

uint32_t AwdController::pumpRunS(uint64_t nowMs) const {
  return pump_ ? static_cast<uint32_t>((nowMs - pumpOnSince_) / 1000) : 0;
}

uint32_t AwdController::setMode(Mode m) {
  if (m == mode_) return 0;
  mode_ = m;
  if (m == Mode::OFF) filling_ = false;
  return Ev::MODE_CHANGED;
}

bool AwdController::manualPump(bool on, uint32_t seconds, uint64_t nowMs) {
  if (!on) {
    manualActive_ = false;
    filling_ = false;
    return true;
  }
  if (fault_ != Fault::NONE || seconds == 0) return false;
  if (seconds > cfg_.pumpMaxRunS) seconds = cfg_.pumpMaxRunS;
  manualActive_ = true;
  manualUntil_ = nowMs + static_cast<uint64_t>(seconds) * 1000;
  return true;
}

uint32_t AwdController::clearFault() {
  if (fault_ == Fault::NONE) return 0;
  fault_ = Fault::NONE;
  filling_ = false;
  carryMs_ = 0;
  return Ev::FAULT_CLEARED;
}

uint32_t AwdController::raise(Fault f) {
  if (fault_ != Fault::NONE) return 0;  // first fault wins, latched
  fault_ = f;
  return Ev::FAULT;
}

uint32_t AwdController::setPump(bool on, uint64_t nowMs) {
  if (on == pump_) return 0;
  pump_ = on;
  if (on) {
    pumpOnSince_ = nowMs;
    return Ev::PUMP_ON;
  }
  pumpOffSince_ = nowMs;
  pumpHasRun_ = true;
  carryMs_ = 0;  // a run that ended normally carries nothing over
  return Ev::PUMP_OFF;
}

uint32_t AwdController::tick(uint64_t nowMs, const AwdInputs& in) {
  uint32_t ev = 0;
  const uint32_t dbMs = cfg_.debounceS * 1000;
  low_.update(in.lowWet, nowMs, dbMs);
  high_.update(in.highWet, nowMs, dbMs);
  const FloatState lo = low_.state(), hi = high_.state();

  // Floats not yet known (boot): never pump.
  if (lo == FloatState::UNKNOWN || hi == FloatState::UNKNOWN) {
    return ev | setPump(false, nowMs);
  }

  // Row 4: impossible combination -> latched fault, in every mode.
  if (lo == FloatState::DRY && hi == FloatState::WET) ev |= raise(Fault::FLOAT_CONFLICT);

  // Soil moisture backup: soil dry for a long time while FLOAT_LOW still says WET.
  bool soilBackupKick = false;
  const bool soilDry = in.soilPct >= 0 && static_cast<uint32_t>(in.soilPct) < cfg_.soilDryAlertPct &&
                       lo == FloatState::WET;
  if (soilDry) {
    if (!soilDryValid_) {
      soilDryValid_ = true;
      soilDrySince_ = nowMs;
    }
    if (!(warnings_ & Warn::FLOAT_LOW_SUSPECT) &&
        nowMs - soilDrySince_ >= static_cast<uint64_t>(cfg_.soilBackupDelayS) * 1000) {
      warnings_ |= Warn::FLOAT_LOW_SUSPECT;
      ev |= Ev::WARNING;
      soilBackupKick = true;  // edge only, so it cannot loop
    }
  } else {
    soilDryValid_ = false;
    warnings_ &= ~Warn::FLOAT_LOW_SUSPECT;
  }

  // Any latched fault: pump off, nothing else runs.
  if (fault_ != Fault::NONE) {
    manualActive_ = false;
    filling_ = false;
    return ev | setPump(false, nowMs);
  }

  // Manual run has priority; it ends after its time and returns to the mode.
  if (manualActive_) {
    if (nowMs < manualUntil_) return ev | setPump(true, nowMs);
    manualActive_ = false;
    filling_ = false;
  }

  // Mode logic -> desired pump state via the fill latch.
  switch (mode_) {
    case Mode::OFF:
      filling_ = false;
      break;
    case Mode::AWD: {
      const bool timed = cfg_.timedFillS > 0;
      if (lo == FloatState::DRY && hi == FloatState::DRY) {  // row 1
        // Timed fill rests pumpMinOffS between runs, so a field that stays dry is not pumped nonstop.
        const bool restOk = !timed || !pumpHasRun_ ||
                            nowMs - pumpOffSince_ >= static_cast<uint64_t>(cfg_.pumpMinOffS) * 1000;
        if (!filling_ && restOk) filling_ = true;
      } else if (lo == FloatState::WET && hi == FloatState::WET) {
        filling_ = false;  // row 3
      }
      // row 2 (WET/DRY): keep the latch
      if (timed && filling_ && pump_ && nowMs - pumpOnSince_ >= static_cast<uint64_t>(cfg_.timedFillS) * 1000) {
        filling_ = false;  // timed fill done
      }
      if (soilBackupKick && cfg_.soilBackupCanStartPump && hi == FloatState::DRY) filling_ = true;
      break;
    }
    case Mode::FLOOD:
      if (hi == FloatState::WET) {
        filling_ = false;
      } else if (!filling_) {
        const bool minOffOk = !pumpHasRun_ ||
            nowMs - pumpOffSince_ >= static_cast<uint64_t>(cfg_.pumpMinOffS) * 1000;
        if (minOffOk) filling_ = true;
      }
      break;
  }

  // Safety: continuous auto run limit.
  if (filling_ && pump_ &&
      nowMs - pumpOnSince_ + carryMs_ >= static_cast<uint64_t>(cfg_.pumpMaxRunS) * 1000) {
    filling_ = false;
    ev |= raise(Fault::PUMP_TIMEOUT);
  }

  return ev | setPump(filling_, nowMs);
}

}  // namespace srf
