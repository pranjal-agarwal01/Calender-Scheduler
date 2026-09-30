import { addDays, utcMsToDateKey } from './time/dateKey';
import { dateKeyInZone } from './time/zoned';
import { formatLongDate, formatTime } from './time/format';

/** Spoken/visible description of when something happens, e.g. for aria-live and aria-labels. */
export function describeWhen(start: number, end: number, allDay: boolean, timeZone: string): string {
  if (allDay) {
    const first = utcMsToDateKey(start);
    const last = addDays(utcMsToDateKey(end), -1);
    return first >= last ? `${formatLongDate(first)}, all day` : `${formatLongDate(first)} to ${formatLongDate(last)}, all day`;
  }
  const startDay = dateKeyInZone(start, timeZone);
  const endDay = dateKeyInZone(end, timeZone);
  if (startDay === endDay) return `${formatLongDate(startDay)}, ${formatTime(start, timeZone)} to ${formatTime(end, timeZone)}`;
  return `${formatLongDate(startDay)} ${formatTime(start, timeZone)} to ${formatLongDate(endDay)} ${formatTime(end, timeZone)}`;
}
