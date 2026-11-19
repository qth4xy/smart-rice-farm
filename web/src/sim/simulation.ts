// Paddy simulator: a simple water-balance model around the SAME AwdController and Analytics
// that the firmware runs (both tested against shared/awd-test-vectors.json).
// Sensor values here (soil moisture, air temperature, humidity) are simulated and labelled so.
import { Analytics } from '../logic/analytics';
import { AwdController, DEFAULT_CONFIG, type AwdConfig } from '../logic/awdController';
import { cropStage, type CropStage } from '../logic/cropSchedule';
import type { EventName, FloatState, Mode } from '../logic/types';
import type { CropDates, DeviceView, HistoryPoint, LogEntry, LogKind } from '../data/view';

export interface SimSettings {
  dropAboveCmPerDay: number; // seepage + evaporation while water stands above the soil
  dropBelowCmPerDay: number; // drop of the perched water table below the surface
  fillCmPerMin: number; // pump rate as level rise in the plot
  pumpFlowLpm: number; // for the "water pumped" estimate
  awd: AwdConfig;
}

export const DEFAULT_SIM_SETTINGS: SimSettings = {
  dropAboveCmPerDay: 1,
  dropBelowCmPerDay: 4,
  fillCmPerMin: 5,
  pumpFlowLpm: 2,
  awd: { ...DEFAULT_CONFIG },
};

export interface Faults {
  lowStuck: FloatState | null; // 'WET' | 'DRY' forces FLOAT_LOW
  highStuck: FloatState | null;
  sourceEmpty: boolean; // pump runs but moves no water
  linkDown: boolean; // device <-> cloud link down (irrigation continues)
}

const DAY_MS = 86_400_000;
const BKK_OFFSET_MS = 7 * 3_600_000;
const HISTORY_EVERY_MS = 5 * 60_000;
const HISTORY_SPAN_MS = 16 * DAY_MS;
const PIPE_BOTTOM_CM = -20;
const PIPE_TOP_CM = 10;

/** Local (Asia/Bangkok) day number of an epoch time. */
export function bkkDay(ms: number): number {
  return Math.floor((ms + BKK_OFFSET_MS) / DAY_MS);
}

/** Epoch ms of Bangkok local midnight for a day number. */
export function bkkMidnight(day: number): number {
  return day * DAY_MS - BKK_OFFSET_MS;
}

export class Simulation {
  settings: SimSettings;
  faults: Faults = { lowStuck: null, highStuck: null, sourceEmpty: false, linkDown: false };
  t: number;
  level: number;
  crop: CropDates | null = null;
  readonly deviceId = 'sim-device';

  private ctl: AwdController;
  private analytics = new Analytics();
  private startMs: number; // monotonic base for the controller
  private log: LogEntry[] = [];
  private logId = 0;
  private history: HistoryPoint[] = [];
  private lastHistory = 0;
  private lastStage: CropStage | null = null;
  private totalPumpMs = 0;
  private queuedWhileDown = 0;

  constructor(startMs: number, level: number, settings: SimSettings = DEFAULT_SIM_SETTINGS, mode: Mode = 'AWD') {
    this.settings = structuredClone(settings);
    this.t = startMs;
    this.startMs = startMs;
    this.level = level;
    this.ctl = new AwdController(this.settings.awd);
    this.ctl.setMode(mode);
    this.recordHistory(true);
  }

  // ---------------- inputs ----------------
  private floats(): { low: boolean; high: boolean } {
    let low = this.level >= -15;
    let high = this.level >= 5;
    if (this.faults.lowStuck) low = this.faults.lowStuck === 'WET';
    if (this.faults.highStuck) high = this.faults.highStuck === 'WET';
    return { low, high };
  }

  /** Simulated soil moisture: saturated while water stands, drying as the water table falls. */
  soilPct(): number {
    if (this.level >= 0) return 100;
    return Math.max(5, Math.round(100 + 3.5 * this.level));
  }

  private hourOfDay(): number {
    return (((this.t + BKK_OFFSET_MS) % DAY_MS) / 3_600_000 + 24) % 24;
  }

  airTempC(): number {
    return Math.round((29 + 4 * Math.sin((2 * Math.PI * (this.hourOfDay() - 9)) / 24)) * 10) / 10;
  }

  airRh(): number {
    return Math.round(74 - 14 * Math.sin((2 * Math.PI * (this.hourOfDay() - 9)) / 24));
  }

  // ---------------- commands (same semantics as MQTT cmd) ----------------
  setMode(m: Mode, reason = 'command'): void {
    if (this.ctl.setMode(m).length) this.addLog('info', `Mode → ${m} (${reason})`);
  }

  manualPump(on: boolean, seconds: number): boolean {
    const ok = this.ctl.manualPump(on, seconds, this.mono());
    if (!ok) this.addLog('fault', 'Manual pump refused: clear the fault first');
    return ok;
  }

  fill(): boolean {
    const ok = this.ctl.startFill();
    this.addLog(ok ? 'info' : 'fault', ok ? 'Fill to +5 cm started' : 'Fill refused: fault, mode OFF or already at +5 cm');
    return ok;
  }

  clearFault(): void {
    if (this.ctl.clearFault().length) this.addLog('info', 'Fault cleared by operator');
  }

  setCrop(crop: CropDates | null): void {
    this.crop = crop;
    this.lastStage = null;
  }

  setLinkDown(down: boolean): void {
    if (down === this.faults.linkDown) return;
    this.faults.linkDown = down;
    if (down) {
      this.addLog('net', 'Wi-Fi lost. The device keeps irrigating on its own.');
    } else {
      this.addLog('net', `Wi-Fi back. ${this.queuedWhileDown} events from the outage were in the device log.`);
      this.queuedWhileDown = 0;
    }
  }

