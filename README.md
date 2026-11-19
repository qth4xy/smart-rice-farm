# Smart Rice Farm

AIoT irrigation for rice paddies using **Safe AWD (Alternate Wetting and Drying)**: let the
field water drop to 15 cm below the soil surface, then refill to 5 cm above it, and repeat.

- `firmware/`: ESP32-S3 controller (floats, pump, sensors, OLED, buzzer, Wi-Fi, MQTT)
- `web/`: offline simulator and live dashboard for presentations (deployed on Vercel)
- `docs/`: wiring, MQTT contract, control logic, presentation script

Work in progress. See `docs/PROMPT.md` for the full spec.
