import type { CalendarEvent, EventsById } from '../domain/types';

/** Test factory: a valid event with sensible defaults. */
export function makeEvent(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'id'>): CalendarEvent {
  return {
    title: overrides.id,
    description: '',
    start: '2026-10-05T09:00:00.000Z',
    end: '2026-10-05T10:00:00.000Z',
    allDay: false,
    timeZone: 'UTC',
    organizerId: 1,
    attendeeIds: [],
    reminderMinutes: null,
    color: 'indigo',
    recurrence: null,
    exdates: [],
    recurringEventId: null,
    originalStart: null,
    remoteId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function byId(...events: CalendarEvent[]): EventsById {
  return Object.fromEntries(events.map((e) => [e.id, e]));
}

export const iso = (ms: number) => new Date(ms).toISOString();
