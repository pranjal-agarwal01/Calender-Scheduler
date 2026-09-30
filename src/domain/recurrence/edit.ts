/**
 * Plans edits and deletes as lists of EventChange snapshots.
 *
 * These functions are pure: they read the current events and return what
 * should change. The store wraps the result in an undoable command, so a
 * recurrence edit that touches several records (e.g. "this and following"
 * truncates one series and creates another) is still ONE undo step.
 *
 * Series model (similar to Google Calendar / RFC 5545):
 *  - master: stores the rule; instances are generated, never stored.
 *  - exdates: original starts of instances that were deleted or overridden.
 *  - override: a normal event with `recurringEventId` + `originalStart`,
 *    created by "this event" edits.
 */
import { created, deleted, toIso, updated, type EventChange } from '../changes';
import type {
  CalendarEvent,
  EditScope,
  EventDraft,
  EventsById,
  Occurrence,
  RecurrenceEnd,
  RecurrenceRule,
  Weekday,
} from '../types';
import { addDays, diffDays } from '../time/dateKey';
import { dateKeyInZone, FLOATING_ZONE, minutesInZone, zonedToUtc } from '../time/zoned';
import { expansionZone, findSeriesOccurrence, firstSeriesOccurrence } from './expand';

export interface PlanContext {
  now: string;
  newId: () => string;
  organizerId: number;
}

type SharedField = 'title' | 'description' | 'attendeeIds' | 'reminderMinutes' | 'color';
const SHARED_FIELDS: SharedField[] = ['title', 'description', 'attendeeIds', 'reminderMinutes', 'color'];

function normaliseRule(rule: RecurrenceRule | null): string {
  if (!rule) return 'none';
  return JSON.stringify({
    freq: rule.freq,
    interval: rule.interval,
    byWeekday: rule.freq === 'weekly' ? [...(rule.byWeekday ?? [])].sort() : undefined,
    monthlyMode: rule.freq === 'monthly' ? (rule.monthlyMode ?? 'dayOfMonth') : undefined,
    end: rule.end,
  });
}

