// TypeScript port of firmware/lib/AwdCore/src/AwdController.{h,cpp}.
// Same behaviour, same test vectors. Times are monotonic milliseconds.
import type { EventName, Fault, FloatState, Mode, Warning, Zone } from './types';

export interface AwdConfig {
  debounceS: number;
  pumpMaxRunS: number;
  pumpMinOffS: number;
  soilDryAlertPct: number;
  soilBackupDelayS: number;
  soilBackupCanStartPump: boolean;
  /** 0 = float table. >0 = timed fill seconds when FLOAT_LOW is DRY (FLOAT_HIGH unavailable). */
  timedFillS: number;
}

export const DEFAULT_CONFIG: Readonly<AwdConfig> = {
  debounceS: 3,
  pumpMaxRunS: 300,
  pumpMinOffS: 60,
  soilDryAlertPct: 30,
  soilBackupDelayS: 600,
  soilBackupCanStartPump: false,
  timedFillS: 0,
};

export interface AwdInputs {
  lowWet: boolean;
  highWet: boolean;
  /** Soil moisture %, < 0 or null = invalid. */
  soilPct: number | null;
}

export class Debouncer {
  private init = false;
  private candidate = false;
  private since = 0;
  private stable: FloatState = 'UNKNOWN';

  update(raw: boolean, nowMs: number, debounceMs: number): boolean {
    if (!this.init || raw !== this.candidate) {
      this.init = true;
      this.candidate = raw;
      this.since = nowMs;
    }
    const c: FloatState = this.candidate ? 'WET' : 'DRY';
    if (c !== this.stable && nowMs - this.since >= debounceMs) {
      this.stable = c;
      return true;
    }
    return false;
  }

  get state(): FloatState {
    return this.stable;
  }
}

export class AwdController {
  private cfg: AwdConfig;
  private _mode: Mode = 'AWD';
  private low = new Debouncer();
  private high = new Debouncer();
  private _pump = false;
  private _filling = false;
  private _fault: Fault | null = null;
  private _warnings = new Set<Warning>();
  private _manualActive = false;
  private manualUntil = 0;
  private pumpOnSince = 0;
  private pumpOffSince = 0;
  private pumpHasRun = false;
  private carryMs = 0;
  private soilDryValid = false;
  private soilDrySince = 0;

