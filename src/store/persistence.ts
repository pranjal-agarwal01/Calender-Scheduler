/**
 * Browser persistence for events. DummyJSON stores nothing, so this is the
 * source of truth.
 *
 * - One localStorage key per user: `cal.calendar.u<id>`.
 * - Every payload carries `schemaVersion`. Data with an unknown version is not
 *   trusted: it is backed up and the calendar is re-seeded. If the format ever
 *   changes, bump SCHEMA_VERSION and convert the old shape in parsePersisted.
 * - Recovery is layered: unparseable JSON or a wrong top-level shape resets
 *   the calendar (keeping a backup of the raw text); a single bad event is
 *   dropped or repaired without losing the rest.
 */
import { EVENT_COLORS, type CalendarEvent, type EventColor, type RecurrenceRule, type Weekday } from '../domain/types';
import { isValidDateKey } from '../domain/time/dateKey';
import { isValidTimeZone } from '../domain/time/zoned';

export const SCHEMA_VERSION = 1;

export interface PersistedCalendar {
  schemaVersion: typeof SCHEMA_VERSION;
  savedAt: string;
  /** Monday the seed rule is anchored to (see domain/seed.ts). */
  seedAnchor: string | null;
  events: CalendarEvent[];
}

export type LoadOutcome =
  | { kind: 'empty' }
  | { kind: 'loaded'; data: PersistedCalendar; dropped: number; repaired: number }
  | { kind: 'corrupt'; reason: string; backupKey: string | null };

export const storageKey = (userId: number) => `cal.calendar.u${userId}`;

const isString = (v: unknown): v is string => typeof v === 'string';
const isIsoInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function validateRule(raw: unknown): RecurrenceRule | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return 'invalid';
  const r = raw as Record<string, unknown>;
  if (r.freq !== 'daily' && r.freq !== 'weekly' && r.freq !== 'monthly') return 'invalid';
  if (!isPositiveInt(r.interval) || r.interval > 99) return 'invalid';
  const end = r.end as Record<string, unknown> | undefined;
  let validEnd: RecurrenceRule['end'];
  if (end?.type === 'never') validEnd = { type: 'never' };
  else if (end?.type === 'until' && isString(end.until) && isValidDateKey(end.until)) validEnd = { type: 'until', until: end.until };
  else if (end?.type === 'count' && isPositiveInt(end.count) && end.count <= 999) validEnd = { type: 'count', count: end.count };
  else return 'invalid';

  const rule: RecurrenceRule = { freq: r.freq, interval: r.interval, end: validEnd };
  if (r.freq === 'weekly' && Array.isArray(r.byWeekday)) {
    const days = r.byWeekday.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length) rule.byWeekday = [...new Set(days)];
  }
  if (r.freq === 'monthly') {
    rule.monthlyMode =
      r.monthlyMode === 'nthWeekday' || r.monthlyMode === 'lastWeekday' ? r.monthlyMode : 'dayOfMonth';
  }
  return rule;
}

