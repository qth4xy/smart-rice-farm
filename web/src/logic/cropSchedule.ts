// TypeScript port of firmware/lib/AwdCore/src/CropSchedule.{h,cpp}.
import type { Mode } from './types';

export type CropStage =
  | 'NONE'
  | 'PRE_TRANSPLANT'
  | 'ESTABLISHMENT'
  | 'VEGETATIVE'
  | 'FLOWERING'
  | 'RIPENING';

export interface StageResult {
  stage: CropStage;
  /** null = keep the mode set by command. */
  mode: Mode | null;
}

/** Day number (days since 1970-01-01) of a calendar date. */
export function daysFromCivil(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** "YYYY-MM-DD" -> day number, or null if malformed/impossible. */
export function parseDate(s: string | null | undefined): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const z = daysFromCivil(y, mo, d);
  const back = new Date(z * 86_400_000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== mo || back.getUTCDate() !== d) {
    return null;
  }
  return z;
}

export function formatDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function cropStage(
  today: number,
  transplant: number | null,
  flowering: number | null,
  floodAfterTransplantDays = 14,
  floweringWindowDays = 7,
): StageResult {
  if (transplant === null || flowering === null || flowering <= transplant) {
    return { stage: 'NONE', mode: null };
  }
  const w = floweringWindowDays;
  if (today < transplant) return { stage: 'PRE_TRANSPLANT', mode: null };
  if (today >= flowering - w && today <= flowering + w) return { stage: 'FLOWERING', mode: 'FLOOD' };
  if (today < transplant + floodAfterTransplantDays) return { stage: 'ESTABLISHMENT', mode: 'FLOOD' };
  if (today < flowering - w) return { stage: 'VEGETATIVE', mode: 'AWD' };
  return { stage: 'RIPENING', mode: 'AWD' };
}
