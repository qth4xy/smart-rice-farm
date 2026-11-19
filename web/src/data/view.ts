// The one model every panel renders from. The simulator produces it today; the live MQTT
// source (Phase 6) produces the same shape from the device's `state` and `event` topics.
import type { CropStage } from '../logic/cropSchedule';
import type { Fault, FloatState, Mode, Warning, Zone } from '../logic/types';

export type LogKind = 'info' | 'pump' | 'fault' | 'warn' | 'net';

export interface LogEntry {
  id: number;
  t: number; // epoch ms
  kind: LogKind;
  text: string;
}

export interface HistoryPoint {
  t: number; // epoch ms
  level: number | null; // cm vs soil surface; null in live mode (floats give zones only)
  zone: Zone;
  pump: boolean;
}

export interface CropDates {
  transplant: number; // epoch ms (local midnight)
  flowering: number;
  harvest: number;
}

export interface DeviceView {
  source: 'sim' | 'live';
  deviceId: string;
  now: number; // epoch ms
  mode: Mode;
  pump: boolean;
  pumpRunS: number;
  manual: boolean;
  filling: boolean;
  floatLow: FloatState;
  floatHigh: FloatState;
  /** Raw switch state before debounce (live only), for bench wiring checks. */
  floatLowPin?: 'OPEN' | 'CLOSED';
  floatHighPin?: 'OPEN' | 'CLOSED';
  zone: Zone;
  fault: Fault | null;
  warnings: Warning[];
  levelCm: number | null;
  soilPct: number | null;
  airTempC: number | null;
  airRh: number | null;
  cycles: number;
  avgDryingS: number;
  avgFillS: number;
  nextIrrigationAt: number | null; // epoch ms, an estimate
  totalPumpS: number;
  waterPumpedL: number | null;
  stage: CropStage;
  crop: CropDates | null;
  link: { wifi: boolean; mqtt: boolean };
  log: LogEntry[];
  history: HistoryPoint[];
}
