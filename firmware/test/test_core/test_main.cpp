// Runs shared/awd-test-vectors.json against AwdController + Analytics + CropSchedule.
// The web simulator runs the same file with vitest (web/src/logic/*.test.ts).
#include <ArduinoJson.h>
#include <unity.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "Analytics.h"
#include "AwdController.h"
#include "CropSchedule.h"

using namespace srf;

static JsonDocument g_doc;
static std::vector<std::string> g_fail;

static bool loadVectors() {
  const char* paths[] = {"../shared/awd-test-vectors.json", "shared/awd-test-vectors.json",
                         "../../shared/awd-test-vectors.json", "../../../shared/awd-test-vectors.json"};
  for (const char* p : paths) {
    std::ifstream f(p);
    if (!f) continue;
    std::stringstream ss;
    ss << f.rdbuf();
    std::string txt = ss.str();
    if (txt.rfind("\xEF\xBB\xBF", 0) == 0) txt.erase(0, 3);  // tolerate a UTF-8 BOM
    return !deserializeJson(g_doc, txt);
  }
  return false;
}

static std::vector<std::string> eventNames(uint32_t ev) {
  std::vector<std::string> v;
  if (ev & Ev::PUMP_ON) v.push_back("pump_on");
  if (ev & Ev::PUMP_OFF) v.push_back("pump_off");
  if (ev & Ev::FAULT) v.push_back("fault");
  if (ev & Ev::FAULT_CLEARED) v.push_back("fault_cleared");
  if (ev & Ev::WARNING) v.push_back("warning");
  if (ev & Ev::MODE_CHANGED) v.push_back("mode_changed");
  if (ev & Ev::CYCLE_COMPLETE) v.push_back("cycle_complete");
  std::sort(v.begin(), v.end());
  return v;
}

static std::vector<std::string> warnNames(uint32_t w) {
  std::vector<std::string> v;
  if (w & Warn::FLOAT_LOW_SUSPECT) v.push_back("FLOAT_LOW_SUSPECT");
  if (w & Warn::SLOW_FILL) v.push_back("SLOW_FILL");
  if (w & Warn::FAST_DRAIN) v.push_back("FAST_DRAIN");
  std::sort(v.begin(), v.end());
  return v;
}

static std::vector<std::string> strList(JsonArrayConst a) {
  std::vector<std::string> v;
  for (JsonVariantConst x : a) v.push_back(x.as<const char*>());
  std::sort(v.begin(), v.end());
  return v;
}

static std::string join(const std::vector<std::string>& v) {
  std::string s = "[";
  for (size_t i = 0; i < v.size(); i++) s += (i ? "," : "") + v[i];
  return s + "]";
}

static bool hasKey(JsonObjectConst o, const char* k) {
  for (JsonPairConst p : o)
    if (!strcmp(p.key().c_str(), k)) return true;
  return false;
}

static void applyConfig(AwdConfig& c, JsonObjectConst o) {
  if (o["debounceS"].is<uint32_t>()) c.debounceS = o["debounceS"];
  if (o["pumpMaxRunS"].is<uint32_t>()) c.pumpMaxRunS = o["pumpMaxRunS"];
  if (o["pumpMinOffS"].is<uint32_t>()) c.pumpMinOffS = o["pumpMinOffS"];
  if (o["soilDryAlertPct"].is<uint32_t>()) c.soilDryAlertPct = o["soilDryAlertPct"];
  if (o["soilBackupDelayS"].is<uint32_t>()) c.soilBackupDelayS = o["soilBackupDelayS"];
  if (o["soilBackupCanStartPump"].is<bool>()) c.soilBackupCanStartPump = o["soilBackupCanStartPump"];
}

#define CHECK(cond, what)                                                         \
  do {                                                                            \
    if (!(cond)) {                                                                \
      char buf[512];                                                              \
      snprintf(buf, sizeof buf, "%s @t=%g: %s", name, t, std::string(what).c_str()); \
      g_fail.push_back(buf);                                                      \
    }                                                                             \
  } while (0)

