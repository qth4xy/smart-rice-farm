# Presentation guide

## Before the session

1. Build the offline file once: `cd web && npm run build:single`. It creates
   `web/dist-single/presentation.html` (about 600 KB: fonts, code and styles are all inside).
2. Copy `presentation.html` to the presentation laptop (and to a USB stick as a backup).
3. Double-click it. It runs in any modern browser with **no internet and no server**.
4. Press `F` for fullscreen and `P` for presentation mode (controls hidden, larger text).

The hosted version (Vercel) is the same app. Use the file when the venue network is unreliable.

## Keys

| Key | Action |
|---|---|
| `F` | fullscreen |
| `P` | presentation mode on/off |
| `Space` | play / pause |
| `←` `→` | previous / next scenario |
| `1` `2` `3` `4` | speed 1×, 60×, 600×, 3600× |
| `T` | guided tour (all six scenarios with captions, about 3 minutes) |

The mouse cursor hides after 3 s without movement.

## What the judges see

- **SIMULATION** badge (top right): everything on screen comes from the simulator. In live mode
  the badge reads **LIVE · srf-cc2468**.
- **Status strip**: mode, pump, water zone, health and network. Every state has an icon and a word,
  never color alone.
- **Cross-section**: the paddy, the perforated observation pipe and both floats. A float lights up
  blue when water reaches it. The pump hose shows flowing water while it runs.
- **Water level chart**: the AWD sawtooth between the dashed +5 cm and −15 cm lines; amber marks
  show when the pump ran.
- **Logic table**: the four float combinations; the current one is outlined.
- **Sensors, analytics, crop schedule and event log** on the right. Simulated values are tagged
  "simulated". The next-irrigation time is always labelled "estimate".

## Script (about 4 minutes)

Start the guided tour (`T`) or step through with `→`.

1. **Normal AWD cycle.** "Instead of keeping the field flooded all season, we let the water drop
   to 15 cm below the soil, the safe limit from IRRI research, and then refill to 5 cm. The pipe
   shows the water level under the soil, where farmers can't see it. Watch the −15 cm float: when it
   goes dry, the pump starts; when the +5 cm float gets wet, it stops."
   Point at row 2 of the logic table: "Between the floats the readings are the same while filling
   and while drying, so the controller remembers what it is doing. That is the key idea."
2. **Flowering → FLOOD.** "Rice is most sensitive around flowering. The crop calendar on the device
   switches to FLOOD a week before flowering and back to AWD a week after, with no one touching it."
3. **Float conflict.** "If a float jams, the readings become impossible: dry at −15 cm but wet at
   +5 cm. The controller doesn't guess. It stops the pump, locks out, beeps and shows a fault until
   someone checks it."
4. **Pump timeout.** "If the canal or tank is empty, the pump would run dry and burn out. After the
   safety limit with no water arriving, it stops and raises PUMP_TIMEOUT."
5. **Stuck float, caught by soil moisture.** "Here the −15 cm float sticks in the wet position, so
   it never asks for water. The soil moisture sensor is a second opinion: when the soil stays dry
   for 10 minutes while the float still says wet, it raises a warning."
6. **Wi-Fi drop.** "All decisions are made on the ESP32 itself. When the internet goes down, the
   field is still irrigated on time; the dashboard catches up when the link returns."

## Honest claims

- The analytics (cycle times, next-irrigation estimate, SLOW_FILL / FAST_DRAIN flags) are simple
  on-device statistics, not machine learning. The data is logged so a model can be trained later.
- Soil moisture, temperature and humidity in the simulator are simulated. The live mode shows the
  real sensors.
- The live chart shows float zones only. Only the simulator draws a continuous water level.

## Live part (with the scale model)

1. Power the board and the pump supply. Wait for the OLED network page to say **MQTT connected**
   and note the **Root** shown there.
2. In the dashboard click **Live** (top right). The first time, enter the topic root from the OLED
   (broker `wss://broker.hivemq.com:8884/mqtt` and device `srf-cc2468` are pre-filled). The
   settings are kept in this browser; the password only if "remember" is ticked.
3. Check the badge reads **LIVE · srf-cc2468** and the caption says **Connected**.
4. Lift the floats by hand to walk through the state table in front of the judges.
5. Mode and pump buttons ask for confirmation before anything is sent to the real device; the
   device's answer (ack) appears as a short notice.

In live mode the chart shows float **zones** and pump periods since the page was opened. There is
no continuous level line, because the floats only tell which band the water is in.

If the live page says "Waiting for the device…" for more than ~20 s, the public broker may be slow
or the venue network may block port 8884. Switch back to **Simulation**; it never needs a network.
