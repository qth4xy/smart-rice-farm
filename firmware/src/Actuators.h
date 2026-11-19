// Pump output and a non-blocking buzzer pattern engine.
#pragma once
#include <stdint.h>

class Pump {
 public:
  // Call first thing in setup(): drives the output to OFF.
  static void beginSafe();
  void set(bool on);
  bool on() const { return on_; }

 private:
  bool on_ = false;
};

class Buzzer {
 public:
  void begin();
  void update(uint32_t nowMs);
  void beeps(uint8_t n);  // queued, ignored while muted
  // Fault alarm: 3 beeps every 10 s for the first minute, then every 5 minutes.
  void setFaultAlarm(bool active, uint32_t nowMs);
  void mute(uint32_t minutes, uint32_t nowMs);  // 0 = unmute
  bool muted(uint32_t nowMs) const;
  uint32_t mutedRemainingS(uint32_t nowMs) const;

 private:
  void write(bool on);
  uint8_t pending_ = 0;     // beeps left in the current burst
  bool outOn_ = false;
  uint32_t nextEdge_ = 0;
  bool alarm_ = false;
  uint32_t alarmStart_ = 0;
  uint32_t nextAlarm_ = 0;
  uint32_t muteUntil_ = 0;
  bool mutedFlag_ = false;
};
