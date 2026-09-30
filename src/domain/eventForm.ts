/**
 * Event form <-> draft conversion and validation (pure, unit-tested).
 * Form fields are strings (what <input> gives us); the draft uses UTC ms.
 */
import type { EventColor, EventDraft, MonthlyMode, RecurrenceFrequency, RecurrenceRule, Weekday } from './types';
import { addDays, addMonths, dateKeyToUtcMs, isValidDateKey, utcMsToDateKey, weekdayOf } from './time/dateKey';
import { dateKeyInZone, minutesInZone, zonedToUtc } from './time/zoned';

export interface EventFormValues {
  title: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  attendeeIds: number[];
  reminderMinutes: number | null;
  color: EventColor;
  repeat: 'none' | RecurrenceFrequency;
  interval: string;
  byWeekday: Weekday[];
  monthlyMode: MonthlyMode;
  endType: 'never' | 'until' | 'count';
  until: string;
  count: string;
}

export type FormField = 'title' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'interval' | 'byWeekday' | 'until' | 'count';
export type FormErrors = Partial<Record<FormField, string>>;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timeToMinutes(time: string): number | null {
  const match = TIME_RE.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function valuesFromDraft(draft: EventDraft, timeZone: string): EventFormValues {
  const startDate = draft.allDay ? utcMsToDateKey(draft.start) : dateKeyInZone(draft.start, timeZone);
  const endDate = draft.allDay ? addDays(utcMsToDateKey(draft.end), -1) : dateKeyInZone(draft.end, timeZone);
  const rule = draft.recurrence;
  return {
    title: draft.title,
    description: draft.description,
    allDay: draft.allDay,
    startDate,
    startTime: draft.allDay ? '09:00' : minutesToTime(minutesInZone(draft.start, timeZone)),
    endDate: endDate < startDate ? startDate : endDate,
    endTime: draft.allDay ? '10:00' : minutesToTime(minutesInZone(draft.end, timeZone)),
    attendeeIds: [...draft.attendeeIds],
    reminderMinutes: draft.reminderMinutes,
    color: draft.color,
    repeat: rule?.freq ?? 'none',
    interval: String(rule?.interval ?? 1),
    byWeekday: rule?.byWeekday?.length ? [...rule.byWeekday] : [weekdayOf(startDate) as Weekday],
    monthlyMode: rule?.monthlyMode ?? 'dayOfMonth',
    endType: rule?.end.type ?? 'never',
    until: rule?.end.type === 'until' ? rule.end.until : addMonths(startDate, 3),
    count: String(rule?.end.type === 'count' ? rule.end.count : 10),
  };
}

function parseIntInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export function draftFromValues(values: EventFormValues, timeZone: string): { draft: EventDraft | null; errors: FormErrors } {
  const errors: FormErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = 'Please enter a title.';
  else if (title.length > 200) errors.title = 'Keep the title under 200 characters.';

  if (!isValidDateKey(values.startDate)) errors.startDate = 'Enter a valid start date.';
  if (!isValidDateKey(values.endDate)) errors.endDate = 'Enter a valid end date.';

  let start = NaN;
  let end = NaN;
  if (values.allDay) {
    if (!errors.startDate && !errors.endDate) {
      if (values.endDate < values.startDate) errors.endDate = 'End date must be on or after the start date.';
      start = dateKeyToUtcMs(values.startDate);
      end = dateKeyToUtcMs(addDays(values.endDate, 1));
    }
  } else {
    const startMinutes = timeToMinutes(values.startTime);
    const endMinutes = timeToMinutes(values.endTime);
    if (startMinutes === null) errors.startTime = 'Enter a valid start time.';
    if (endMinutes === null) errors.endTime = 'Enter a valid end time.';
    if (!errors.startDate && !errors.endDate && startMinutes !== null && endMinutes !== null) {
      start = zonedToUtc(values.startDate, startMinutes, timeZone);
      end = zonedToUtc(values.endDate, endMinutes, timeZone);
      if (end <= start) errors.endTime = 'End must be after the start.';
    }
  }

  let recurrence: RecurrenceRule | null = null;
  if (values.repeat !== 'none') {
    const interval = parseIntInRange(values.interval, 1, 99);
    if (interval === null) errors.interval = 'Enter a number from 1 to 99.';
    if (values.repeat === 'weekly' && values.byWeekday.length === 0) errors.byWeekday = 'Pick at least one day.';
    let end: RecurrenceRule['end'] = { type: 'never' };
    if (values.endType === 'until') {
      if (!isValidDateKey(values.until)) errors.until = 'Enter a valid end date.';
      else if (isValidDateKey(values.startDate) && values.until < values.startDate) errors.until = 'Must be on or after the start date.';
      else end = { type: 'until', until: values.until };
    } else if (values.endType === 'count') {
      const count = parseIntInRange(values.count, 1, 999);
      if (count === null) errors.count = 'Enter a number from 1 to 999.';
      else end = { type: 'count', count };
    }
    if (interval !== null) {
      recurrence = { freq: values.repeat, interval, end };
      if (values.repeat === 'weekly') recurrence.byWeekday = [...values.byWeekday].sort((a, b) => a - b);
      if (values.repeat === 'monthly') recurrence.monthlyMode = values.monthlyMode;
    }
  }

  if (Object.keys(errors).length) return { draft: null, errors };
  return {
    draft: {
      title,
      description: values.description,
      start,
      end,
      allDay: values.allDay,
      timeZone,
      attendeeIds: values.attendeeIds,
      reminderMinutes: values.reminderMinutes,
      color: values.color,
      recurrence,
    },
    errors,
  };
}

/** Moving the start keeps the event's duration (like most calendars). */
export function shiftEndWithStart(previous: EventFormValues, next: EventFormValues, timeZone: string): EventFormValues {
  const before = draftTimes(previous, timeZone);
  const after = draftTimes({ ...next, endDate: previous.endDate, endTime: previous.endTime }, timeZone);
  if (!before || !after || before.end <= before.start) return next;
  const duration = before.end - before.start;
  if (next.allDay) {
    const days = Math.round(duration / 86_400_000) - 1;
    return { ...next, endDate: addDays(next.startDate, Math.max(0, days)) };
  }
  const newEnd = after.start + duration;
  return { ...next, endDate: dateKeyInZone(newEnd, timeZone), endTime: minutesToTime(minutesInZone(newEnd, timeZone)) };
}

function draftTimes(values: EventFormValues, timeZone: string): { start: number; end: number } | null {
  if (!isValidDateKey(values.startDate) || !isValidDateKey(values.endDate)) return null;
  if (values.allDay) return { start: dateKeyToUtcMs(values.startDate), end: dateKeyToUtcMs(addDays(values.endDate, 1)) };
  const s = timeToMinutes(values.startTime);
  const e = timeToMinutes(values.endTime);
  if (s === null || e === null) return null;
  return { start: zonedToUtc(values.startDate, s, timeZone), end: zonedToUtc(values.endDate, e, timeZone) };
}