  constructor(cfg: Partial<AwdConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  // ---- config / state ----
  get config(): Readonly<AwdConfig> {
    return this.cfg;
  }
  setConfig(cfg: Partial<AwdConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }
  get mode(): Mode {
    return this._mode;
  }
  get pump(): boolean {
    return this._pump;
  }
  get filling(): boolean {
    return this._filling;
  }
  get manualActive(): boolean {
    return this._manualActive;
  }
  get fault(): Fault | null {
    return this._fault;
  }
  get warnings(): Warning[] {
    return [...this._warnings];
  }
  get floatLow(): FloatState {
    return this.low.state;
  }
  get floatHigh(): FloatState {
    return this.high.state;
  }
  get pumpOnSinceMs(): number {
    return this.pumpOnSince;
  }
  get pumpOffSinceMs(): number {
    return this.pumpOffSince;
  }

  get zone(): Zone {
    const l = this.low.state;
    const h = this.high.state;
    if (l === 'UNKNOWN' || h === 'UNKNOWN') return 'UNKNOWN';
    if (l === 'DRY' && h === 'DRY') return 'BELOW';
    if (l === 'WET' && h === 'DRY') return 'BETWEEN';
    if (l === 'WET' && h === 'WET') return 'ABOVE';
    return 'INVALID';
  }

  pumpRunS(nowMs: number): number {
    return this._pump ? Math.floor((nowMs - this.pumpOnSince) / 1000) : 0;
  }

  // ---- commands ----
  setMode(m: Mode): EventName[] {
    if (m === this._mode) return [];
    this._mode = m;
    if (m === 'OFF') this._filling = false;
    return ['mode_changed'];
  }

  /** on=true: run for `seconds` (capped). Rejected during a fault or when seconds <= 0. */
  manualPump(on: boolean, seconds: number, nowMs: number): boolean {
    if (!on) {
      this._manualActive = false;
      this._filling = false;
      return true;
    }
    if (this._fault !== null || !(seconds > 0)) return false;
    const s = Math.min(Math.floor(seconds), this.cfg.pumpMaxRunS);
    this._manualActive = true;
    this.manualUntil = nowMs + s * 1000;
    return true;
  }

  /** Auto run time carried over from before a reset; counts toward pumpMaxRunS. */
  setCarryRunMs(ms: number): void {
    this.carryMs = ms;
  }

  /** Fill now until FLOAT_HIGH reads WET (PUMP_TIMEOUT still applies). Rejected during a fault,
   * in OFF mode, or when FLOAT_HIGH is not DRY. Cancels a manual run. */
  startFill(): boolean {
    if (this._fault !== null || this._mode === 'OFF' || this.high.state !== 'DRY') return false;
    this._manualActive = false;
    this._filling = true;
    return true;
  }

  clearFault(): EventName[] {
    if (this._fault === null) return [];
    this._fault = null;
    this._filling = false;
    this.carryMs = 0;
    return ['fault_cleared'];
  }

  // ---- main step ----
  tick(nowMs: number, input: AwdInputs): EventName[] {
    const ev: EventName[] = [];
    const dbMs = this.cfg.debounceS * 1000;
    this.low.update(input.lowWet, nowMs, dbMs);
    this.high.update(input.highWet, nowMs, dbMs);
    const lo = this.low.state;
    const hi = this.high.state;

    if (lo === 'UNKNOWN' || hi === 'UNKNOWN') {
      this.setPump(false, nowMs, ev);
      return ev;
    }

    if (lo === 'DRY' && hi === 'WET') this.raise('FLOAT_CONFLICT', ev);

    // Soil moisture backup.
    let soilBackupKick = false;
    const soil = input.soilPct;
    const soilDry = soil !== null && soil >= 0 && soil < this.cfg.soilDryAlertPct && lo === 'WET';
    if (soilDry) {
      if (!this.soilDryValid) {
        this.soilDryValid = true;
        this.soilDrySince = nowMs;
      }
      if (
        !this._warnings.has('FLOAT_LOW_SUSPECT') &&
        nowMs - this.soilDrySince >= this.cfg.soilBackupDelayS * 1000
      ) {
        this._warnings.add('FLOAT_LOW_SUSPECT');
        ev.push('warning');
        soilBackupKick = true;
      }
    } else {
      this.soilDryValid = false;
      this._warnings.delete('FLOAT_LOW_SUSPECT');
    }

    if (this._fault !== null) {
      this._manualActive = false;
      this._filling = false;
      this.setPump(false, nowMs, ev);
      return ev;
    }

    if (this._manualActive) {
      if (nowMs < this.manualUntil) {
        this.setPump(true, nowMs, ev);
        return ev;
      }
      this._manualActive = false;
      this._filling = false;
    }

    switch (this._mode) {
      case 'OFF':
        this._filling = false;
        break;
      case 'AWD': {
        const timed = this.cfg.timedFillS > 0;
        if (lo === 'DRY' && hi === 'DRY') {
          const restOk = !timed || !this.pumpHasRun || nowMs - this.pumpOffSince >= this.cfg.pumpMinOffS * 1000;
          if (!this._filling && restOk) this._filling = true;
        } else if (lo === 'WET' && hi === 'WET') {
          this._filling = false;
        }
        if (timed && this._filling && this._pump && nowMs - this.pumpOnSince >= this.cfg.timedFillS * 1000) {
          this._filling = false;
        }
        if (soilBackupKick && this.cfg.soilBackupCanStartPump && hi === 'DRY') this._filling = true;
        break;
      }
      case 'FLOOD':
        if (hi === 'WET') {
          this._filling = false;
        } else if (!this._filling) {
          const minOffOk =
            !this.pumpHasRun || nowMs - this.pumpOffSince >= this.cfg.pumpMinOffS * 1000;
          if (minOffOk) this._filling = true;
        }
        break;
    }

    if (this._filling && this._pump && nowMs - this.pumpOnSince + this.carryMs >= this.cfg.pumpMaxRunS * 1000) {
      this._filling = false;
      this.raise('PUMP_TIMEOUT', ev);
    }

    this.setPump(this._filling, nowMs, ev);
    return ev;
  }

  private raise(f: Fault, ev: EventName[]): void {
    if (this._fault !== null) return;
    this._fault = f;
    ev.push('fault');
  }

  private setPump(on: boolean, nowMs: number, ev: EventName[]): void {
    if (on === this._pump) return;
    this._pump = on;
    if (on) {
      this.pumpOnSince = nowMs;
      ev.push('pump_on');
    } else {
      this.pumpOffSince = nowMs;
      this.pumpHasRun = true;
      this.carryMs = 0;
      ev.push('pump_off');
    }
  }
}