/** Validates one stored event. Returns null if unusable; `repaired` if defaults had to be filled in. */
function validateEvent(raw: unknown): { event: CalendarEvent; repaired: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!isString(e.id) || !e.id || !isIsoInstant(e.start) || !isIsoInstant(e.end)) return null;
  if (Date.parse(e.end) < Date.parse(e.start)) return null;

  let repaired = false;
  const fallback = <T>(ok: boolean, value: T, defaultValue: T): T => {
    if (ok) return value;
    repaired = true;
    return defaultValue;
  };

  const rule = validateRule(e.recurrence);
  const now = new Date().toISOString();
  const event: CalendarEvent = {
    id: e.id,
    title: fallback(isString(e.title), e.title as string, '(untitled)'),
    description: fallback(isString(e.description), e.description as string, ''),
    start: new Date(Date.parse(e.start)).toISOString(),
    end: new Date(Date.parse(e.end)).toISOString(),
    allDay: fallback(typeof e.allDay === 'boolean', e.allDay as boolean, false),
    timeZone: fallback(isString(e.timeZone) && isValidTimeZone(e.timeZone), e.timeZone as string, 'UTC'),
    organizerId: fallback(isPositiveInt(e.organizerId), e.organizerId as number, 1),
    attendeeIds: fallback(
      Array.isArray(e.attendeeIds) && e.attendeeIds.every(isPositiveInt),
      [...new Set(e.attendeeIds as number[])],
      [],
    ),
    reminderMinutes: fallback(
      e.reminderMinutes === null || (Number.isInteger(e.reminderMinutes) && (e.reminderMinutes as number) >= 0),
      (e.reminderMinutes ?? null) as number | null,
      null,
    ),
    color: fallback(EVENT_COLORS.includes(e.color as EventColor), e.color as EventColor, 'indigo'),
    recurrence: fallback(rule !== 'invalid', rule === 'invalid' ? null : rule, null),
    exdates: fallback(Array.isArray(e.exdates) && e.exdates.every(isIsoInstant), (e.exdates ?? []) as string[], []),
    recurringEventId: fallback(e.recurringEventId === null || isString(e.recurringEventId), (e.recurringEventId ?? null) as string | null, null),
    originalStart: fallback(e.originalStart === null || isIsoInstant(e.originalStart), (e.originalStart ?? null) as string | null, null),
    remoteId: fallback(e.remoteId === null || isPositiveInt(e.remoteId), (e.remoteId ?? null) as number | null, null),
    createdAt: fallback(isIsoInstant(e.createdAt), e.createdAt as string, now),
    updatedAt: fallback(isIsoInstant(e.updatedAt), e.updatedAt as string, now),
  };
  return { event, repaired };
}

/** Pure parse + validate step (unit-tested without a browser). */
export function parsePersisted(
  raw: string,
): { data: PersistedCalendar; dropped: number; repaired: number } | { error: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'Stored calendar is not valid JSON.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'Stored calendar has an unexpected shape.' };

  const record = payload as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION) {
    return { error: `Stored calendar has an unsupported schema version (${String(record.schemaVersion)}).` };
  }
  if (!Array.isArray(record.events)) return { error: 'Stored calendar has no events list.' };

  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  let dropped = 0;
  let repaired = 0;
  for (const rawEvent of record.events) {
    const result = validateEvent(rawEvent);
    if (!result || seen.has(result.event.id)) {
      dropped++;
      continue;
    }
    if (result.repaired) repaired++;
    seen.add(result.event.id);
    events.push(result.event);
  }

  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      savedAt: isIsoInstant(record.savedAt) ? record.savedAt : new Date().toISOString(),
      seedAnchor: isString(record.seedAnchor) && isValidDateKey(record.seedAnchor) ? record.seedAnchor : null,
      events,
    },
    dropped,
    repaired,
  };
}

export function loadCalendar(userId: number, storage: Storage = localStorage): LoadOutcome {
  const key = storageKey(userId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { kind: 'corrupt', reason: 'Browser storage is not available.', backupKey: null };
  }
  if (raw === null) return { kind: 'empty' };

  const parsed = parsePersisted(raw);
  if ('error' in parsed) {
    // Keep the unreadable text so nothing is lost for good, then start fresh.
    const backupKey = `${key}.corrupt`;
    try {
      storage.setItem(backupKey, raw);
    } catch {
      /* best effort */
    }
    return { kind: 'corrupt', reason: parsed.error, backupKey };
  }
  return { kind: 'loaded', ...parsed };
}

export function saveCalendar(
  userId: number,
  data: Omit<PersistedCalendar, 'schemaVersion' | 'savedAt'>,
  storage: Storage = localStorage,
): { ok: true } | { ok: false; error: string } {
  const payload: PersistedCalendar = { schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), ...data };
  try {
    storage.setItem(storageKey(userId), JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    const quota = error instanceof DOMException && error.name === 'QuotaExceededError';
    return { ok: false, error: quota ? 'Browser storage is full.' : 'Could not save to browser storage.' };
  }
}
