/**
 * Display formatting via Intl. Formatters are expensive to construct, so they
 * are cached per (options, time zone).
 */
import { dateKeyToUtcMs, type DateKey } from './dateKey';
import { FLOATING_ZONE } from './zoned';

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(undefined, { ...options, timeZone });
    cache.set(key, fmt);
  }
  return fmt;
}

/** Formats a date key (a floating calendar date). */
function formatDateKey(key: DateKey, options: Intl.DateTimeFormatOptions): string {
  return formatter(options, FLOATING_ZONE).format(dateKeyToUtcMs(key));
}

export function formatTime(ms: number, timeZone: string): string {
  return formatter({ hour: 'numeric', minute: '2-digit' }, timeZone).format(ms);
}

export function formatTimeRange(start: number, end: number, timeZone: string): string {
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`;
}

/** Compact hour label for the time gutter, e.g. "9 AM" / "09". */
export function formatHourLabel(ms: number, timeZone: string): string {
  return formatter({ hour: 'numeric' }, timeZone).format(ms);
}

export function formatWeekdayShort(key: DateKey): string {
  return formatDateKey(key, { weekday: 'short' });
}

export function formatWeekdayNarrow(key: DateKey): string {
  return formatDateKey(key, { weekday: 'narrow' });
}

export function formatDayNumber(key: DateKey): string {
  return formatDateKey(key, { day: 'numeric' });
}

export function formatMonthYear(key: DateKey): string {
  return formatDateKey(key, { month: 'long', year: 'numeric' });
}

export function formatMonthDay(key: DateKey): string {
  return formatDateKey(key, { month: 'short', day: 'numeric' });
}

export function formatLongDate(key: DateKey): string {
  return formatDateKey(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatMediumDate(key: DateKey): string {
  return formatDateKey(key, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Oct 5 – 11, 2026" style range title (Intl handles collapsing shared parts). */
export function formatDateKeyRange(start: DateKey, end: DateKey): string {
  const fmt = formatter({ month: 'short', day: 'numeric', year: 'numeric' }, FLOATING_ZONE);
  return fmt.formatRange(dateKeyToUtcMs(start), dateKeyToUtcMs(end));
}

/** "GMT+5:30" style offset label for a zone at a given instant. */
export function formatZoneOffset(timeZone: string, at = Date.now()): string {
  const part = formatter({ timeZoneName: 'shortOffset' }, timeZone)
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}