static void runCase(JsonObjectConst cs) {
  const char* name = cs["name"] | "?";
  AwdConfig cfg;
  applyConfig(cfg, cs["config"]);
  AwdController c(cfg);
  Analytics a;
  Mode m;
  if (parseMode(cs["mode"] | "", m)) c.setMode(m);

  AwdInputs in;
  for (JsonObjectConst st : cs["steps"].as<JsonArrayConst>()) {
    const double t = st["t"].as<double>();
    const uint64_t ms = static_cast<uint64_t>(std::llround(t * 1000.0));
    if (st["low"].is<const char*>()) in.lowWet = strcmp(st["low"], "WET") == 0;
    if (st["high"].is<const char*>()) in.highWet = strcmp(st["high"], "WET") == 0;
    if (st["soil"].is<int>()) in.soilPct = st["soil"];

    uint32_t ev = 0;
    bool cmdOk = true;
    JsonObjectConst cmd = st["cmd"];
    if (!cmd.isNull()) {
      const char* k = cmd["cmd"] | "";
      if (!strcmp(k, "setMode")) {
        cmdOk = parseMode(cmd["mode"] | "", m);
        if (cmdOk) ev |= c.setMode(m);
      } else if (!strcmp(k, "pump")) {
        cmdOk = c.manualPump(cmd["on"] | false, cmd["seconds"] | 0u, ms);
      } else if (!strcmp(k, "clearFault")) {
        ev |= c.clearFault();
      } else if (!strcmp(k, "setConfig")) {
        applyConfig(cfg, cmd);
        c.setConfig(cfg);
      } else {
        cmdOk = false;
      }
    }
    ev |= c.tick(ms, in);
    ev |= a.update(ms, c.mode(), c.pump(), c.manualActive(), c.floatLow(), c.floatHigh());

    JsonObjectConst ex = st["expect"];
    if (ex.isNull()) continue;
    if (ex["pump"].is<bool>()) CHECK(c.pump() == ex["pump"].as<bool>(), "pump");
    if (ex["filling"].is<bool>()) CHECK(c.filling() == ex["filling"].as<bool>(), "filling");
    if (ex["manual"].is<bool>()) CHECK(c.manualActive() == ex["manual"].as<bool>(), "manual");
    if (ex["cmdOk"].is<bool>()) CHECK(cmdOk == ex["cmdOk"].as<bool>(), "cmdOk");
    if (ex["mode"].is<const char*>())
      CHECK(!strcmp(modeName(c.mode()), ex["mode"]), std::string("mode=") + modeName(c.mode()));
    if (ex["zone"].is<const char*>())
      CHECK(!strcmp(zoneName(c.zone()), ex["zone"]), std::string("zone=") + zoneName(c.zone()));
    if (hasKey(ex, "fault")) {
      const char* want = ex["fault"].isNull() ? "" : ex["fault"].as<const char*>();
      CHECK(!strcmp(faultName(c.fault()), want), std::string("fault=") + faultName(c.fault()));
    }
    if (ex["pumpRunS"].is<uint32_t>())
      CHECK(c.pumpRunS(ms) == ex["pumpRunS"].as<uint32_t>(), "pumpRunS");
    if (ex["warnings"].is<JsonArrayConst>()) {
      auto got = warnNames(c.warnings());
      CHECK(got == strList(ex["warnings"]), "warnings=" + join(got));
    }
    if (ex["analyticsWarnings"].is<JsonArrayConst>()) {
      auto got = warnNames(a.warnings());
      CHECK(got == strList(ex["analyticsWarnings"]), "analyticsWarnings=" + join(got));
    }
    if (ex["events"].is<JsonArrayConst>()) {
      auto got = eventNames(ev);
      CHECK(got == strList(ex["events"]), "events=" + join(got));
    }
    if (ex["cycles"].is<int>()) CHECK(a.count() == ex["cycles"].as<int>(), "cycles=" + std::to_string(a.count()));
    if (ex["avgDryingS"].is<uint32_t>())
      CHECK(a.avgDryingS() == ex["avgDryingS"].as<uint32_t>(), "avgDryingS=" + std::to_string(a.avgDryingS()));
    if (ex["avgFillS"].is<uint32_t>())
      CHECK(a.avgFillS() == ex["avgFillS"].as<uint32_t>(), "avgFillS=" + std::to_string(a.avgFillS()));
    if (hasKey(ex, "nextIrrigationAtS")) {
      const uint64_t eta = a.nextIrrigationAtMs();
      if (ex["nextIrrigationAtS"].isNull()) CHECK(eta == 0, "nextIrrigationAtS should be null");
      else CHECK(eta == ex["nextIrrigationAtS"].as<uint64_t>() * 1000, "nextIrrigationAtS=" + std::to_string(eta / 1000));
    }
  }
}

