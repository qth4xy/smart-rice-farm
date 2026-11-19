// NVS persistence (Preferences). Every value is written only when it changed, to spare the flash.
#pragma once
#include <stdint.h>

#include "Analytics.h"
#include "AwdController.h"
#include "CropSchedule.h"

struct PersistedSettings {
  srf::AwdConfig awd;
  srf::Mode mode = srf::Mode::AWD;
  int32_t transplantDay = srf::kNoDate;
  int32_t floweringDay = srf::kNoDate;
  int soilRawDry = 0;
  int soilRawWet = 0;
  bool floatLowClosedIsWet = true;
  bool floatHighClosedIsWet = true;
};

class Storage {
 public:
  bool begin();
  void load(PersistedSettings& s);  // missing keys keep the values already in `s`
  void save(const PersistedSettings& s);
  void loadAnalytics(srf::Analytics& a);
  void saveAnalytics(const srf::Analytics& a);
  void factoryReset();
};
