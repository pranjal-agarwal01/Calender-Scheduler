/**
 * Calendar state that lives in the URL: ?view=week&date=2026-10-05&tz=Asia/Kolkata&attendees=1,5
 * Anything missing or invalid falls back to a safe default, and the caller
 * rewrites the URL to the canonical form (replace, not push).
 */
import { isValidDateKey, type DateKey } from './time/dateKey';
import { isValidTimeZone, todayKey } from './time/zoned';

export type CalendarView = 'week' | 'month';

export interface CalendarUrlState {
  view: CalendarView;
  date: DateKey;
  timeZone: string;
  attendeeIds: number[];
}

const MAX_ATTENDEE_FILTER = 20;

export function parseCalendarParams(
  params: URLSearchParams,
  fallbackTimeZone: string,
  now = Date.now(),
): { state: CalendarUrlState; canonical: URLSearchParams; isCanonical: boolean } {
  const rawTz = params.get('tz');
  const timeZone = rawTz && isValidTimeZone(rawTz) ? rawTz : fallbackTimeZone;

  const rawView = params.get('view');
  const view: CalendarView = rawView === 'month' ? 'month' : 'week';

  const rawDate = params.get('date');
  const date = rawDate && isValidDateKey(rawDate) ? rawDate : todayKey(timeZone, now);

  const attendeeIds = [
    ...new Set(
      (params.get('attendees') ?? '')
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ]
    .slice(0, MAX_ATTENDEE_FILTER)
    .sort((a, b) => a - b);

  const state = { view, date, timeZone, attendeeIds };
  const canonical = serializeCalendarState(state);
  return { state, canonical, isCanonical: canonical.toString() === params.toString() };
}

export function serializeCalendarState(state: CalendarUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('view', state.view);
  params.set('date', state.date);
  params.set('tz', state.timeZone);
  if (state.attendeeIds.length) params.set('attendees', state.attendeeIds.join(','));
  return params;
}
