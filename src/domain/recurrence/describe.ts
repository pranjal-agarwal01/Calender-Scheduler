import type { MonthlyMode, RecurrenceRule, Weekday } from '../types';
import { formatMediumDate } from '../time/format';
import { parseDateKey, weekdayOf, type DateKey } from '../time/dateKey';

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday-first order used by the weekday picker. */
export const WEEKDAYS_MONDAY_FIRST: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

export function nthOfMonth(key: DateKey): number {
  const parts = parseDateKey(key);
  return parts ? Math.ceil(parts.day / 7) : 1;
}

/** True when the date is the last such weekday of its month (e.g. the last Friday). */
export function isLastWeekdayOfMonth(key: DateKey): boolean {
  const parts = parseDateKey(key);
  if (!parts) return false;
  const nextWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 7));
  return nextWeek.getUTCMonth() !== parts.month - 1;
}

export function describeMonthlyMode(mode: MonthlyMode, startKey: DateKey): string {
  const parts = parseDateKey(startKey);
  const day = parts?.day ?? 1;
  const weekday = WEEKDAY_NAMES[weekdayOf(startKey)];
  switch (mode) {
    case 'dayOfMonth':
      return `on day ${day}`;
    case 'nthWeekday':
      return `on the ${ORDINALS[nthOfMonth(startKey) - 1]} ${weekday}`;
    case 'lastWeekday':
      return `on the last ${weekday}`;
  }
}

function plural(n: number, unit: string): string {
  return n === 1 ? unit : `${n} ${unit}s`;
}

/** Human summary, e.g. "Every 2 weeks on Tue, Thu, until Dec 31, 2026". */
export function describeRule(rule: RecurrenceRule, startKey: DateKey): string {
  const interval = Math.max(1, rule.interval);
  let text: string;
  switch (rule.freq) {
    case 'daily':
      text = interval === 1 ? 'Daily' : `Every ${plural(interval, 'day')}`;
      break;
    case 'weekly': {
      const days = (rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(startKey) as Weekday])
        .slice()
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => WEEKDAY_SHORT[d])
        .join(', ');
      text = `${interval === 1 ? 'Weekly' : `Every ${plural(interval, 'week')}`} on ${days}`;
      break;
    }
    case 'monthly':
      text = `${interval === 1 ? 'Monthly' : `Every ${plural(interval, 'month')}`} ${describeMonthlyMode(
        rule.monthlyMode ?? 'dayOfMonth',
        startKey,
      )}`;
      break;
  }
  if (rule.end.type === 'until') text += `, until ${formatMediumDate(rule.end.until)}`;
  if (rule.end.type === 'count') text += `, ${rule.end.count} ${rule.end.count === 1 ? 'time' : 'times'}`;
  return text;
}
