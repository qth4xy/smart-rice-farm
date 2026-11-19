// Demo scenarios for the judges. Each one builds a fresh Simulation, warms it up invisibly
// (so the chart and analytics already show real simulated cycles), then sets up the moment
// the audience should watch.
import { bkkDay, bkkMidnight, DEFAULT_SIM_SETTINGS, Simulation, type SimSettings } from './simulation';

const DAY = 86_400_000;

export interface Scenario {
  id: string;
  title: string;
  caption: string; // one sentence for the judges
  speed: number; // suggested speed
  tourSeconds: number; // how long the guided tour stays on it
  build(settings: SimSettings): Simulation;
  /** Optional per-frame script (e.g. bring the Wi-Fi back later). */
  script?: (sim: Simulation, startT: number) => void;
}

/** A fixed, believable season: transplanted 1 Dec 2026, flowering mid-Feb, harvest mid-March. */
function cropFrom(transplantDay: number) {
  return {
    transplant: bkkMidnight(transplantDay),
    flowering: bkkMidnight(transplantDay + 76),
    harvest: bkkMidnight(transplantDay + 106),
  };
}
const TRANSPLANT_DAY = bkkDay(Date.UTC(2026, 11, 1, 5, 0)); // 1 Dec 2026, Bangkok

/** Start at a given crop day + hour, run `warmDays` of normal AWD first (chart + averages). */
function seasonSim(settings: SimSettings, cropDay: number, warmDays: number): Simulation {
  const crop = cropFrom(TRANSPLANT_DAY);
  const start = crop.transplant + (cropDay - warmDays) * DAY + 6 * 3_600_000;
  // Start just before a fill, so the warm-up contains complete measured cycles.
  const sim = new Simulation(start, -14.9, settings, 'AWD');
  sim.setCrop(crop);
  sim.advance(warmDays * DAY, 10_000);
  sim.clearLog();
  return sim;
}

/** Run until the level is close to a target while drying (used to cue the interesting moment). */
function dryTo(sim: Simulation, cm: number): void {
  for (let i = 0; i < 40 * 24 * 60 && !(sim.level <= cm && !sim.controller.pump); i++) sim.advance(60_000, 10_000);
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'normal',
    title: 'Normal AWD cycle',
    caption:
      'The field dries to 15 cm below the soil, the pump refills it to 5 cm above, then it stops and the cycle repeats.',
    speed: 3600,
    tourSeconds: 30,
    build: (s) => {
      const sim = seasonSim(s, 40, 20);
      dryTo(sim, -13.5);
      sim.note('Scenario: normal AWD cycle');
      return sim;
    },
  },
  {
    id: 'flowering',
    title: 'Flowering → FLOOD mode',
    caption:
      'A week before flowering the crop schedule switches to FLOOD, so the field is kept under water when rice is most sensitive.',
    speed: 3600,
    tourSeconds: 30,
    build: (s) => {
      // 68 days after transplanting: the flowering window (day 76 − 7 = 69) starts in about a day.
      const sim = seasonSim(s, 68, 12);
      sim.note('Scenario: flowering week ahead');
      return sim;
    },
  },
  {
    id: 'conflict',
    title: 'Float conflict fault',
    caption:
      'The −15 cm float jams. The controller sees an impossible float combination and stops the pump instead of guessing.',
    speed: 60,
    tourSeconds: 25,
    build: (s) => {
      const sim = seasonSim(s, 30, 12);
      dryTo(sim, -6);
      sim.faults.lowStuck = 'DRY';
      sim.note('Scenario: FLOAT_LOW jammed in the DRY position');
      return sim;
    },
  },
  {
    id: 'timeout',
    title: 'Pump timeout (water source empty)',
    caption:
      'The pump runs but no water arrives. After the safety limit it stops and raises PUMP_TIMEOUT instead of running dry.',
    speed: 60,
    tourSeconds: 25,
    build: (s) => {
      const sim = seasonSim(s, 30, 12);
      dryTo(sim, -14.99);
      sim.faults.sourceEmpty = true;
      sim.note('Scenario: the water source has run dry');
      return sim;
    },
  },
  {
    id: 'stuck-low',
    title: 'Stuck float, caught by soil moisture',
    caption:
      'The −15 cm float sticks WET, so it never asks for water. The soil moisture sensor notices the soil drying out and raises a warning.',
    speed: 3600,
    tourSeconds: 40,
    build: (s) => {
      const sim = seasonSim(s, 30, 12);
      dryTo(sim, -14.5);
      sim.faults.lowStuck = 'WET';
      dryTo(sim, -16.5);
      sim.note('Scenario: FLOAT_LOW stuck WET; the water is already below −15 cm');
      return sim;
    },
  },
  {
    id: 'offline',
    title: 'Wi-Fi drop: keeps irrigating offline',
    caption:
      'The internet goes down, but all decisions are made on the device, so the field is still irrigated on time.',
    speed: 3600,
    tourSeconds: 30,
    build: (s) => {
      const sim = seasonSim(s, 30, 12);
      dryTo(sim, -12);
      sim.setLinkDown(true);
      return sim;
    },
    script: (sim, startT) => {
      if (sim.faults.linkDown && sim.t - startT > 1.2 * DAY) sim.setLinkDown(false);
    },
  },
];

export function buildScenario(index: number, settings: SimSettings = DEFAULT_SIM_SETTINGS): Simulation {
  return SCENARIOS[index].build(settings);
}
