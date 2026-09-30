import { memo, useState } from 'react';
import { addMonths, parseDateKey, startOfMonth, type DateKey } from '../../domain/time/dateKey';
import { formatDayNumber, formatLongDate, formatMonthYear, formatWeekdayNarrow } from '../../domain/time/format';
import { visibleDays } from '../../hooks/useCalendar';
import { IconButton } from '../ui/Button';

/** Small month navigator in the sidebar (memoised: it only changes with the selected date). */
export const MiniMonth = memo(function MiniMonth({
  selected,
  today,
  onSelect,
}: {
  selected: DateKey;
  today: DateKey;
  onSelect: (day: DateKey) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(selected));
  const [lastSelected, setLastSelected] = useState(selected);
  // Follow the main calendar when it navigates to another month.
  if (selected !== lastSelected) {
    setLastSelected(selected);
    setMonth(startOfMonth(selected));
  }
  const days = visibleDays('month', month);
  const currentMonth = parseDateKey(month)!.month;

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{formatMonthYear(month)}</span>
        <div className="flex">
          <IconButton label="Previous month" icon="chevronLeft" className="h-7 w-7" onClick={() => setMonth(addMonths(month, -1))} />
          <IconButton label="Next month" icon="chevronRight" className="h-7 w-7" onClick={() => setMonth(addMonths(month, 1))} />
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-slate-400" aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="py-1">
            {formatWeekdayNarrow(d)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {days.map((day) => {
          const inMonth = parseDateKey(day)!.month === currentMonth;
          const isToday = day === today;
          const isSelected = day === selected;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(day)}
              aria-label={formatLongDate(day)}
              aria-current={isToday ? 'date' : undefined}
              className={`mx-auto my-0.5 flex h-7 w-7 items-center justify-center rounded-full ${
                isToday
                  ? 'bg-brand-600 font-semibold text-white'
                  : isSelected
                    ? 'bg-brand-100 font-semibold text-brand-800'
                    : inMonth
                      ? 'text-slate-700 hover:bg-slate-100'
                      : 'text-slate-400 hover:bg-slate-100'
              }`}
            >
              {formatDayNumber(day)}
            </button>
          );
        })}
      </div>
    </div>
  );
});
