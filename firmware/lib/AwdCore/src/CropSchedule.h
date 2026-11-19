// Crop-stage -> irrigation mode schedule. Pure C++. Dates are day numbers
// (days since 1970-01-01) of the local calendar date (Asia/Bangkok).
#pragma once
#include <stdint.h>

#include "AwdTypes.h"

namespace srf {

enum class CropStage : uint8_t { NONE, PRE_TRANSPLANT, ESTABLISHMENT, VEGETATIVE, FLOWERING, RIPENING };

struct StageResult {
  CropStage stage;
  bool hasMode;  // false = keep the mode set by command
  Mode mode;
};

constexpr int32_t kNoDate = INT32_MIN;

const char* stageName(CropStage s);

// "YYYY-MM-DD" -> day number. Returns false on a malformed or impossible date.
bool parseDate(const char* s, int32_t& dayOut);
int32_t daysFromCivil(int y, unsigned m, unsigned d);
void civilFromDays(int32_t z, int& y, unsigned& m, unsigned& d);

StageResult cropStage(int32_t today, int32_t transplant, int32_t flowering,
                      uint32_t floodAfterTransplantDays = 14, uint32_t floweringWindowDays = 7);

}  // namespace srf
