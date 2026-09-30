import { useMemo } from 'react';
import { useCalendarStore } from '../../store/calendarStore';
import { useUsersStore, userName } from '../../store/usersStore';
import { findConflicts } from '../../domain/conflicts';
import { formatTimeRange } from '../../domain/time/format';
import type { EventDraft } from '../../domain/types';
import { Icon } from '../ui/Icon';

/** Live "already busy" warning, recomputed as times or attendees change. Non-blocking. */
export function ConflictNotice({
  draft,
  attendeeIds,
  exclude,
  timeZone,
}: {
  draft: EventDraft | null;
  attendeeIds: number[];
  exclude: { eventId: string | null; seriesId: string | null };
  timeZone: string;
}) {
  const events = useCalendarStore((s) => s.events);
  const users = useUsersStore((s) => s.byId);
  const start = draft?.start;
  const end = draft?.end;
  const allDay = draft?.allDay;

  const conflicts = useMemo(() => {
    if (start === undefined || end === undefined || allDay) return [];
    return findConflicts(events, { start, end, attendeeIds }, exclude);
    // exclude is derived from the (stable) editor state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, start, end, allDay, attendeeIds, exclude.eventId, exclude.seriesId]);

  if (!conflicts.length) return null;

  const byPerson = new Map<number, typeof conflicts>();
  for (const c of conflicts) byPerson.set(c.attendeeId, [...(byPerson.get(c.attendeeId) ?? []), c]);

  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="alert" size={16} className="text-amber-600" />
        {byPerson.size === 1 ? '1 attendee is' : `${byPerson.size} attendees are`} already busy
      </p>
      <ul className="mt-1.5 space-y-1">
        {[...byPerson.entries()].map(([id, items]) => (
          <li key={id}>
            <span className="font-medium">{userName(users[id], id)}</span>:{' '}
            {items
              .slice(0, 2)
              .map((c) => `${c.occurrence.event.title} (${formatTimeRange(c.occurrence.start, c.occurrence.end, timeZone)})`)
              .join('; ')}
            {items.length > 2 && ` and ${items.length - 2} more`}
          </li>
        ))}
      </ul>
    </div>
  );
}
