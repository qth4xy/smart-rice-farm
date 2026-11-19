#include "Storage.h"

#include <Preferences.h>
#include <string.h>

static Preferences g_prefs;
static constexpr const char* NS = "srf";

static void putU32(const char* k, uint32_t v) {
  if (!g_prefs.isKey(k) || g_prefs.getUInt(k, v + 1) != v) g_prefs.putUInt(k, v);
}
static void putI32(const char* k, int32_t v) {
  if (!g_prefs.isKey(k) || g_prefs.getInt(k, v + 1) != v) g_prefs.putInt(k, v);
}
static void putBool(const char* k, bool v) {
  if (!g_prefs.isKey(k) || g_prefs.getBool(k, !v) != v) g_prefs.putBool(k, v);
}

bool Storage::begin() { return g_prefs.begin(NS, false); }

void Storage::load(PersistedSettings& s) {
  s.awd.debounceS = g_prefs.getUInt("dbS", s.awd.debounceS);
  s.awd.pumpMaxRunS = g_prefs.getUInt("maxRun", s.awd.pumpMaxRunS);
  s.awd.pumpMinOffS = g_prefs.getUInt("minOff", s.awd.pumpMinOffS);
  s.awd.soilDryAlertPct = g_prefs.getUInt("soilPct", s.awd.soilDryAlertPct);
  s.awd.soilBackupDelayS = g_prefs.getUInt("soilDly", s.awd.soilBackupDelayS);
  s.awd.soilBackupCanStartPump = g_prefs.getBool("soilKick", s.awd.soilBackupCanStartPump);
  const uint8_t m = g_prefs.getUChar("mode", static_cast<uint8_t>(s.mode));
  if (m <= static_cast<uint8_t>(srf::Mode::OFF)) s.mode = static_cast<srf::Mode>(m);
  s.transplantDay = g_prefs.getInt("tpDay", s.transplantDay);
  s.floweringDay = g_prefs.getInt("flDay", s.floweringDay);
  s.soilRawDry = g_prefs.getInt("calDry", s.soilRawDry);
  s.soilRawWet = g_prefs.getInt("calWet", s.soilRawWet);
}

void Storage::save(const PersistedSettings& s) {
  putU32("dbS", s.awd.debounceS);
  putU32("maxRun", s.awd.pumpMaxRunS);
  putU32("minOff", s.awd.pumpMinOffS);
  putU32("soilPct", s.awd.soilDryAlertPct);
  putU32("soilDly", s.awd.soilBackupDelayS);
  putBool("soilKick", s.awd.soilBackupCanStartPump);
  const uint8_t m = static_cast<uint8_t>(s.mode);
  if (!g_prefs.isKey("mode") || g_prefs.getUChar("mode", m + 1) != m) g_prefs.putUChar("mode", m);
  putI32("tpDay", s.transplantDay);
  putI32("flDay", s.floweringDay);
  putI32("calDry", s.soilRawDry);
  putI32("calWet", s.soilRawWet);
}

struct AnalyticsBlob {
  uint8_t version;
  uint8_t count;
  uint32_t total;
  srf::Cycle cycles[srf::Analytics::kMaxCycles];
};

void Storage::loadAnalytics(srf::Analytics& a) {
  AnalyticsBlob b{};
  if (g_prefs.getBytesLength("cycles") != sizeof b) return;
  g_prefs.getBytes("cycles", &b, sizeof b);
  if (b.version != 1 || b.count > srf::Analytics::kMaxCycles) return;
  a.restore(b.cycles, b.count, b.total);
}

void Storage::saveAnalytics(const srf::Analytics& a) {
  AnalyticsBlob b{};
  b.version = 1;
  b.count = static_cast<uint8_t>(a.history(b.cycles, srf::Analytics::kMaxCycles));
  b.total = a.totalCycles();
  AnalyticsBlob old{};
  if (g_prefs.getBytesLength("cycles") == sizeof old) {
    g_prefs.getBytes("cycles", &old, sizeof old);
    if (memcmp(&old, &b, sizeof b) == 0) return;
  }
  g_prefs.putBytes("cycles", &b, sizeof b);
}

void Storage::factoryReset() { g_prefs.clear(); }
