// Turns the device's MQTT messages (docs/mqtt.md) into the same DeviceView the simulator produces.
// Pure and synchronous so it can be unit-tested without a broker.
import type { CropStage } from '../logic/cropSchedule';
import { parseDate } from '../logic/cropSchedule';
import type { Fault, FloatState, Mode, Warning, Zone } from '../logic/types';
import type { DeviceView, HistoryPoint, LogEntry, LogKind } from '../data/view';
import { fmtDur } from '../ui/format';

export interface DeviceState {
  ts: number | null;
  mode: Mode;
  pump: boolean;
  pumpRunS: number;
  manual?: boolean;
  filling?: boolean;
  floatLow: FloatState;
  floatHigh: FloatState;
  floatLowPin?: 'OPEN' | 'CLOSED';
  floatHighPin?: 'OPEN' | 'CLOSED';
  zone: Zone;
  fault: Fault | null;
  warnings: Warning[];
  soilPct: number | null;
  airTempC: number | null;
  airRh: number | null;
  nextIrrigationEta: number | null;
  avgDryingS: number;
  avgFillS: number;
  cycles?: number;
  stage?: CropStage;
  rssi: number | null;
  uptimeS: number;
  fw: string;
}

export interface DeviceConfig {
  transplantDate: string | null;
  floweringDate: string | null;
  [k: string]: unknown;
}

const DAY = 86_400_000;
const BKK = 7 * 3_600_000;
const HISTORY_SPAN = 16 * DAY;
const MAX_HISTORY = 6000;

export class LiveModel {
  state: DeviceState | null = null;
  config: DeviceConfig | null = null;
  deviceOnline: boolean | null = null;
  brokerConnected = false;
  private history: HistoryPoint[] = [];
  private log: LogEntry[] = [];
  private logId = 0;
  private sessionPumpS = 0;

  constructor(readonly deviceId: string) {}

  /** Handle one message. `leaf` is the last topic level (state, event, config, status). */
  onMessage(leaf: string, payload: string, nowMs: number): void {
    if (leaf === 'status') {
      if (payload !== 'online' && payload !== 'offline') return;
      const online = payload === 'online';
      if (this.deviceOnline !== null && online !== this.deviceOnline) {
        this.addLog(nowMs, 'net', online ? 'Device back online' : 'Device offline (it keeps irrigating on its own)');
      }
      this.deviceOnline = online;
      return;
    }
    if (payload === '') return; // a cleared retained topic
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof data !== 'object' || data === null) return;
    if (leaf === 'state') this.onState(data as DeviceState, nowMs);
    else if (leaf === 'config') this.config = data as DeviceConfig;
    else if (leaf === 'event') this.onEvent(data as Record<string, unknown>, nowMs);
  }

  private onState(s: DeviceState, nowMs: number): void {
    if (typeof s.mode !== 'string' || typeof s.zone !== 'string') return;
    this.state = s;
    const t = s.ts ? s.ts * 1000 : nowMs;
    const last = this.history.at(-1);
    if (!last || t > last.t) {
      this.history.push({ t, level: null, zone: s.zone, pump: s.pump });
      while (this.history.length > MAX_HISTORY || (this.history.length && this.history[0].t < t - HISTORY_SPAN)) {
        this.history.shift();
      }
    }
  }

  private onEvent(e: Record<string, unknown>, nowMs: number): void {
    const t = typeof e.ts === 'number' ? e.ts * 1000 : nowMs;
    const name = String(e.event ?? '');
    const add = (kind: LogKind, text: string) => this.addLog(t, kind, text);
    switch (name) {
      case 'pump_on':
        add('pump', `Pump ON (${e.reason ?? 'auto'})`);
        break;
      case 'pump_off':
        if (typeof e.runS === 'number') this.sessionPumpS += e.runS;
        add('pump', `Pump OFF after ${fmtDur(Number(e.runS ?? 0))}${e.reason === 'fault' ? ' (safety stop)' : ''}`);
        break;
      case 'fault':
        add('fault', `FAULT ${e.fault}: pump stopped and locked`);
        break;
      case 'fault_cleared':
        add('info', 'Fault cleared');
        break;
      case 'warning':
        add('warn', `Warning: ${(e.warnings as string[] | undefined)?.join(', ') ?? ''}`);
        break;
      case 'mode_changed':
        add('info', `Mode → ${e.mode} (${e.reason ?? 'command'})`);
        break;
      case 'cycle_complete':
        add('info', `Cycle done: dried ${fmtDur(Number(e.dryingS))}, filled ${fmtDur(Number(e.fillS))}`);
        break;
      case 'boot':
        add('net', `Device started (firmware ${e.fw})`);
        break;
      case 'portal':
        add('net', 'Wi-Fi setup portal opened on the device');
        break;
      case 'ack':
        add(e.ok ? 'info' : 'fault', e.ok ? `Command ${e.cmd}: done` : `Command ${e.cmd} refused: ${e.error}`);
        break;
      default:
        break;
    }
  }

  private addLog(t: number, kind: LogKind, text: string): void {
    this.log.push({ id: ++this.logId, t, kind, text });
    if (this.log.length > 20) this.log.shift();
  }

  view(nowMs: number): DeviceView | null {
    const s = this.state;
    if (!s) return null;
    const tp = parseDate(this.config?.transplantDate ?? null);
    const fl = parseDate(this.config?.floweringDate ?? null);
    const crop =
      tp !== null && fl !== null
        ? { transplant: tp * DAY - BKK, flowering: fl * DAY - BKK, harvest: (fl + 30) * DAY - BKK }
        : null;
    const online = this.brokerConnected && this.deviceOnline !== false;
    return {
      source: 'live',
      deviceId: this.deviceId,
      now: nowMs,
      mode: s.mode,
      pump: s.pump,
      pumpRunS: s.pumpRunS,
      manual: !!s.manual,
      filling: !!s.filling,
      floatLow: s.floatLow,
      floatHigh: s.floatHigh,
      floatLowPin: s.floatLowPin,
      floatHighPin: s.floatHighPin,
      zone: s.zone,
      fault: s.fault,
      warnings: s.warnings ?? [],
      levelCm: null, // floats give zones only: never invent a level
      soilPct: s.soilPct,
      airTempC: s.airTempC,
      airRh: s.airRh,
      cycles: s.cycles ?? 0,
      avgDryingS: s.avgDryingS,
      avgFillS: s.avgFillS,
      nextIrrigationAt: s.nextIrrigationEta ? s.nextIrrigationEta * 1000 : null,
      totalPumpS: this.sessionPumpS,
      waterPumpedL: null,
      stage: s.stage ?? 'NONE',
      crop,
      link: { wifi: online, mqtt: online },
      log: [...this.log],
      history: [...this.history],
    };
  }
}
