import { useCalendarStore } from '../../store/calendarStore';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

/** Saving / saved / failed status of the fake sync queue. */
export function SyncIndicator() {
  const sync = useCalendarStore((s) => s.sync);

  let content;
  if (sync.state === 'saving') {
    content = (
      <>
        <Spinner size={14} className="text-brand-600" />
        <span>Saving{sync.pending > 1 ? ` ${sync.pending} changes` : ''}…</span>
      </>
    );
  } else if (sync.state === 'failed') {
    content = (
      <>
        <Icon name="cloudOff" size={16} className="text-rose-600" />
        <span className="text-rose-700">Save failed · rolled back</span>
      </>
    );
  } else if (sync.state === 'saved') {
    content = (
      <>
        <Icon name="check" size={16} className="text-emerald-600" />
        <span>Saved</span>
      </>
    );
  } else {
    content = (
      <>
        <Icon name="cloud" size={16} className="text-slate-400" />
        <span>Up to date</span>
      </>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      title={sync.lastError ?? undefined}
      className="hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 md:flex"
    >
      {content}
    </div>
  );
}
