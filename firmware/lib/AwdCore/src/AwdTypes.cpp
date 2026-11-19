#include "AwdTypes.h"

#include <string.h>

namespace srf {

const char* modeName(Mode m) {
  switch (m) {
    case Mode::AWD: return "AWD";
    case Mode::FLOOD: return "FLOOD";
    case Mode::OFF: return "OFF";
  }
  return "?";
}

const char* faultName(Fault f) {
  switch (f) {
    case Fault::NONE: return "";
    case Fault::FLOAT_CONFLICT: return "FLOAT_CONFLICT";
    case Fault::PUMP_TIMEOUT: return "PUMP_TIMEOUT";
  }
  return "?";
}

const char* zoneName(Zone z) {
  switch (z) {
    case Zone::UNKNOWN: return "UNKNOWN";
    case Zone::BELOW: return "BELOW";
    case Zone::BETWEEN: return "BETWEEN";
    case Zone::ABOVE: return "ABOVE";
    case Zone::INVALID: return "INVALID";
  }
  return "?";
}

const char* floatName(FloatState s) {
  switch (s) {
    case FloatState::UNKNOWN: return "UNKNOWN";
    case FloatState::DRY: return "DRY";
    case FloatState::WET: return "WET";
  }
  return "?";
}

bool parseMode(const char* s, Mode& out) {
  if (!s) return false;
  if (strcmp(s, "AWD") == 0 || strcmp(s, "awd") == 0) { out = Mode::AWD; return true; }
  if (strcmp(s, "FLOOD") == 0 || strcmp(s, "flood") == 0) { out = Mode::FLOOD; return true; }
  if (strcmp(s, "OFF") == 0 || strcmp(s, "off") == 0) { out = Mode::OFF; return true; }
  return false;
}

}  // namespace srf
