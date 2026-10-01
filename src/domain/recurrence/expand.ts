/**
 * Turns stored events into drawable occurrences for a visible range.
 *
 * Recurring events are stored once (the "master" + its rule). Instances are
 * generated on demand for the range being shown only, so a daily series with
 * no end never produces more than ~42 instances (a month grid).
 */
import type { CalendarEvent, EventsById, Occurrence } from '../types';
import { addDays, type DateKey } from '../time/dateKey';
import { dateKeyInZone, FLOATING_ZONE, minutesInZone, zonedToUtc } from '../time/zoned';
import { ruleDates } from './ruleDates';

/** Safety net against malformed rules: never generate more than this many candidates per call. */
const MAX_ITERATIONS = 20_000;

const OCCURRENCE_SEPARATOR = '~';

/** Zone whose wall clock a series repeats in. All-day events use floating UTC dates. */
export function expansionZone(event: CalendarEvent): string {
  return event.allDay ? FLOATING_ZONE : event.timeZone;
}

interface SeriesAnchor {
  key: DateKey;
  minutes: number;
  zone: string;
  duration: number;
}

function seriesAnchor(event: CalendarEvent): SeriesAnchor {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const zone = expansionZone(event);
  return {
    key: dateKeyInZone(start, zone),
    minutes: minutesInZone(start, zone),
    zone,
    duration: Math.max(0, end - start),
  };
}

export function occurrenceKey(seriesId: string, originalStart: number): string {
  return `${seriesId}${OCCURRENCE_SEPARATOR}${originalStart}`;
}

function parseOccurrenceKey(key: string): { seriesId: string; originalStart: number } | null {
  const at = key.lastIndexOf(OCCURRENCE_SEPARATOR);
  if (at <= 0) return null;
  const originalStart = Number(key.slice(at + 1));
  if (!Number.isSafeInteger(originalStart)) return null;
  return { seriesId: key.slice(0, at), originalStart };
}

function overlapsRange(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  if (start === end) return start >= rangeStart && start < rangeEnd; // zero-length events
  return start < rangeEnd && end > rangeStart;
}

function singleOccurrence(event: CalendarEvent): Occurrence {
  const start = Date.parse(event.start);
  return {
    key: event.id,
    event,
    seriesId: event.recurringEventId,
    originalStart: event.originalStart ? Date.parse(event.originalStart) : start,
    start,
    end: Date.parse(event.end),
    allDay: event.allDay,
    isInstance: false,
  };
}

interface GeneratedDate {
  index: number;
  start: number;
  end: number;
}

/**
 * Walks a series' occurrences in order starting near `fromMs`, honouring
 * count/until. Exdates are NOT removed here (they still count towards COUNT,
 * as in RFC 5545); callers filter them.
 */
export function* seriesDates(event: CalendarEvent, fromMs?: number): Generator<GeneratedDate> {
  const rule = event.recurrence;
  if (!rule) return;
  const anchor = seriesAnchor(event);
  const fromKey = fromMs === undefined ? undefined : addDays(dateKeyInZone(fromMs - anchor.duration, anchor.zone), -1);

  let iterations = 0;
  for (const { index, key } of ruleDates(rule, anchor.key, fromKey)) {
    if (++iterations > MAX_ITERATIONS) return;
    if (rule.end.type === 'count' && index >= rule.end.count) return;
    if (rule.end.type === 'until' && key > rule.end.until) return;
    const start = zonedToUtc(key, anchor.minutes, anchor.zone);
    yield { index, start, end: start + anchor.duration };
  }
}

