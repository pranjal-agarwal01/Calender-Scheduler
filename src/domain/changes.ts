import type { CalendarEvent } from './types';

/**
 * A before/after snapshot of one stored event. `before: null` = created,
 * `after: null` = deleted. Every mutation in the app (and therefore every undo
 * step and every sync request) is a list of these.
 */
export interface EventChange {
  id: string;
  before: CalendarEvent | null;
  after: CalendarEvent | null;
}

export function created(event: CalendarEvent): EventChange {
  return { id: event.id, before: null, after: event };
}

export function updated(before: CalendarEvent, after: CalendarEvent): EventChange {
  return { id: before.id, before, after };
}

export function deleted(event: CalendarEvent): EventChange {
  return { id: event.id, before: event, after: null };
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
