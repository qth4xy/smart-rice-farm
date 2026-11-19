import type { Zone } from '../logic/types';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const shortDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });

export const fmtDateTime = (ms: number) => dateTime.format(ms);
export const fmtShortDateTime = (ms: number) => shortDateTime.format(ms);
export const fmtDate = (ms: number) => dateOnly.format(ms);

/** "45s", "3m 05s", "2h 46m", "3d 04h" */
export function fmtDur(s: number): string {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${String(Math.floor(s / 3600) % 24).padStart(2, '0')}h`;
}

export const ZONE_TEXT: Record<Zone, { short: string; long: string }> = {
  BELOW: { short: 'Below −15 cm', long: 'Water is below −15 cm: time to irrigate' },
  BETWEEN: { short: '−15 to +5 cm', long: 'Water is between −15 and +5 cm' },
  ABOVE: { short: 'At +5 cm', long: 'Water reached +5 cm above the soil' },
  INVALID: { short: 'Impossible', long: 'Impossible float reading' },
  UNKNOWN: { short: 'Reading…', long: 'Waiting for stable float readings' },
};

export const signedCm = (cm: number) => `${cm > 0.05 ? '+' : cm < -0.05 ? '−' : ''}${Math.abs(cm).toFixed(1)} cm`;
