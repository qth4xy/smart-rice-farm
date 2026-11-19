#include "Actuators.h"

#include <Arduino.h>

#include "config.h"

static constexpr uint32_t BEEP_ON_MS = 90;
static constexpr uint32_t BEEP_OFF_MS = 130;

// ---------------- Pump ----------------
void Pump::beginSafe() {
  digitalWrite(PIN_PUMP, PUMP_ACTIVE_HIGH ? LOW : HIGH);  // set level before enabling output
  pinMode(PIN_PUMP, OUTPUT);
  digitalWrite(PIN_PUMP, PUMP_ACTIVE_HIGH ? LOW : HIGH);
}

void Pump::set(bool on) {
  on_ = on;
  digitalWrite(PIN_PUMP, (on == PUMP_ACTIVE_HIGH) ? HIGH : LOW);
}

// ---------------- Buzzer ----------------
void Buzzer::begin() {
  pinMode(PIN_BUZZER, OUTPUT);
  write(false);
}

void Buzzer::write(bool on) {
  outOn_ = on;
  digitalWrite(PIN_BUZZER, (on == BUZZER_ACTIVE_HIGH) ? HIGH : LOW);
}

bool Buzzer::muted(uint32_t nowMs) const {
  return mutedFlag_ && static_cast<int32_t>(muteUntil_ - nowMs) > 0;
}

uint32_t Buzzer::mutedRemainingS(uint32_t nowMs) const {
  return muted(nowMs) ? (muteUntil_ - nowMs) / 1000 : 0;
}

void Buzzer::mute(uint32_t minutes, uint32_t nowMs) {
  mutedFlag_ = minutes > 0;
  muteUntil_ = nowMs + minutes * 60000UL;
  if (mutedFlag_) {
    pending_ = 0;
    write(false);
  }
}

void Buzzer::beeps(uint8_t n) {
  if (mutedFlag_ && static_cast<int32_t>(muteUntil_ - millis()) > 0) return;
  if (pending_ + n > 12) n = 12 - pending_;
  pending_ += n;
}

void Buzzer::setFaultAlarm(bool active, uint32_t nowMs) {
  if (active == alarm_) return;
  alarm_ = active;
  alarmStart_ = nowMs;
  nextAlarm_ = nowMs;  // first burst right away
}

void Buzzer::update(uint32_t nowMs) {
  if (mutedFlag_ && static_cast<int32_t>(muteUntil_ - nowMs) <= 0) mutedFlag_ = false;

  if (alarm_ && static_cast<int32_t>(nowMs - nextAlarm_) >= 0) {
    const uint32_t interval = (nowMs - alarmStart_ < 60000UL) ? 10000UL : 300000UL;
    nextAlarm_ = nowMs + interval;
    beeps(3);
  }

  if (static_cast<int32_t>(nowMs - nextEdge_) < 0) return;
  if (outOn_) {
    write(false);
    nextEdge_ = nowMs + BEEP_OFF_MS;
  } else if (pending_ > 0) {
    pending_--;
    write(true);
    nextEdge_ = nowMs + BEEP_ON_MS;
  }
}
