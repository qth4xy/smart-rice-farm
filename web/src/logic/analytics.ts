// TypeScript port of firmware/lib/AwdCore/src/Analytics.{h,cpp}.
import type { EventName, FloatState, Mode, Warning } from './types';

export interface Cycle {
  dryingS: number;
  fillS: number;
}

type Phase = 'IDLE' | 'FILLING' | 'FILLED' | 'DRYING' | 'WAIT_PUMP';

export const MAX_CYCLES = 10;
export const MIN_CYCLES_FOR_ANOMALY = 3;

export class Analytics {
  private phase: Phase = 'IDLE';
  private prevPump = false;
  private runManual = false;
  private fillStart = 0;
  private dryStart = 0;
  private lastOff = 0;
  private pendingValid = false;
  private pendingDryingS = 0;
  private cycles: Cycle[] = []; // oldest first, at most MAX_CYCLES
  private total = 0;
  private _warnings: Warning[] = [];

  get count(): number {
    return this.cycles.length;
  }
  get totalCycles(): number {
    return this.total;
  }
  get warnings(): Warning[] {
    return [...this._warnings];
  }
  get history(): Cycle[] {
    return this.cycles.map((c) => ({ ...c }));
  }
  get avgDryingS(): number {
    return avg(this.cycles.map((c) => c.dryingS));
  }
  get avgFillS(): number {
    return avg(this.cycles.map((c) => c.fillS));
  }
  /** Monotonic ms of the estimated next pump start, or null. An estimate only. */
  get nextIrrigationAtMs(): number | null {
    if (this.phase !== 'DRYING' || this.cycles.length === 0) return null;
    return this.lastOff + this.avgDryingS * 1000;
  }

  restore(cycles: Cycle[], total: number): void {
    this.cycles = cycles.slice(0, MAX_CYCLES).map((c) => ({ ...c }));
    this.total = Math.max(total, this.cycles.length);
  }

  update(
    nowMs: number,
    mode: Mode,
    pump: boolean,
    manual: boolean,
    low: FloatState,
    high: FloatState,
  ): EventName[] {
    const ev: EventName[] = [];
    const rising = pump && !this.prevPump;
    const falling = !pump && this.prevPump;
    this.prevPump = pump;

    if (mode !== 'AWD' || manual) {
      this.phase = 'IDLE';
      this.pendingValid = false;
      if (pump) this.runManual = this.runManual || manual;
      if (falling) this.runManual = false;
      return ev;
    }

    if (this.phase === 'DRYING' && low === 'DRY') {
      this.pendingDryingS = Math.floor((nowMs - this.dryStart) / 1000);
      this.pendingValid = true;
      this.phase = 'WAIT_PUMP';
    }

    if (this.phase === 'FILLING' && high === 'WET') {
      const fillS = Math.floor((nowMs - this.fillStart) / 1000);
      if (this.pendingValid && !this.runManual) {
        const c: Cycle = { dryingS: this.pendingDryingS, fillS };
        const w: Warning[] = [];
        if (this.cycles.length >= MIN_CYCLES_FOR_ANOMALY) {
          const aFill = this.avgFillS;
          const aDry = this.avgDryingS;
          if (c.fillS > 2 * aFill) w.push('SLOW_FILL');
          if (2 * c.dryingS < aDry) w.push('FAST_DRAIN');
        }
        this.push(c);
        ev.push('cycle_complete');
        if (w.some((x) => !this._warnings.includes(x))) ev.push('warning');
        this._warnings = w;
      }
      this.pendingValid = false;
      this.phase = 'FILLED';
    }

    if (rising) {
      this.runManual = false;
      if (this.phase !== 'WAIT_PUMP') this.pendingValid = false;
      this.phase = 'FILLING';
      this.fillStart = nowMs;
    } else if (falling) {
      if (this.phase === 'FILLED' && !this.runManual) {
        this.phase = 'DRYING';
        this.dryStart = nowMs;
        this.lastOff = nowMs;
      } else {
        this.phase = 'IDLE';
      }
      this.runManual = false;
      this.pendingValid = false;
    }
    return ev;
  }

  private push(c: Cycle): void {
    this.cycles.push(c);
    if (this.cycles.length > MAX_CYCLES) this.cycles.shift();
    this.total++;
  }
}

/** Integer average rounded half up, identical to the C++ (sum + n/2) / n. */
function avg(xs: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const sum = xs.reduce((a, b) => a + b, 0);
  return Math.floor((sum + Math.floor(n / 2)) / n);
}
