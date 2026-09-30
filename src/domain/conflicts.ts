import type { EventsById, Occurrence } from './types';
import { expandEvent } from './recurrence/expand';

export interface Conflict {
  attendeeId: number;
  occurrence: Occurrence;
}

/**
 * Which of the chosen attendees are already busy during [start, end)?
 * An attendee is busy if they organise or attend another timed event that
 * overlaps. All-day events count as "free" (as in Google Calendar).
 * The event being edited (and its own series) is excluded.
 */
export function findConflicts(
  events: EventsById,
  window: { start: number; end: number; attendeeIds: number[] },
  exclude: { eventId: string | null; seriesId: string | null },
): Conflict[] {
  if (!window.attendeeIds.length || !(window.end > window.start)) return [];
  const wanted = new Set(window.attendeeIds);
  const conflicts: Conflict[] = [];

  for (const event of Object.values(events)) {
    if (event.allDay || event.id === exclude.eventId || event.id === exclude.seriesId) continue;
    if (exclude.seriesId && event.recurringEventId === exclude.seriesId) continue;
    const people = [event.organizerId, ...event.attendeeIds].filter((id) => wanted.has(id));
    if (!people.length) continue;
    for (const occurrence of expandEvent(event, window.start, window.end)) {
      for (const attendeeId of new Set(people)) conflicts.push({ attendeeId, occurrence });
    }
  }
  return conflicts.sort((a, b) => a.occurrence.start - b.occurrence.start);
}
