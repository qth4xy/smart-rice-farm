// Shared types for the pure-C++ AWD core (no Arduino calls, unit-tested on the PC).
#pragma once
#include <stdint.h>

namespace srf {

enum class Mode : uint8_t { AWD = 0, FLOOD = 1, OFF = 2 };
enum class Fault : uint8_t { NONE = 0, FLOAT_CONFLICT = 1, PUMP_TIMEOUT = 2 };
enum class Zone : uint8_t { UNKNOWN = 0, BELOW = 1, BETWEEN = 2, ABOVE = 3, INVALID = 4 };
enum class FloatState : uint8_t { UNKNOWN = 0, DRY = 1, WET = 2 };

// Warning bit flags (controller + analytics share one namespace).
namespace Warn {
constexpr uint32_t FLOAT_LOW_SUSPECT = 1u << 0;
constexpr uint32_t SLOW_FILL = 1u << 1;
constexpr uint32_t FAST_DRAIN = 1u << 2;
}  // namespace Warn

// Event bit flags returned by tick()/update()/commands.
namespace Ev {
constexpr uint32_t PUMP_ON = 1u << 0;
constexpr uint32_t PUMP_OFF = 1u << 1;
constexpr uint32_t FAULT = 1u << 2;
constexpr uint32_t FAULT_CLEARED = 1u << 3;
constexpr uint32_t WARNING = 1u << 4;
constexpr uint32_t MODE_CHANGED = 1u << 5;
constexpr uint32_t CYCLE_COMPLETE = 1u << 6;
}  // namespace Ev

const char* modeName(Mode m);
const char* faultName(Fault f);  // "" for NONE
const char* zoneName(Zone z);
const char* floatName(FloatState s);
bool parseMode(const char* s, Mode& out);

}  // namespace srf