export function expandEvent(event: CalendarEvent, rangeStart: number, rangeEnd: number): Occurrence[] {
  if (!event.recurrence) {
    const single = singleOccurrence(event);
    return overlapsRange(single.start, single.end, rangeStart, rangeEnd) ? [single] : [];
  }

  const excluded = new Set(event.exdates.map((iso) => Date.parse(iso)));
  const occurrences: Occurrence[] = [];
  for (const date of seriesDates(event, rangeStart)) {
    if (date.start >= rangeEnd) break;
    if (!overlapsRange(date.start, date.end, rangeStart, rangeEnd)) continue;
    if (excluded.has(date.start)) continue;
    occurrences.push({
      key: occurrenceKey(event.id, date.start),
      event,
      seriesId: event.id,
      originalStart: date.start,
      start: date.start,
      end: date.end,
      allDay: event.allDay,
      isInstance: true,
    });
  }
  return occurrences;
}

/**
 * Locates a specific occurrence of a series by its original start.
 * Returns its index in the series, or null if the rule never produces it.
 */
export function findSeriesOccurrence(event: CalendarEvent, originalStart: number): { index: number } | null {
  for (const date of seriesDates(event, originalStart)) {
    if (date.start === originalStart) return { index: date.index };
    if (date.start > originalStart) return null;
  }
  return null;
}

export function firstSeriesOccurrence(event: CalendarEvent): GeneratedDate | null {
  const excluded = new Set(event.exdates.map((iso) => Date.parse(iso)));
  let checked = 0;
  for (const date of seriesDates(event)) {
    if (!excluded.has(date.start)) return date;
    if (++checked > 5000) return null;
  }
  return null;
}

/*
 * Memoised expansion of every event for a range. Events are immutable, so an
 * unchanged event object keeps its cached occurrences (same object identity),
 * which lets React.memo skip re-rendering blocks that did not change.
 */
const expansionCache = new WeakMap<CalendarEvent, { rangeStart: number; rangeEnd: number; value: Occurrence[] }>();

export function expandAll(events: EventsById, rangeStart: number, rangeEnd: number): Occurrence[] {
  const all: Occurrence[] = [];
  for (const event of Object.values(events)) {
    let entry = expansionCache.get(event);
    if (!entry || entry.rangeStart !== rangeStart || entry.rangeEnd !== rangeEnd) {
      entry = { rangeStart, rangeEnd, value: expandEvent(event, rangeStart, rangeEnd) };
      expansionCache.set(event, entry);
    }
    for (const occurrence of entry.value) all.push(occurrence);
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
  return all;
}

/**
 * Resolves the id from `/events/:id` to an occurrence:
 *  - a stored event id (single event, override, or a series -> its first occurrence)
 *  - `${seriesId}~${originalStartMs}` for a generated instance.
 * Returns null for anything that does not exist ("Not found").
 */
export function resolveOccurrence(events: EventsById, key: string): Occurrence | null {
  const direct = events[key];
  if (direct) {
    if (!direct.recurrence) return singleOccurrence(direct);
    const first = firstSeriesOccurrence(direct);
    if (!first) return null;
    return {
      key: occurrenceKey(direct.id, first.start),
      event: direct,
      seriesId: direct.id,
      originalStart: first.start,
      start: first.start,
      end: first.end,
      allDay: direct.allDay,
      isInstance: true,
    };
  }

  const parsed = parseOccurrenceKey(key);
  if (!parsed) return null;
  const master = events[parsed.seriesId];
  if (!master?.recurrence) return null;
  if (master.exdates.some((iso) => Date.parse(iso) === parsed.originalStart)) {
    // The instance was replaced by an override: resolve to it if it still exists.
    const override = Object.values(events).find(
      (e) => e.recurringEventId === master.id && e.originalStart && Date.parse(e.originalStart) === parsed.originalStart,
    );
    return override ? singleOccurrence(override) : null;
  }
  if (!findSeriesOccurrence(master, parsed.originalStart)) return null;
  const duration = Date.parse(master.end) - Date.parse(master.start);
  return {
    key,
    event: master,
    seriesId: master.id,
    originalStart: parsed.originalStart,
    start: parsed.originalStart,
    end: parsed.originalStart + duration,
    allDay: master.allDay,
    isInstance: true,
  };
}
