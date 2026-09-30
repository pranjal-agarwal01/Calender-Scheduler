import { Button } from '../ui/Button';
import { MiniMonth } from '../calendar/MiniMonth';
import { AttendeePicker } from '../events/AttendeePicker';
import type { CalendarModel } from '../../hooks/useCalendar';
import type { DateKey } from '../../domain/time/dateKey';

interface SidebarProps {
  calendar: CalendarModel;
  today: DateKey;
  onCreate: () => void;
}

export function Sidebar({ calendar, today, onCreate }: SidebarProps) {
  const filtered = calendar.attendeeIds.length > 0;
  return (
    <aside aria-label="Calendar tools" className="flex h-full w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-slate-200 bg-white p-4">
      <Button variant="primary" icon="plus" onClick={onCreate} className="w-full justify-start rounded-2xl" title="Create event (C)">
        Create
      </Button>
      <MiniMonth selected={calendar.date} today={today} onSelect={calendar.goToDate} />
      <section aria-labelledby="people-filter-heading" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="people-filter-heading" className="text-sm font-semibold text-slate-700">
            Filter by people
          </h2>
          {filtered && (
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => calendar.setAttendeeIds([])}>
              Clear
            </button>
          )}
        </div>
        <AttendeePicker
          compact
          label="Filter events by attendee"
          placeholder="Search people…"
          value={calendar.attendeeIds}
          onChange={calendar.setAttendeeIds}
        />
        <p className="text-xs text-slate-500">
          {filtered
            ? `Showing ${calendar.visibleCount} of ${calendar.totalCount} events in view.`
            : 'Showing everyone’s events.'}
        </p>
      </section>
      <section className="mt-auto rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-600">Tips</p>
        <p>Drag on empty space to create. Drag an event to move it, or its edges to resize. Esc cancels a drag.</p>
        <p className="mt-1">
          Keyboard: focus an event and press <kbd className="rounded border bg-white px-1">M</kbd>, then use the arrow keys.
        </p>
      </section>
    </aside>
  );
}
