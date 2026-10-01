/**
 * Calendar-date arithmetic on "date keys" ("YYYY-MM-DD" strings).
 *
 * A date key is a plain calendar date with no time zone attached, which makes
 * it the safest unit for "add 1 day" / "next month" math: we encode it as
 * UTC midnight internally, where every day is exactly 24h long, so DST can
 * never shift the result.
 */

export type DateKey = string;

export const DAY_MS = 86_400_000;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function toDateKey(year: number, month: number, day: number): DateKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parses and validates a date key. Returns null for malformed or impossible dates (e.g. 2026-02-30). */
export function parseDateKey(key: string): DateParts | null {
  const match = DATE_KEY_RE.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidDateKey(key: string): boolean {
  return parseDateKey(key) !== null;
}

function partsOrThrow(key: DateKey): DateParts {
  const parts = parseDateKey(key);
  if (!parts) throw new Error(`Invalid date key: ${key}`);
  return parts;
}

/** UTC-midnight timestamp for a date key. Only meaningful as an ordinal, not as an instant. */
export function dateKeyToUtcMs(key: DateKey): number {
  const { year, month, day } = partsOrThrow(key);
  return Date.UTC(year, month - 1, day);
}

export function utcMsToDateKey(ms: number): DateKey {
  const date = new Date(ms);
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(key: DateKey, days: number): DateKey {
  return utcMsToDateKey(dateKeyToUtcMs(key) + days * DAY_MS);
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds months, clamping the day so Jan 31 + 1 month = Feb 28/29 (never rolls into March). */
export function addMonths(key: DateKey, months: number): DateKey {
  const { year, month, day } = partsOrThrow(key);
  const monthIndex = year * 12 + (month - 1) + months;
  const newYear = Math.floor(monthIndex / 12);
  const newMonth = (monthIndex % 12) + 1;
  return toDateKey(newYear, newMonth, Math.min(day, daysInMonth(newYear, newMonth)));
}

/** 0 = Sunday ... 6 = Saturday (same convention as Date#getDay). */
export function weekdayOf(key: DateKey): number {
  return new Date(dateKeyToUtcMs(key)).getUTCDay();
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((dateKeyToUtcMs(b) - dateKeyToUtcMs(a)) / DAY_MS);
}

/** Start of the week containing `key`. weekStartsOn: 0 = Sunday, 1 = Monday. */
export function startOfWeek(key: DateKey, weekStartsOn = 1): DateKey {
  const offset = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDays(key, -offset);
}

export function startOfMonth(key: DateKey): DateKey {
  const { year, month } = partsOrThrow(key);
  return toDateKey(year, month, 1);
}

/** Inclusive list of consecutive date keys. */
export function dateRange(start: DateKey, count: number): DateKey[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
