#include "CropSchedule.h"

namespace srf {

const char* stageName(CropStage s) {
  switch (s) {
    case CropStage::NONE: return "NONE";
    case CropStage::PRE_TRANSPLANT: return "PRE_TRANSPLANT";
    case CropStage::ESTABLISHMENT: return "ESTABLISHMENT";
    case CropStage::VEGETATIVE: return "VEGETATIVE";
    case CropStage::FLOWERING: return "FLOWERING";
    case CropStage::RIPENING: return "RIPENING";
  }
  return "?";
}

// Howard Hinnant's days_from_civil / civil_from_days.
int32_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<int32_t>(doe) - 719468;
}

void civilFromDays(int32_t z, int& y, unsigned& m, unsigned& d) {
  z += 719468;
  const int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = static_cast<unsigned>(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  d = doy - (153 * mp + 2) / 5 + 1;
  m = mp < 10 ? mp + 3 : mp - 9;
  y = static_cast<int>(yoe) + era * 400 + (m <= 2);
}

bool parseDate(const char* s, int32_t& dayOut) {
  if (!s) return false;
  int v[3] = {0, 0, 0};
  const int len[3] = {4, 2, 2};
  int p = 0;
  for (int f = 0; f < 3; f++) {
    for (int i = 0; i < len[f]; i++) {
      const char c = s[p++];
      if (c < '0' || c > '9') return false;
      v[f] = v[f] * 10 + (c - '0');
    }
    if (f < 2 && s[p++] != '-') return false;
  }
  if (s[p] != '\0') return false;
  if (v[1] < 1 || v[1] > 12 || v[2] < 1 || v[2] > 31) return false;
  const int32_t z = daysFromCivil(v[0], static_cast<unsigned>(v[1]), static_cast<unsigned>(v[2]));
  int y;
  unsigned m, d;
  civilFromDays(z, y, m, d);  // round-trip rejects e.g. 2026-02-30
  if (y != v[0] || static_cast<int>(m) != v[1] || static_cast<int>(d) != v[2]) return false;
  dayOut = z;
  return true;
}

StageResult cropStage(int32_t today, int32_t transplant, int32_t flowering,
                      uint32_t floodAfterTransplantDays, uint32_t floweringWindowDays) {
  if (transplant == kNoDate || flowering == kNoDate || flowering <= transplant) {
    return {CropStage::NONE, false, Mode::AWD};
  }
  const int32_t w = static_cast<int32_t>(floweringWindowDays);
  if (today < transplant) return {CropStage::PRE_TRANSPLANT, false, Mode::AWD};
  if (today >= flowering - w && today <= flowering + w) return {CropStage::FLOWERING, true, Mode::FLOOD};
  if (today < transplant + static_cast<int32_t>(floodAfterTransplantDays)) {
    return {CropStage::ESTABLISHMENT, true, Mode::FLOOD};
  }
  if (today < flowering - w) return {CropStage::VEGETATIVE, true, Mode::AWD};
  return {CropStage::RIPENING, true, Mode::AWD};
}

}  // namespace srf
