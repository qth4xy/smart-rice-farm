// Runs shared/awd-test-vectors.json against the TypeScript port.
// The firmware runs the same file natively (firmware/test/test_core).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Analytics, MAX_CYCLES } from './analytics';
import { AwdController, type AwdConfig, type AwdInputs } from './awdController';
import { cropStage, parseDate } from './cropSchedule';
import { isMode, type EventName } from './types';

const raw = readFileSync(
  fileURLToPath(new URL('../../../shared/awd-test-vectors.json', import.meta.url)),
  'utf8',
).replace(/^﻿/, '');

interface Step {
  t: number;
  low?: 'WET' | 'DRY';
  high?: 'WET' | 'DRY';
  soil?: number;
  carryRunS?: number;
  cmd?: Record<string, unknown>;
  expect?: Record<string, unknown>;
}
interface Case {
  name: string;
  config?: Partial<AwdConfig>;
  mode?: string;
  steps: Step[];
}
interface ScheduleVector {
  transplant: string | null;
  flowering: string | null;
  date: string;
  stage: string;
  mode: string | null;
}
const vectors = JSON.parse(raw) as { cases: Case[]; schedule: ScheduleVector[] };

const sorted = (xs: readonly string[]) => [...xs].sort();

describe('shared AWD test vectors', () => {
  it('has cases and schedule vectors', () => {
    expect(vectors.cases.length).toBeGreaterThan(0);
    expect(vectors.schedule.length).toBeGreaterThan(0);
  });

  for (const cs of vectors.cases) {
    it(cs.name, () => {
      const c = new AwdController(cs.config ?? {});
      const a = new Analytics();
      if (isMode(cs.mode)) c.setMode(cs.mode);
      const input: AwdInputs = { lowWet: false, highWet: false, soilPct: null };

      for (const st of cs.steps) {
        const ms = Math.round(st.t * 1000);
        if (st.low) input.lowWet = st.low === 'WET';
        if (st.high) input.highWet = st.high === 'WET';
        if (typeof st.soil === 'number') input.soilPct = st.soil;
        if (typeof st.carryRunS === 'number') c.setCarryRunMs(st.carryRunS * 1000);

        const ev: EventName[] = [];
        let cmdOk = true;
        if (st.cmd) {
          const k = st.cmd.cmd;
          if (k === 'setMode') {
            cmdOk = isMode(st.cmd.mode);
            if (isMode(st.cmd.mode)) ev.push(...c.setMode(st.cmd.mode));
          } else if (k === 'pump') {
            cmdOk = c.manualPump(st.cmd.on === true, Number(st.cmd.seconds ?? 0), ms);
          } else if (k === 'clearFault') {
            ev.push(...c.clearFault());
          } else if (k === 'setConfig') {
            const { cmd: _ignored, ...rest } = st.cmd;
            c.setConfig(rest as Partial<AwdConfig>);
          } else {
            cmdOk = false;
          }
        }
        ev.push(...c.tick(ms, input));
        ev.push(...a.update(ms, c.mode, c.pump, c.manualActive, c.floatLow, c.floatHigh));

        const ex = st.expect;
        if (!ex) continue;
        const at = `t=${st.t}`;
        const got: Record<string, unknown> = {};
        const want: Record<string, unknown> = {};
        const add = (k: string, v: unknown) => {
          if (k in ex) {
            got[k] = v;
            want[k] = Array.isArray(ex[k]) ? sorted(ex[k] as string[]) : ex[k];
          }
        };
        add('pump', c.pump);
        add('filling', c.filling);
        add('manual', c.manualActive);
        add('cmdOk', cmdOk);
        add('mode', c.mode);
        add('zone', c.zone);
        add('fault', c.fault);
        add('pumpRunS', c.pumpRunS(ms));
        add('warnings', sorted(c.warnings));
        add('analyticsWarnings', sorted(a.warnings));
        add('events', sorted(ev));
        add('cycles', a.count);
        add('avgDryingS', a.avgDryingS);
        add('avgFillS', a.avgFillS);
        const eta = a.nextIrrigationAtMs;
        add('nextIrrigationAtS', eta === null ? null : eta / 1000);
        expect({ at, ...got }).toEqual({ at, ...want });
      }
    });
  }

  for (const v of vectors.schedule) {
    it(`schedule ${v.transplant ?? '-'} / ${v.flowering ?? '-'} on ${v.date} -> ${v.stage}`, () => {
      const today = parseDate(v.date);
      expect(today).not.toBeNull();
      const r = cropStage(today!, parseDate(v.transplant), parseDate(v.flowering));
      expect({ stage: r.stage, mode: r.mode }).toEqual({ stage: v.stage, mode: v.mode });
    });
  }
});

describe('parseDate', () => {
  it('matches the C++ day numbers and rejects bad dates', () => {
    expect(parseDate('1970-01-01')).toBe(0);
    expect(parseDate('2026-11-19')).toBe(20776);
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('2026-1-05')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('2026-01-01x')).toBeNull();
  });
});

describe('Analytics history', () => {
  it('keeps at most the last 10 cycles', () => {
    const a = new Analytics();
    a.restore(
      Array.from({ length: 10 }, (_, i) => ({ dryingS: 100 * (i + 3), fillS: i + 3 })),
      25,
    );
    expect(a.count).toBe(MAX_CYCLES);
    expect(a.totalCycles).toBe(25);
    expect(a.avgDryingS).toBe(750);
  });
});