void test_vectors_loaded() { TEST_ASSERT_TRUE_MESSAGE(loadVectors(), "cannot read shared/awd-test-vectors.json"); }

void test_controller_and_analytics_cases() {
  g_fail.clear();
  JsonArrayConst cases = g_doc["cases"];
  TEST_ASSERT_TRUE(cases.size() > 0);
  for (JsonObjectConst cs : cases) runCase(cs);
  for (auto& f : g_fail) printf("FAIL %s\n", f.c_str());
  TEST_ASSERT_EQUAL_MESSAGE(0, (int)g_fail.size(), "vector failures (see output above)");
}

void test_schedule_cases() {
  int fails = 0;
  TEST_ASSERT_TRUE(g_doc["schedule"].size() > 0);
  for (JsonObjectConst v : g_doc["schedule"].as<JsonArrayConst>()) {
    int32_t tp = kNoDate, fl = kNoDate, today = 0;
    if (!v["transplant"].isNull()) TEST_ASSERT_TRUE(parseDate(v["transplant"], tp));
    if (!v["flowering"].isNull()) TEST_ASSERT_TRUE(parseDate(v["flowering"], fl));
    TEST_ASSERT_TRUE(parseDate(v["date"], today));
    StageResult r = cropStage(today, tp, fl);
    const char* wantMode = v["mode"].isNull() ? "" : v["mode"].as<const char*>();
    const char* gotMode = r.hasMode ? modeName(r.mode) : "";
    if (strcmp(stageName(r.stage), v["stage"]) || strcmp(gotMode, wantMode)) {
      printf("FAIL schedule %s: got %s/%s\n", v["date"].as<const char*>(), stageName(r.stage), gotMode);
      fails++;
    }
  }
  TEST_ASSERT_EQUAL(0, fails);
}

void test_parse_date() {
  int32_t d;
  TEST_ASSERT_TRUE(parseDate("1970-01-01", d));
  TEST_ASSERT_EQUAL(0, d);
  TEST_ASSERT_TRUE(parseDate("2026-11-19", d));
  TEST_ASSERT_EQUAL(20776, d);
  TEST_ASSERT_FALSE(parseDate("2026-02-30", d));
  TEST_ASSERT_FALSE(parseDate("2026-1-05", d));
  TEST_ASSERT_FALSE(parseDate("2026-13-01", d));
  TEST_ASSERT_FALSE(parseDate("2026-01-01x", d));
}

void test_analytics_ring_keeps_last_10() {
  Analytics a;
  Cycle in[12];
  for (int i = 0; i < 12; i++) in[i] = {static_cast<uint32_t>(100 * (i + 1)), static_cast<uint32_t>(i + 1)};
  a.restore(in, 12, 0);
  TEST_ASSERT_EQUAL(10, a.count());
  Cycle out[10];
  TEST_ASSERT_EQUAL(10, a.history(out, 10));
  TEST_ASSERT_EQUAL_UINT32(100, out[0].dryingS);  // restore keeps the first 10 given
  a.restore(in + 2, 10, 25);
  TEST_ASSERT_EQUAL_UINT32(25, a.totalCycles());
  TEST_ASSERT_EQUAL_UINT32(750, a.avgDryingS());  // 300..1200 -> 750
}

void setUp() {}
void tearDown() {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_vectors_loaded);
  RUN_TEST(test_controller_and_analytics_cases);
  RUN_TEST(test_schedule_cases);
  RUN_TEST(test_parse_date);
  RUN_TEST(test_analytics_ring_keeps_last_10);
  return UNITY_END();
}
