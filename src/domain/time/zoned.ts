/**
 * Time-zone math built only on `Intl.DateTimeFormat` (no date libraries).
 *
 * Every event is stored as a UTC instant. To draw it we need the *wall-clock*
 * time in the zone the user picked, and to create/move it we need the reverse
 * (wall-clock -> UTC). Both directions go through `offsetAt`, the zone's UTC
 * offset at a given instant.
 */
import { addDays, DAY_MS, parseDateKey, toDateKey, type DateKey } from './dateKey';

const MINUTE_MS = 60_000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields straight from Intl (slow path, used only to compute offsets). */
function intlWallTime(ms: number, timeZone: string): WallTime {
  const out: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour, // defensive: some engines emit 24 at midnight
    minute: out.minute,
    second: out.second,
  };
}

/*
 * Offsets only change at DST transitions, and every modern transition happens
 * on a 15-minute boundary (in UTC). So we compute the offset once per
 * 15-minute bucket and cache it. This turns thousands of Intl calls per render
 * (500+ events) into cheap Map lookups.
 */
const offsetCache = new Map<string, number>();
const OFFSET_CACHE_LIMIT = 50_000;

/** Offset of `timeZone` from UTC at instant `ms`, in milliseconds (e.g. +19_800_000 for IST). */
export function offsetAt(ms: number, timeZone: string): number {
  const bucketStart = Math.floor(ms / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
  const cacheKey = `${timeZone}|${bucketStart}`;
  const cached = offsetCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const wall = intlWallTime(bucketStart, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offset = wallAsUtc - bucketStart;

  if (offsetCache.size > OFFSET_CACHE_LIMIT) offsetCache.clear();
  offsetCache.set(cacheKey, offset);
  return offset;
}

/** UTC instant -> wall-clock time in `timeZone`. */
export function toWallTime(ms: number, timeZone: string): WallTime {
  const shifted = new Date(ms + offsetAt(ms, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * Wall-clock time in `timeZone` -> UTC instant.
 *
 * Handles the two DST edge cases the same way browsers/Temporal do
 * ("compatible" disambiguation):
 *  - Gap (spring forward, e.g. 02:30 does not exist): shift forward by the gap -> 03:30.
 *  - Overlap (fall back, e.g. 01:30 happens twice): pick the earlier instant.
 */
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const offsetBefore = offsetAt(local - DAY_MS, timeZone);
  const offsetAfter = offsetAt(local + DAY_MS, timeZone);

  if (offsetBefore === offsetAfter) return local - offsetBefore; // no transition nearby (common case)

  const candidateBefore = local - offsetBefore;
  const candidateAfter = local - offsetAfter;
  const beforeIsValid = offsetAt(candidateBefore, timeZone) === offsetBefore;
  const afterIsValid = offsetAt(candidateAfter, timeZone) === offsetAfter;

  if (beforeIsValid && afterIsValid) return Math.min(candidateBefore, candidateAfter); // overlap
  if (beforeIsValid) return candidateBefore;
  if (afterIsValid) return candidateAfter;
  return candidateBefore; // gap: interpret with the pre-transition offset = pushed forward
}

/** Date key + minutes after midnight (wall clock) -> UTC instant. Minutes may exceed a day. */
export function zonedToUtc(key: DateKey, minutes: number, timeZone: string): number {
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = minutes - dayOffset * 1440;
  const target = dayOffset === 0 ? key : addDays(key, dayOffset);
  const parts = parseDateKey(target);
  if (!parts) throw new Error(`Invalid date key: ${target}`);
  return wallTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    timeZone,
  );
}

/** Calendar date of an instant as seen in `timeZone`. */
export function dateKeyInZone(ms: number, timeZone: string): DateKey {
  const wall = toWallTime(ms, timeZone);
  return toDateKey(wall.year, wall.month, wall.day);
}

/** Minutes since local midnight of an instant in `timeZone` (0-1439). */
export function minutesInZone(ms: number, timeZone: string): number {
  const wall = toWallTime(ms, timeZone);
  return wall.hour * 60 + wall.minute;
}

/** UTC instant of local midnight for a calendar date in `timeZone`. */
export function startOfDayInZone(key: DateKey, timeZone: string): number {
  return zonedToUtc(key, 0, timeZone);
}

export function todayKey(timeZone: string, now = Date.now()): DateKey {
  return dateKeyInZone(now, timeZone);
}

/** True if `timeZone` is an IANA zone this browser understands. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** All-day events are "floating" dates stored as UTC midnight, so they never shift between zones. */
export const FLOATING_ZONE = 'UTC';