  note(text: string): void {
    this.addLog('info', text);
  }

  // ---------------- time ----------------
  private mono(): number {
    return this.t - this.startMs;
  }

  /** Advance the simulation by `ms`, in steps of `stepMs` (default 1 s, like a 1 Hz controller). */
  advance(ms: number, stepMs = 1000): void {
    let left = ms;
    while (left > 0) {
      const dt = Math.min(stepMs, left);
      this.step(dt);
      left -= dt;
    }
  }

  private step(dtMs: number): void {
    this.t += dtMs;
    const s = this.settings;

    // Water balance.
    const dropPerMs = (this.level > 0 ? s.dropAboveCmPerDay : s.dropBelowCmPerDay) / DAY_MS;
    this.level -= dropPerMs * dtMs;
    if (this.ctl.pump) {
      this.totalPumpMs += dtMs;
      if (!this.faults.sourceEmpty) this.level += (s.fillCmPerMin / 60_000) * dtMs;
    }
    this.level = Math.min(PIPE_TOP_CM + 2, Math.max(PIPE_BOTTOM_CM - 8, this.level));

    // Crop schedule: act on stage changes only (like the firmware).
    if (this.crop) {
      const r = cropStage(bkkDay(this.t), bkkDay(this.crop.transplant), bkkDay(this.crop.flowering));
      if (r.stage !== this.lastStage) {
        this.lastStage = r.stage;
        if (r.mode) this.setMode(r.mode, `crop stage ${r.stage.toLowerCase()}`);
      }
    }

    // Controller + analytics, exactly as on the device.
    const f = this.floats();
    const mono = this.mono();
    const ev = this.ctl.tick(mono, { lowWet: f.low, highWet: f.high, soilPct: this.soilPct() });
    ev.push(...this.analytics.update(mono, this.ctl.mode, this.ctl.pump, this.ctl.manualActive, this.ctl.floatLow, this.ctl.floatHigh));
    for (const e of ev) this.onEvent(e);
    this.recordHistory(false);
  }

  private onEvent(e: EventName): void {
    if (this.faults.linkDown) this.queuedWhileDown++;
    const map: Record<EventName, [LogKind, () => string] | null> = {
      pump_on: ['pump', () =>
        this.ctl.manualActive ? 'Pump ON (manual)' : this.ctl.floatLow === 'WET' ? 'Pump ON: filling to +5 cm' : 'Pump ON: water reached −15 cm, filling'],
      pump_off: ['pump', () => (this.ctl.fault ? 'Pump OFF (safety stop)' : 'Pump OFF: field back at +5 cm')],
      fault: ['fault', () => `FAULT ${this.ctl.fault}: pump stopped and locked`],
      fault_cleared: null,
      warning: ['warn', () => `Warning: ${[...this.ctl.warnings, ...this.analytics.warnings].join(', ')}`],
      mode_changed: null,
      cycle_complete: [
        'info',
        () => {
          const h = this.analytics.history.at(-1)!;
          return `Cycle done: dried ${fmtDur(h.dryingS)}, filled ${fmtDur(h.fillS)}`;
        },
      ],
    };
    const m = map[e];
    if (m) this.addLog(m[0], m[1]());
  }

  private addLog(kind: LogKind, text: string): void {
    this.log.push({ id: ++this.logId, t: this.t, kind, text });
    if (this.log.length > 20) this.log.shift();
  }

  private recordHistory(force: boolean): void {
    if (!force && this.t - this.lastHistory < HISTORY_EVERY_MS) return;
    this.lastHistory = this.t;
    this.history.push({ t: this.t, level: this.level, zone: this.ctl.zone, pump: this.ctl.pump });
    while (this.history.length && this.history[0].t < this.t - HISTORY_SPAN_MS) this.history.shift();
  }

  /** Forget the event log after an invisible warm-up. Chart history and analytics are kept. */
  clearLog(): void {
    this.log = [];
  }

  // ---------------- view ----------------
  view(): DeviceView {
    const eta = this.analytics.nextIrrigationAtMs;
    const stage = this.crop
      ? cropStage(bkkDay(this.t), bkkDay(this.crop.transplant), bkkDay(this.crop.flowering)).stage
      : 'NONE';
    return {
      source: 'sim',
      deviceId: this.deviceId,
      now: this.t,
      mode: this.ctl.mode,
      pump: this.ctl.pump,
      pumpRunS: this.ctl.pumpRunS(this.mono()),
      manual: this.ctl.manualActive,
      filling: this.ctl.filling,
      floatLow: this.ctl.floatLow,
      floatHigh: this.ctl.floatHigh,
      zone: this.ctl.zone,
      fault: this.ctl.fault,
      warnings: [...this.ctl.warnings, ...this.analytics.warnings],
      levelCm: this.level,
      soilPct: this.soilPct(),
      airTempC: this.airTempC(),
      airRh: this.airRh(),
      cycles: this.analytics.totalCycles,
      avgDryingS: this.analytics.avgDryingS,
      avgFillS: this.analytics.avgFillS,
      nextIrrigationAt: eta === null ? null : this.startMs + eta,
      totalPumpS: Math.round(this.totalPumpMs / 1000),
      waterPumpedL: (this.totalPumpMs / 60_000) * this.settings.pumpFlowLpm,
      stage,
      crop: this.crop,
      link: { wifi: !this.faults.linkDown, mqtt: !this.faults.linkDown },
      log: [...this.log],
      history: [...this.history],
    };
  }

  get controller(): AwdController {
    return this.ctl;
  }
}

export function fmtDur(s: number): string {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${String(Math.floor(s / 3600) % 24).padStart(2, '0')}h`;
}
