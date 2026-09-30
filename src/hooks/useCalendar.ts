import { useCallback, useMemo } from 'react';
import { useCalendarStore } from '../store/calendarStore';
import { useCalendarUrlState } from './useCalendarUrlState';
import { expandAll } from '../domain/recurrence/expand';
import {
  addDays,
  addMonths,
  DAY_MS,
  daysInMonth,
  diffDays,
  parseDateKey,
  startOfMonth,
  startOfWeek,
  dateRange,
  type DateKey,
} from '../domain/time/dateKey';
import { startOfDayInZone, todayKey } from '../domain/time/zoned';
import { formatDateKeyRange, formatMonthYear } from '../domain/time/format';
import type { Occurrence } from '../domain/types';
import type { CalendarView } from '../domain/urlState';
import { WEEK_STARTS_ON } from '../config';

export function visibleDays(view: CalendarView, date: DateKey): DateKey[] {
  if (view === 'week') return dateRange(startOfWeek(date, WEEK_STARTS_ON), 7);
  const first = startOfMonth(date);
  const gridStart = startOfWeek(first, WEEK_STARTS_ON);
  const parts = parseDateKey(first)!;
  const weeks = Math.ceil((diffDays(gridStart, first) + daysInMonth(parts.year, parts.month)) / 7);
  return dateRange(gridStart, weeks * 7);
}

function matchesAttendees(occurrence: Occurrence, attendeeIds: number[]): boolean {
  const { organizerId, attendeeIds: attendees } = occurrence.event;
  return attendeeIds.some((id) => id === organizerId || attendees.includes(id));
}

/**
 * Everything a calendar view needs: URL state, the visible days, the
 * occurrences in range (expanded + filtered, memoised), and navigation.
 */
export function useCalendar() {
  const { state, search, update } = useCalendarUrlState();
  const { view, date, timeZone, attendeeIds } = state;
  const events = useCalendarStore((s) => s.events);

  const days = useMemo(() => visibleDays(view, date), [view, date]);
  const rangeStart = useMemo(() => startOfDayInZone(days[0], timeZone), [days, timeZone]);
  const rangeEnd = useMemo(() => startOfDayInZone(addDays(days[days.length - 1], 1), timeZone), [days, timeZone]);

  // Padded by a day so floating all-day events near the edges are included in every zone.
  const allOccurrences = useMemo(
    () => expandAll(events, rangeStart - DAY_MS, rangeEnd + DAY_MS),
    [events, rangeStart, rangeEnd],
  );
  const attendeeKey = attendeeIds.join(',');
  const occurrences = useMemo(
    () => (attendeeIds.length ? allOccurrences.filter((o) => matchesAttendees(o, attendeeIds)) : allOccurrences),
    // attendeeKey is the stable identity of the attendeeIds array
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allOccurrences, attendeeKey],
  );

  const title = view === 'week' ? formatDateKeyRange(days[0], days[6]) : formatMonthYear(date);

  const goToDate = useCallback((next: DateKey) => update({ date: next }), [update]);
  const goPrev = useCallback(
    () => update({ date: view === 'week' ? addDays(date, -7) : addMonths(date, -1) }),
    [update, view, date],
  );
  const goNext = useCallback(
    () => update({ date: view === 'week' ? addDays(date, 7) : addMonths(date, 1) }),
    [update, view, date],
  );
  const goToday = useCallback(() => update({ date: todayKey(timeZone) }), [update, timeZone]);
  const setView = useCallback((next: CalendarView) => update({ view: next }), [update]);
  const setTimeZone = useCallback((next: string) => update({ timeZone: next }), [update]);
  const setAttendeeIds = useCallback((ids: number[]) => update({ attendeeIds: ids }, { replace: true }), [update]);
  const showWeekOf = useCallback((day: DateKey) => update({ view: 'week', date: day }), [update]);

  return {
    view,
    date,
    timeZone,
    attendeeIds,
    search,
    days,
    rangeStart,
    rangeEnd,
    occurrences,
    totalInRange: allOccurrences.length,
    title,
    goPrev,
    goNext,
    goToday,
    goToDate,
    setView,
    setTimeZone,
    setAttendeeIds,
    showWeekOf,
  };
}

export type CalendarModel = ReturnType<typeof useCalendar>;
