// SSD1306 128x64 OLED pages. Rotates every OLED_PAGE_MS; a fault page and the test page override.
#pragma once
#include <stdint.h>

#include "Snapshot.h"

class Display {
 public:
  bool begin();  // false if no OLED found (the rest of the system keeps running)
  void update(uint32_t nowMs, const Snapshot& s);
  void setTestPage(bool on) { test_ = on; }
  bool testPage() const { return test_; }
  bool ok() const { return ok_; }

 private:
  void header(const char* left, const char* right);
  void pageMain(const Snapshot& s);
  void pageSensors(const Snapshot& s);
  void pageNetwork(const Snapshot& s);
  void pageAnalytics(const Snapshot& s);
  void pageFault(const Snapshot& s, uint32_t nowMs);
  void pageTest(const Snapshot& s);

  bool ok_ = false;
  bool test_ = false;
  uint8_t page_ = 0;
  uint32_t pageSince_ = 0;
  uint32_t lastDraw_ = 0;
  uint8_t lastRaw_ = 0xFF;
  uint32_t lastInit_ = 0;
};

// "45s", "3m05s", "2h46m", "3d04h"
void formatDuration(uint32_t s, char* out, unsigned len);
