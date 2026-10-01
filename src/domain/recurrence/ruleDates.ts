/**
 * Generates the calendar dates of a recurrence rule, in order, as date keys.
 *
 * Works purely on calendar dates (no times, no zones), so it is immune to DST:
 * the caller converts each date + the series' wall-clock time to UTC.
 *
 * `fromKey` lets the generator jump close to the visible range instead of
 * walking from a start date that may be years in the past. The `index` it
 * yields is still the true occurrence number, which "end after N times" needs.
 */
import type { RecurrenceRule } from '../types';
import {
  addDays,
  daysInMonth,
  diffDays,
  parseDateKey,
  startOfWeek,
  toDateKey,
  weekdayOf,
  type DateKey,
} from '../time/dateKey';

export interface RuleDate {
  index: number;
  key: DateKey;
}

export function* ruleDates(rule: RecurrenceRule, anchorKey: DateKey, fromKey?: DateKey): Generator<RuleDate> {
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  switch (rule.freq) {
    case 'daily':
      yield* dailyDates(interval, anchorKey, fromKey);
      return;
    case 'weekly':
      yield* weeklyDates(interval, rule.byWeekday ?? [], anchorKey, fromKey);
      return;
    case 'monthly':
      yield* monthlyDates(interval, rule.monthlyMode ?? 'dayOfMonth', anchorKey, fromKey);
      return;
  }
}

function* dailyDates(interval: number, anchorKey: DateKey, fromKey?: DateKey): Generator<RuleDate> {
  let k = fromKey && fromKey > anchorKey ? Math.floor(diffDays(anchorKey, fromKey) / interval) : 0;
  for (;;) {
    yield { index: k, key: addDays(anchorKey, k * interval) };
    k++;
  }
}

function* weeklyDates(
  interval: number,
  byWeekday: number[],
  anchorKey: DateKey,
  fromKey?: DateKey,
): Generator<RuleDate> {
  // Weeks start on Monday (ISO / RFC 5545 default). Offsets: Monday = 0 ... Sunday = 6.
  const weekdays = byWeekday.length ? byWeekday : [weekdayOf(anchorKey)];
  const offsets = [...new Set(weekdays.map((d) => (d + 6) % 7))].sort((a, b) => a - b);
  const firstWeekStart = startOfWeek(anchorKey, 1);
  const anchorOffset = diffDays(firstWeekStart, anchorKey);
  // In the first week, days before the start date are not occurrences.
  const firstWeekCount = offsets.filter((o) => o >= anchorOffset).length;

  let period =
    fromKey && fromKey > anchorKey
      ? Math.max(0, Math.floor(diffDays(firstWeekStart, fromKey) / (7 * interval)))
      : 0;
  let index = period === 0 ? 0 : firstWeekCount + (period - 1) * offsets.length;

  for (;;) {
    const weekStart = addDays(firstWeekStart, period * interval * 7);
    for (const offset of offsets) {
      if (period === 0 && offset < anchorOffset) continue;
      yield { index: index++, key: addDays(weekStart, offset) };
    }
    period++;
  }
}

function* monthlyDates(
  interval: number,
  mode: 'dayOfMonth' | 'nthWeekday' | 'lastWeekday',
  anchorKey: DateKey,
  fromKey?: DateKey,
): Generator<RuleDate> {
  const anchor = parseDateKey(anchorKey);
  if (!anchor) return;
  const weekday = weekdayOf(anchorKey);
  const nth = Math.ceil(anchor.day / 7); // 1..5 ("2nd Tuesday")
  const anchorMonthIndex = anchor.year * 12 + (anchor.month - 1);

  // Every month produces exactly one date unless we need a 5th weekday, which
  // some months lack. When no month can be skipped, index == period and we can jump.
  const canSkipMonths = mode === 'nthWeekday' && nth === 5;
  let period = 0;
  if (!canSkipMonths && fromKey && fromKey > anchorKey) {
    const from = parseDateKey(fromKey);
    if (from) {
      const monthsBetween = from.year * 12 + (from.month - 1) - anchorMonthIndex;
      period = Math.max(0, Math.floor(monthsBetween / interval) - 1);
    }
  }
  let index = period;

  for (;;) {
    const monthIndex = anchorMonthIndex + period * interval;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = monthlyDay(mode, year, month, anchor.day, weekday, nth);
    period++;
    if (day === null) continue; // e.g. no 5th Tuesday this month: skipped, not counted
    yield { index: index++, key: toDateKey(year, month, day) };
  }
}

/** Day of month for a monthly rule in a given month, or null if that month has no such day. */
function monthlyDay(
  mode: 'dayOfMonth' | 'nthWeekday' | 'lastWeekday',
  year: number,
  month: number,
  anchorDay: number,
  weekday: number,
  nth: number,
): number | null {
  const monthLength = daysInMonth(year, month);
  if (mode === 'dayOfMonth') {
    // "Monthly on the 31st" -> Feb 28/29, Apr 30... computed from the anchor
    // each time, so the day never drifts (Jan 31 -> Feb 28 -> Mar 31).
    return Math.min(anchorDay, monthLength);
  }
  const firstWeekday = weekdayOf(toDateKey(year, month, 1));
  if (mode === 'nthWeekday') {
    const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
    return day <= monthLength ? day : null;
  }
  const lastWeekday = weekdayOf(toDateKey(year, month, monthLength));
  return monthLength - ((lastWeekday - weekday + 7) % 7);
}
