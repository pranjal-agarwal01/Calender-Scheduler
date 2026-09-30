import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Occurrence } from '../../domain/types';
import { buildSpanRow } from '../../domain/layout/calendarLayout';
import { addDays, dateKeyToUtcMs, parseDateKey, type DateKey } from '../../domain/time/dateKey';
import { dateKeyInZone } from '../../domain/time/zoned';
import { formatDayNumber, formatLongDate, formatMonthDay, formatWeekdayShort } from '../../domain/time/format';
import { useDayDragInteraction, type DayDragResult } from '../../hooks/useDragInteraction';
import { useKeyboardMove } from '../../hooks/useKeyboardMove';
import { useGridNavigation } from '../../hooks/useGridNavigation';
import { useUiStore } from '../../store/uiStore';
import { SpanEventBar } from './SpanEventBar';
import type { EventHandlers } from './TimedEventBlock';
import type { CreateRequest } from './WeekView';
import { MoreEventsDialog } from './MoreEventsDialog';
import { MONTH_VISIBLE_LANES } from '../../config';

interface MonthViewProps {
  days: DateKey[];
  month: number;
  timeZone: string;
  occurrences: Occurrence[];
  selectedKey: string | null;
  today: DateKey;
  onOpen: (occurrence: Occurrence) => void;
  onCreate: (request: CreateRequest) => void;
  onTimeChange: (occurrence: Occurrence, start: number, end: number, kind: 'move' | 'resize') => Promise<unknown>;
  onDelete: (occurrence: Occurrence) => void;
  onShowWeek: (day: DateKey) => void;
}

const DAY_LABEL_HEIGHT = 26;
const LANE_HEIGHT = 22;
const MORE_HEIGHT = 20;