export function sameRule(a: RecurrenceRule | null, b: RecurrenceRule | null): boolean {
  return normaliseRule(a) === normaliseRule(b);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Initial form / drag values for an occurrence. Overrides show their series' rule. */
export function draftFromOccurrence(occurrence: Occurrence, events: EventsById): EventDraft {
  const { event } = occurrence;
  const master = occurrence.seriesId ? events[occurrence.seriesId] : undefined;
  return {
    title: event.title,
    description: event.description,
    start: occurrence.start,
    end: occurrence.end,
    allDay: occurrence.allDay,
    timeZone: event.timeZone,
    attendeeIds: [...event.attendeeIds],
    reminderMinutes: event.reminderMinutes,
    color: event.color,
    recurrence: master?.recurrence ?? event.recurrence,
  };
}

function applyDraft(event: CalendarEvent, draft: EventDraft, now: string): CalendarEvent {
  return {
    ...event,
    title: draft.title.trim(),
    description: draft.description.trim(),
    start: toIso(draft.start),
    end: toIso(draft.end),
    allDay: draft.allDay,
    timeZone: draft.timeZone,
    attendeeIds: [...draft.attendeeIds],
    reminderMinutes: draft.reminderMinutes,
    color: draft.color,
    recurrence: draft.recurrence,
    exdates: draft.recurrence ? event.exdates : [],
    updatedAt: now,
  };
}

export function newEventFromDraft(draft: EventDraft, ctx: PlanContext): CalendarEvent {
  return applyDraft(
    {
      id: ctx.newId(),
      title: '',
      description: '',
      start: toIso(draft.start),
      end: toIso(draft.end),
      allDay: draft.allDay,
      timeZone: draft.timeZone,
      organizerId: ctx.organizerId,
      attendeeIds: [],
      reminderMinutes: null,
      color: draft.color,
      recurrence: null,
      exdates: [],
      recurringEventId: null,
      originalStart: null,
      remoteId: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    },
    draft,
    ctx.now,
  );
}

export function planCreate(draft: EventDraft, ctx: PlanContext): EventChange[] {
  return [created(newEventFromDraft(draft, ctx))];
}

/** Fields the user actually changed compared to the occurrence they started from. */
function changedSharedFields(occurrence: Occurrence, draft: EventDraft): Partial<CalendarEvent> {
  const changes: Partial<CalendarEvent> = {};
  for (const field of SHARED_FIELDS) {
    const draftValue = field === 'title' || field === 'description' ? draft[field].trim() : draft[field];
    if (!sameValue(occurrence.event[field], draftValue)) {
      (changes as Record<string, unknown>)[field] = draftValue;
    }
  }
  return changes;
}

function timeChanged(occurrence: Occurrence, draft: EventDraft, master: CalendarEvent): boolean {
  return (
    draft.start !== occurrence.start ||
    draft.end !== occurrence.end ||
    draft.allDay !== occurrence.allDay ||
    (!draft.allDay && draft.timeZone !== master.timeZone)
  );
}

/**
 * When a series' time changes, every date tied to it (the start, exdates,
 * override original starts) moves by the same number of calendar days and
 * takes the new wall-clock time. Done in calendar days, not milliseconds,
 * so DST cannot shift anything by an hour.
 */
interface SeriesShift {
  dayDelta: number;
  duration: number;
  zone: string;
  shift: (ms: number) => number;
}

function seriesShift(master: CalendarEvent, occurrence: Occurrence, draft: EventDraft): SeriesShift {
  const oldZone = expansionZone(master);
  const newZone = draft.allDay ? FLOATING_ZONE : draft.timeZone;
  const dayDelta = diffDays(dateKeyInZone(occurrence.start, oldZone), dateKeyInZone(draft.start, newZone));
  const minutes = minutesInZone(draft.start, newZone);
  return {
    dayDelta,
    duration: draft.end - draft.start,
    zone: newZone,
    shift: (ms) => zonedToUtc(addDays(dateKeyInZone(ms, oldZone), dayDelta), minutes, newZone),
  };
}

function shiftWeekdays(rule: RecurrenceRule, dayDelta: number): RecurrenceRule {
  if (rule.freq !== 'weekly' || !rule.byWeekday?.length || dayDelta % 7 === 0) return rule;
  const byWeekday = rule.byWeekday.map((d) => ((((d + dayDelta) % 7) + 7) % 7) as Weekday);
  return { ...rule, byWeekday: [...new Set(byWeekday)] };
}

function overridesOf(events: EventsById, masterId: string): CalendarEvent[] {
  return Object.values(events).filter((e) => e.recurringEventId === masterId);
}

function hasVisibleOccurrenceBefore(master: CalendarEvent, originalStart: number): boolean {
  const first = firstSeriesOccurrence(master);
  return first !== null && first.start < originalStart;
}

export function planEdit(
  events: EventsById,
  occurrence: Occurrence,
  draft: EventDraft,
  scope: EditScope,
  ctx: PlanContext,
): EventChange[] {
  const current = events[occurrence.event.id];
  if (!current) return []; // deleted meanwhile (e.g. a failed save was rolled back)
  const master = occurrence.seriesId ? events[occurrence.seriesId] : undefined;

  if (!master?.recurrence) {
    // Plain single event (or an override whose series no longer exists).
    return [updated(current, applyDraft(current, draft, ctx.now))];
  }
  if (scope === 'this') return planEditThis(master, occurrence, draft, ctx);

  const found = findSeriesOccurrence(master, occurrence.originalStart);
  if (scope === 'all' || !found || !hasVisibleOccurrenceBefore(master, occurrence.originalStart)) {
    return planEditAll(events, master, occurrence, draft, ctx);
  }
  return planEditFollowing(events, master, occurrence, found.index, draft, ctx);
}

function planEditThis(
  master: CalendarEvent,
  occurrence: Occurrence,
  draft: EventDraft,
  ctx: PlanContext,
): EventChange[] {
  const singleDraft = { ...draft, recurrence: null };
  if (!occurrence.isInstance) {
    // Already an override: just update it.
    return [updated(occurrence.event, applyDraft(occurrence.event, singleDraft, ctx.now))];
  }
  const override: CalendarEvent = {
    ...newEventFromDraft(singleDraft, ctx),
    organizerId: master.organizerId,
    recurringEventId: master.id,
    originalStart: toIso(occurrence.originalStart),
  };
  const masterAfter: CalendarEvent = {
    ...master,
    exdates: [...master.exdates, toIso(occurrence.originalStart)],
    updatedAt: ctx.now,
  };
  return [updated(master, masterAfter), created(override)];
}

function planEditAll(
  events: EventsById,
  master: CalendarEvent,
  occurrence: Occurrence,
  draft: EventDraft,
  ctx: PlanContext,
): EventChange[] {
  const changes: EventChange[] = [];
  const shared = changedSharedFields(occurrence, draft);
  const overrides = overridesOf(events, master.id);

  if (!draft.recurrence) {
    // "Does not repeat" for all events: the series collapses into one event at the edited time.
    changes.push(updated(master, { ...applyDraft(master, draft, ctx.now), exdates: [] }));
    for (const override of overrides) changes.push(deleted(override));
    return changes;
  }

  const shift = timeChanged(occurrence, draft, master) ? seriesShift(master, occurrence, draft) : null;
  const ruleChanged = !sameRule(draft.recurrence, master.recurrence);
  let recurrence = ruleChanged ? draft.recurrence : master.recurrence!;
  if (!ruleChanged && shift) recurrence = shiftWeekdays(recurrence, shift.dayDelta);

  const editedOverrideOriginal =
    !occurrence.isInstance && occurrence.event.originalStart ? Date.parse(occurrence.event.originalStart) : null;

  const newStart = shift ? shift.shift(Date.parse(master.start)) : Date.parse(master.start);
  const newEnd = shift ? newStart + shift.duration : Date.parse(master.end);
  const exdates = master.exdates
    .map((iso) => Date.parse(iso))
    // The edited override is folded back into the series, so its instance reappears.
    .filter((ms) => ms !== editedOverrideOriginal)
    .map((ms) => toIso(shift ? shift.shift(ms) : ms));

  changes.push(
    updated(master, {
      ...master,
      ...shared,
      start: toIso(newStart),
      end: toIso(newEnd),
      allDay: shift ? draft.allDay : master.allDay,
      timeZone: shift ? draft.timeZone : master.timeZone,
      recurrence,
      exdates,
      updatedAt: ctx.now,
    }),
  );

  for (const override of overrides) {
    if (override.id === occurrence.event.id) {
      changes.push(deleted(override));
      continue;
    }
    const original = Date.parse(override.originalStart ?? override.start);
    changes.push(
      updated(override, {
        ...override,
        ...shared,
        originalStart: toIso(shift ? shift.shift(original) : original),
        updatedAt: ctx.now,
      }),
    );
  }
  return changes;
}

function truncatedEnd(rule: RecurrenceRule, index: number, splitKey: string): RecurrenceEnd {
  return rule.end.type === 'count' ? { type: 'count', count: index } : { type: 'until', until: addDays(splitKey, -1) };
}

function planEditFollowing(
  events: EventsById,
  master: CalendarEvent,
  occurrence: Occurrence,
  index: number,
  draft: EventDraft,
  ctx: PlanContext,
): EventChange[] {
  const rule = master.recurrence!;
  const splitMs = occurrence.originalStart;
  const splitKey = dateKeyInZone(splitMs, expansionZone(master));
  const changes: EventChange[] = [];

  // 1. The original series now ends right before the edited occurrence.
  changes.push(
    updated(master, {
      ...master,
      recurrence: { ...rule, end: truncatedEnd(rule, index, splitKey) },
      exdates: master.exdates.filter((iso) => Date.parse(iso) < splitMs),
      updatedAt: ctx.now,
    }),
  );

  // 2. A new series starts at the edited occurrence with the new values.
  const shift = timeChanged(occurrence, draft, master) ? seriesShift(master, occurrence, draft) : null;
  const ruleChanged = !sameRule(draft.recurrence, master.recurrence);
  let recurrence: RecurrenceRule | null;
  if (ruleChanged) {
    recurrence = draft.recurrence;
  } else {
    const end: RecurrenceEnd =
      rule.end.type === 'count' ? { type: 'count', count: Math.max(1, rule.end.count - index) } : rule.end;
    recurrence = shiftWeekdays({ ...rule, end }, shift?.dayDelta ?? 0);
  }

  const start = shift ? draft.start : splitMs;
  const end = shift ? draft.end : splitMs + (Date.parse(master.end) - Date.parse(master.start));
  const editedOverrideOriginal =
    !occurrence.isInstance && occurrence.event.originalStart ? Date.parse(occurrence.event.originalStart) : null;
  const moveInstant = (ms: number) => (shift ? shift.shift(ms) : ms);

  const newSeries: CalendarEvent = {
    ...newEventFromDraft({ ...draft, start, end, allDay: shift ? draft.allDay : master.allDay, recurrence }, ctx),
    organizerId: master.organizerId,
    timeZone: shift ? draft.timeZone : master.timeZone,
    exdates: recurrence
      ? master.exdates
          .map((iso) => Date.parse(iso))
          .filter((ms) => ms >= splitMs && ms !== editedOverrideOriginal)
          .map((ms) => toIso(moveInstant(ms)))
      : [],
  };
  changes.push(created(newSeries));

  // 3. Overrides after the split follow the new series (or become standalone events).
  const shared = changedSharedFields(occurrence, draft);
  for (const override of overridesOf(events, master.id)) {
    const original = Date.parse(override.originalStart ?? override.start);
    if (original < splitMs) continue;
    if (override.id === occurrence.event.id) {
      changes.push(deleted(override));
      continue;
    }
    changes.push(
      updated(override, {
        ...override,
        ...shared,
        recurringEventId: recurrence ? newSeries.id : null,
        originalStart: recurrence ? toIso(moveInstant(original)) : null,
        updatedAt: ctx.now,
      }),
    );
  }
  return changes;
}

export function planDelete(
  events: EventsById,
  occurrence: Occurrence,
  scope: EditScope,
  ctx: Pick<PlanContext, 'now'>,
): EventChange[] {
  const current = events[occurrence.event.id];
  if (!current) return [];
  const master = occurrence.seriesId ? events[occurrence.seriesId] : undefined;
  if (!master?.recurrence) return [deleted(current)];

  if (scope === 'this') {
    if (!occurrence.isInstance) return [deleted(current)]; // an override; its exdate stays on the master
    return [
      updated(master, {
        ...master,
        exdates: [...master.exdates, toIso(occurrence.originalStart)],
        updatedAt: ctx.now,
      }),
    ];
  }

  const overrides = overridesOf(events, master.id);
  const found = findSeriesOccurrence(master, occurrence.originalStart);
  if (scope === 'all' || !found || !hasVisibleOccurrenceBefore(master, occurrence.originalStart)) {
    return [deleted(master), ...overrides.map(deleted)];
  }

  const splitMs = occurrence.originalStart;
  const splitKey = dateKeyInZone(splitMs, expansionZone(master));
  const rule = master.recurrence;
  return [
    updated(master, {
      ...master,
      recurrence: { ...rule, end: truncatedEnd(rule, found.index, splitKey) },
      exdates: master.exdates.filter((iso) => Date.parse(iso) < splitMs),
      updatedAt: ctx.now,
    }),
    ...overrides.filter((o) => Date.parse(o.originalStart ?? o.start) >= splitMs).map(deleted),
  ];
}

/** Which scopes make sense for a given edit (Google hides "this event" when the rule itself changed). */
export function availableScopes(occurrence: Occurrence, draft: EventDraft | null, events: EventsById): EditScope[] {
  if (!occurrence.seriesId || !events[occurrence.seriesId]?.recurrence) return [];
  const master = events[occurrence.seriesId];
  if (draft && !sameRule(draft.recurrence, master.recurrence)) return ['following', 'all'];
  return ['this', 'following', 'all'];
}
