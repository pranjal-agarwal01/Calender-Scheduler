import { useUsersStore, userName } from '../../store/usersStore';
import type { Conflict } from '../../domain/conflicts';
import { formatTimeRange } from '../../domain/time/format';
import { Icon } from '../ui/Icon';

/** Live, non-blocking "already busy" warning for the chosen attendees. */
export function ConflictNotice({ conflicts, timeZone }: { conflicts: Conflict[]; timeZone: string }) {
  const users = useUsersStore((s) => s.byId);
  if (!conflicts.length) return null;

  const byPerson = new Map<number, Conflict[]>();
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