export function MonthView(props: MonthViewProps) {
  const { days, month, timeZone, occurrences, selectedKey, today, onOpen, onCreate, onTimeChange, onDelete, onShowWeek } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const keyboardMove = useUiStore((s) => s.keyboardMove);
  const [moreDay, setMoreDay] = useState<{ day: DateKey; items: Occurrence[] } | null>(null);

  const weeks = useMemo(() => Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7)), [days]);
  const [visibleLanes, setVisibleLanes] = useState(MONTH_VISIBLE_LANES);
  const rows = useMemo(
    () => weeks.map((week) => buildSpanRow(occurrences, week, timeZone, () => true, visibleLanes)),
    [weeks, occurrences, timeZone, visibleLanes],
  );

  // Show as many event rows as fit in a week row (taller screens show more before "+N more").
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const rowHeight = container.clientHeight / weeks.length;
      setVisibleLanes(Math.max(MONTH_VISIBLE_LANES, Math.floor((rowHeight - DAY_LABEL_HEIGHT - MORE_HEIGHT) / LANE_HEIGHT)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [weeks.length]);

  const handleDrag = useCallback(
    (result: DayDragResult) => {
      if (result.kind === 'create') {
        return onCreate({ start: dateKeyToUtcMs(result.firstDay), end: dateKeyToUtcMs(addDays(result.lastDay, 1)), allDay: true });
      }
      return onTimeChange(result.occurrence!, result.start, result.end, 'move');
    },
    [onCreate, onTimeChange],
  );
  const { beginCreate, beginMove, shouldSuppressClick, draggingKey } = useDayDragInteraction({
    containerRef,
    timeZone,
    onCommit: handleDrag,
  });
  const { handleKeyDown: handleMoveKey } = useKeyboardMove({ view: 'month', timeZone, onCommit: onTimeChange });

  const handlers: EventHandlers = useMemo(
    () => ({
      onPointerDown: (e: PointerEvent, o: Occurrence) => beginMove(e, o),
      onClick: (o: Occurrence) => {
        if (!shouldSuppressClick()) onOpen(o);
      },
      onKeyDown: (e: KeyboardEvent, o: Occurrence) => {
        if (handleMoveKey(e, o)) return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          onDelete(o);
        }
      },
    }),
    [beginMove, shouldSuppressClick, handleMoveKey, onDelete, onOpen],
  );

  const todayIndex = days.indexOf(today);
  const grid = useGridNavigation({
    rows: weeks.length,
    cols: 7,
    initial: todayIndex >= 0 ? { row: Math.floor(todayIndex / 7), col: todayIndex % 7 } : { row: 0, col: 0 },
    onActivate: (row, col) => {
      const day = weeks[row][col];
      onCreate({ start: dateKeyToUtcMs(day), end: dateKeyToUtcMs(addDays(day, 1)), allDay: true });
    },
  });

  // Days highlighted while an event is being moved with the keyboard.
  const ghostDays = useMemo(() => {
    if (!keyboardMove) return null;
    const zone = keyboardMove.occurrence.allDay ? 'UTC' : timeZone;
    return {
      first: dateKeyInZone(keyboardMove.start, zone),
      last: dateKeyInZone(Math.max(keyboardMove.start, keyboardMove.end - 1), zone),
    };
  }, [keyboardMove, timeZone]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="month-view">
      <div className="grid grid-cols-7 border-b border-slate-200" aria-hidden="true">
        {weeks[0].map((day) => (
          <div key={day} className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {formatWeekdayShort(day)}
          </div>
        ))}
      </div>
      <div
        ref={(el) => {
          containerRef.current = el;
          grid.gridRef.current = el;
        }}
        role="grid"
        aria-label="Month. Use arrow keys to move between days, Enter to create an all-day event."
        aria-rowcount={weeks.length + 1}
        aria-colcount={7}
        onKeyDown={grid.onKeyDown}
        className="grid min-h-0 flex-1 select-none overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(${DAY_LABEL_HEIGHT + MONTH_VISIBLE_LANES * LANE_HEIGHT + MORE_HEIGHT}px, 1fr))` }}
      >
        <div role="row" className="sr-only">
          {weeks[0].map((day) => (
            <span key={day} role="columnheader">
              {formatWeekdayShort(day)}
            </span>
          ))}
        </div>
        {weeks.map((week, row) => {
          const layout = rows[row];
          return (
            <div key={week[0]} role="row" className="relative grid grid-cols-7 border-b border-slate-200">
              {week.map((day, col) => {
                const inMonth = parseDateKey(day)?.month === month;
                const isToday = day === today;
                const hidden = layout.hiddenPerCol[col];
                const total = layout.itemsPerCol[col].length;
                const ghost = ghostDays && day >= ghostDays.first && day <= ghostDays.last;
                return (
                  <div
                    key={day}
                    {...grid.cellProps(row, col)}
                    data-day={day}
                    aria-label={`${formatLongDate(day)}${total ? `, ${total} event${total > 1 ? 's' : ''}` : ', no events'}`}
                    onPointerDown={beginCreate}
                    className={`flex min-w-0 flex-col border-r border-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 data-[drop]:bg-brand-100/70 ${
                      inMonth ? 'bg-white' : 'bg-slate-50/70'
                    } ${ghost ? 'bg-brand-100/70' : ''}`}
                  >
                    <div className="flex h-[26px] items-center justify-center pt-1">
                      <button
                        type="button"
                        tabIndex={-1}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onShowWeek(day)}
                        aria-label={`Show week of ${formatLongDate(day)}`}
                        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs hover:bg-slate-200 ${
                          isToday ? 'bg-brand-600 font-semibold text-white hover:bg-brand-700' : inMonth ? 'text-slate-800' : 'text-slate-400'
                        }`}
                      >
                        {day.endsWith('-01') ? formatMonthDay(day) : formatDayNumber(day)}
                      </button>
                    </div>
                    {hidden > 0 && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setMoreDay({ day, items: layout.itemsPerCol[col] })}
                        className="absolute rounded px-1 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-brand-700"
                        style={{
                          top: DAY_LABEL_HEIGHT + visibleLanes * LANE_HEIGHT + 2,
                          left: `calc(${(col / 7) * 100}% + 4px)`,
                        }}
                      >
                        +{hidden} more
                      </button>
                    )}
                    {/* Bars start in this cell and are positioned against the row, so they can span days. */}
                    {layout.bars
                      .filter((bar) => bar.startCol === col && bar.lane < visibleLanes)
                      .map((bar) => (
                        <SpanEventBar
                          key={bar.key}
                          bar={bar}
                          timeZone={timeZone}
                          cols={7}
                          laneHeight={LANE_HEIGHT}
                          topOffset={DAY_LABEL_HEIGHT + 2}
                          selected={bar.occurrence.key === selectedKey}
                          dimmed={draggingKey === bar.occurrence.key || keyboardMove?.occurrence.key === bar.occurrence.key}
                          {...handlers}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {moreDay && (
        <MoreEventsDialog
          day={moreDay.day}
          items={moreDay.items}
          timeZone={timeZone}
          onClose={() => setMoreDay(null)}
          onOpen={(o) => {
            setMoreDay(null);
            onOpen(o);
          }}
        />
      )}
    </div>
  );
}
