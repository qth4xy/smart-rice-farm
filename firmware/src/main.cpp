// Placeholder until Phase 2 (bring-up). Keeps the pump pin LOW.
#include <Arduino.h>

void setup() {
  pinMode(7, OUTPUT);
  digitalWrite(7, LOW);
  Serial.begin(115200);
}

void loop() { delay(1000); }
