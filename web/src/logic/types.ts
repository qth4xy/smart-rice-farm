// TypeScript port of firmware/lib/AwdCore/src/AwdTypes.h. Keep the two in sync;
// shared/awd-test-vectors.json is the contract both are tested against.

export type Mode = 'AWD' | 'FLOOD' | 'OFF';
export type Fault = 'FLOAT_CONFLICT' | 'PUMP_TIMEOUT';
export type Zone = 'UNKNOWN' | 'BELOW' | 'BETWEEN' | 'ABOVE' | 'INVALID';
export type FloatState = 'UNKNOWN' | 'DRY' | 'WET';
export type Warning = 'FLOAT_LOW_SUSPECT' | 'SLOW_FILL' | 'FAST_DRAIN';
export type EventName =
  | 'pump_on'
  | 'pump_off'
  | 'fault'
  | 'fault_cleared'
  | 'warning'
  | 'mode_changed'
  | 'cycle_complete';

export const MODES: readonly Mode[] = ['AWD', 'FLOOD', 'OFF'];

export function isMode(s: unknown): s is Mode {
  return typeof s === 'string' && (MODES as readonly string[]).includes(s);
}
