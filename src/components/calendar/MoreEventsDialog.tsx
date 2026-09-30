import type { Occurrence } from '../../domain/types';
import type { DateKey } from '../../domain/time/dateKey';
import { formatLongDate, formatTimeRange } from '../../domain/time/format';
import { Modal } from '../ui/Modal';
import { EVENT_COLOR_CLASSES } from './eventColors';

/** "+N more" in month view: every event on that day, in a focus-trapped dialog. */
export function MoreEventsDialog({
  day,
  items,
  timeZone,
  onClose,
  onOpen,
}: {
  day: DateKey;
  items: Occurrence[];
  timeZone: string;
  onClose: () => void;
  onOpen: (occurrence: Occurrence) => void;
}) {
  return (
    <Modal title={formatLongDate(day)} onClose={onClose} size="sm">
      <ul className="-mx-2 flex flex-col gap-0.5">
        {items.map((o) => (
          <li key={o.key}>
            <button
              type="button"
              onClick={() => onOpen(o)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_COLOR_CLASSES[o.event.color].dot}`} aria-hidden="true" />
              <span className="w-28 shrink-0 text-xs tabular-nums text-slate-500">
                {o.allDay ? 'All day' : formatTimeRange(o.start, o.end, timeZone)}
              </span>
              <span className="truncate font-medium text-slate-800">{o.event.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
