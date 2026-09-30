import { useMemo } from 'react';
import { useCalendarStore } from '../store/calendarStore';
import { findConflicts, type Conflict } from '../domain/conflicts';
import type { EventDraft } from '../domain/types';

/** Live busy-check for the attendees of a draft (recomputed as times/attendees change). */
export function useConflicts(
  draft: EventDraft | null,
  attendeeIds: number[],
  exclude: { eventId: string | null; seriesId: string | null },
): Conflict[] {
  const events = useCalendarStore((s) => s.events);
  const start = draft?.start;
  const end = draft?.end;
  const allDay = draft?.allDay;
  const { eventId, seriesId } = exclude;
  return useMemo(() => {
    if (start === undefined || end === undefined || allDay) return [];
    return findConflicts(events, { start, end, attendeeIds }, { eventId, seriesId });
  }, [events, start, end, allDay, attendeeIds, eventId, seriesId]);
}
