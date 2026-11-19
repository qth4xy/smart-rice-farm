// Each scenario must actually produce what its caption tells the judges.
import { describe, expect, it } from 'vitest';

import { SCENARIOS } from './scenarios';
import { DEFAULT_SIM_SETTINGS, type Simulation } from './simulation';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function run(id: string, ms: number, watch?: (sim: Simulation) => void): Simulation {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const sim = sc.build(DEFAULT_SIM_SETTINGS);
  const start = sim.t;
  for (let t = 0; t < ms; t += 60_000) {
    sim.advance(60_000);
    sc.script?.(sim, start);
    watch?.(sim);
  }
  return sim;
}

describe('scenarios', () => {
  it('warm-up gives real recorded cycles and a sawtooth history', () => {
    const v = SCENARIOS[0].build(DEFAULT_SIM_SETTINGS).view();
    expect(v.cycles).toBeGreaterThanOrEqual(1);
    expect(v.avgDryingS).toBeGreaterThan(0);
    expect(v.history.length).toBeGreaterThan(100);
    expect(v.log.length).toBeLessThanOrEqual(1);
  });

  it('normal: pumps at −15 cm, stops at +5 cm, records a cycle', () => {
    let sawPump = false;
    const before = SCENARIOS[0].build(DEFAULT_SIM_SETTINGS).view().cycles;
    const sim = run('normal', 1 * DAY, (s) => (sawPump ||= s.controller.pump));
    const v = sim.view();
    expect(sawPump).toBe(true);
    expect(v.pump).toBe(false);
    expect(v.fault).toBeNull();
    expect(v.cycles).toBe(before + 1);
    expect(v.levelCm!).toBeGreaterThan(3);
  });

  it('flowering: switches to FLOOD and fills the field', () => {
    const v = run('flowering', 2 * DAY).view();
    expect(v.mode).toBe('FLOOD');
    expect(v.stage).toBe('FLOWERING');
    expect(v.levelCm!).toBeGreaterThan(4);
  });

  it('conflict: FLOAT_CONFLICT stops the pump', () => {
    const v = run('conflict', 30 * 60_000).view();
    expect(v.fault).toBe('FLOAT_CONFLICT');
    expect(v.pump).toBe(false);
    expect(v.zone).toBe('INVALID');
  });

  it('timeout: PUMP_TIMEOUT after the max run time with an empty source', () => {
    const v = run('timeout', 1 * HOUR).view();
    expect(v.fault).toBe('PUMP_TIMEOUT');
    expect(v.pump).toBe(false);
  });

  it('stuck-low: soil moisture raises FLOAT_LOW_SUSPECT, the pump is not started (alert only)', () => {
    let pumped = false;
    const v = run('stuck-low', 2 * DAY, (s) => (pumped ||= s.controller.pump)).view();
    expect(v.warnings).toContain('FLOAT_LOW_SUSPECT');
    expect(pumped).toBe(false);
  });

  it('offline: irrigates while the link is down, link comes back later', () => {
    let pumpedOffline = false;
    const sim = run('offline', 2 * DAY, (s) => (pumpedOffline ||= s.controller.pump && s.faults.linkDown));
    expect(pumpedOffline).toBe(true);
    expect(sim.view().link.wifi).toBe(true);
  });
});
