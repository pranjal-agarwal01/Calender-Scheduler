import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Occurrence } from '../../domain/types';
import { buildSpanRow, buildTimedLayout, isAllDayRowItem, type TimedSegment } from '../../domain/layout/calendarLayout';
import { addDays, dateKeyToUtcMs, diffDays, utcMsToDateKey, type DateKey } from '../../domain/time/dateKey';
import { dateKeyInZone, minutesInZone, zonedToUtc } from '../../domain/time/zoned';
import { formatDayNumber, formatHourLabel, formatLongDate, formatWeekdayShort, formatZoneOffset, formatTimeRange } from '../../domain/time/format';
import { useDayDragInteraction, useDragInteraction, type DayDragResult, type TimeDragResult } from '../../hooks/useDragInteraction';
import { useKeyboardMove } from '../../hooks/useKeyboardMove';
import { useGridNavigation } from '../../hooks/useGridNavigation';
import { useUiStore } from '../../store/uiStore';
import { TimedEventBlock, type EventHandlers, type EventPart } from './TimedEventBlock';
import { SpanEventBar } from './SpanEventBar';
import { ALL_DAY_VISIBLE_LANES, HOUR_HEIGHT, INITIAL_SCROLL_HOUR } from '../../config';

export interface CreateRequest {
  start: number;
  end: number;
  allDay: boolean;
}

interface WeekViewProps {
  days: DateKey[];
  timeZone: string;
  occurrences: Occurrence[];
  selectedKey: string | null;
  today: DateKey;
  now: number;
  onOpen: (occurrence: Occurrence) => void;
  onCreate: (request: CreateRequest) => void;
  onTimeChange: (occurrence: Occurrence, start: number, end: number, kind: 'move' | 'resize') => Promise<unknown>;
  onDelete: (occurrence: Occurrence) => void;
  onNavigate: (direction: -1 | 1) => void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const GUTTER = 'w-14';
const LANE_HEIGHT = 24;

export function WeekView(props: WeekViewProps) {
  const { days, timeZone, occurrences, selectedKey, today, now, onOpen, onCreate, onTimeChange, onDelete, onNavigate } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const allDayRef = useRef<HTMLDivElement>(null);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const keyboardMove = useUiStore((s) => s.keyboardMove);

  // Layout is recomputed only when occurrences / days / zone change, never during a drag.
  const timed = useMemo(() => buildTimedLayout(occurrences, days, timeZone), [occurrences, days, timeZone]);
  const allDay = useMemo(
    () => buildSpanRow(occurrences, days, timeZone, isAllDayRowItem, allDayExpanded ? Infinity : ALL_DAY_VISIBLE_LANES),
    [occurrences, days, timeZone, allDayExpanded],
  );

  const handleDrag = useCallback(
    (result: TimeDragResult) => {
      if (result.kind === 'create') return onCreate({ start: result.start, end: result.end, allDay: false });
      return onTimeChange(result.occurrence!, result.start, result.end, result.kind === 'move' ? 'move' : 'resize');
    },
    [onCreate, onTimeChange],
  );
  const handleDayDrag = useCallback(
    (result: DayDragResult) => {
      if (result.kind === 'create') {
        return onCreate({
          start: dateKeyToUtcMs(result.firstDay),
          end: dateKeyToUtcMs(addDays(result.lastDay, 1)),
          allDay: true,
        });
      }
      return onTimeChange(result.occurrence!, result.start, result.end, 'move');
    },
    [onCreate, onTimeChange],
  );

  const drag = useDragInteraction({ columnsRef, scrollRef, previewRef, days, timeZone, onCommit: handleDrag });
  const dayDrag = useDayDragInteraction({ containerRef: allDayRef, timeZone, onCommit: handleDayDrag });
  const { handleKeyDown: handleMoveKey } = useKeyboardMove({ view: 'week', timeZone, onCommit: onTimeChange });
  // The hooks return stable callbacks; depend on those (not on the hook result objects) so the
  // handler objects below keep their identity and memoised event blocks skip re-rendering.
  const { beginMove, beginResize, shouldSuppressClick } = drag;
  const { beginMove: beginDayMove, shouldSuppressClick: shouldSuppressDayClick } = dayDrag;

  // Start scrolled to the morning (or to "now" when this week contains today).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const nowHour = days.includes(today) ? minutesInZone(Date.now(), timeZone) / 60 - 1.5 : INITIAL_SCROLL_HOUR;
    scroller.scrollTop = Math.max(0, Math.min(nowHour, 16)) * HOUR_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first mount
  }, []);

  const timedHandlers: EventHandlers = useMemo(
    () => ({
      onPointerDown: (e: PointerEvent, o: Occurrence, part: EventPart) =>
        part === 'body' ? beginMove(e, o) : beginResize(e, o, part),
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
    [beginMove, beginResize, shouldSuppressClick, handleMoveKey, onDelete, onOpen],
  );
  const spanHandlers: EventHandlers = useMemo(
    () => ({
      ...timedHandlers,
      onPointerDown: (e: PointerEvent, o: Occurrence) => beginDayMove(e, o),
      onClick: (o: Occurrence) => {
        if (!shouldSuppressDayClick()) onOpen(o);
      },
    }),
    [timedHandlers, beginDayMove, shouldSuppressDayClick, onOpen],
  );

  const todayIndex = days.indexOf(today);
  const initialRow = todayIndex >= 0 ? Math.min(23, Math.floor(minutesInZone(now, timeZone) / 60)) : 9;
  const grid = useGridNavigation({
    rows: 24,
    cols: 7,
    initial: { row: initialRow, col: Math.max(0, todayIndex) },
    pageRows: 4,
    onActivate: (row, col) => {
      const start = zonedToUtc(days[col], row * 60, timeZone);
      onCreate({ start, end: zonedToUtc(days[col], row * 60 + 60, timeZone), allDay: false });
    },
    onEdge: onNavigate,
  });

  // Events starting in each hour slot, for the grid cells' accessible names.
  const counts = useMemo(() => {
    const table = days.map(() => new Array<number>(24).fill(0));
    timed.forEach((segments, dayIndex) => {
      for (const s of segments) if (!s.continuesBefore) table[dayIndex][Math.min(23, Math.floor(s.startMin / 60))]++;
    });
    return table;
  }, [timed, days]);

  const hiddenAllDay = !allDayExpanded && allDay.laneCount > ALL_DAY_VISIBLE_LANES;
  const allDayLanes = allDayExpanded ? allDay.laneCount : Math.min(allDay.laneCount, ALL_DAY_VISIBLE_LANES);
  const allDayHeight = Math.max(1, allDayLanes) * LANE_HEIGHT + (hiddenAllDay ? 18 : 4);

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto" data-testid="week-view">
      <div className="min-w-[640px]">
        {/* Sticky header: weekday names + all-day row */}
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="flex">
            <div className={`${GUTTER} shrink-0 self-end pb-1 pr-1 text-right text-[10px] text-slate-400`} title={timeZone}>
              {formatZoneOffset(timeZone)}
            </div>
            <div className="grid flex-1 grid-cols-7" aria-hidden="true">
              {days.map((day) => {
                const isToday = day === today;
                return (
                  <div key={day} className="flex flex-col items-center py-2">
                    <span className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? 'text-brand-600' : 'text-slate-500'}`}>
                      {formatWeekdayShort(day)}
                    </span>
                    <span
                      className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg ${
                        isToday ? 'bg-brand-600 font-semibold text-white' : 'text-slate-800'
                      }`}
                    >
                      {formatDayNumber(day)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex border-t border-slate-100">
            <div className={`${GUTTER} flex shrink-0 flex-col items-end justify-start gap-0.5 py-1 pr-1 text-[10px] text-slate-400`}>
              <span>All day</span>
              {allDay.laneCount > ALL_DAY_VISIBLE_LANES && (
                <button
                  type="button"
                  className="rounded px-1 text-[10px] font-medium text-brand-700 hover:bg-brand-50"
                  aria-expanded={allDayExpanded}
                  onClick={() => setAllDayExpanded((v) => !v)}
                >
                  {allDayExpanded ? 'Less' : 'More'}
                </button>
              )}
            </div>
            <div
              ref={allDayRef}
              role="group"
              aria-label="All-day events"
              className="relative flex-1 border-l border-slate-100"
              style={{ height: allDayHeight }}
            >
              <div className="absolute inset-0 grid grid-cols-7">
                {days.map((day, col) => (
                  <div
                    key={day}
                    data-day={day}
                    className="border-r border-slate-100 data-[drop]:bg-brand-100/70"
                    onPointerDown={dayDrag.beginCreate}
                  >
                    {hiddenAllDay && allDay.hiddenPerCol[col] > 0 && (
                      <button
                        type="button"
                        className="absolute bottom-0 truncate px-1 text-[10px] font-medium text-slate-500 hover:text-brand-700"
                        style={{ left: `${(col / 7) * 100}%`, width: `${100 / 7}%` }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setAllDayExpanded(true)}
                      >
                        +{allDay.hiddenPerCol[col]} more
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {allDay.bars
                .filter((bar) => allDayExpanded || bar.lane < ALL_DAY_VISIBLE_LANES)
                .map((bar) => (
                  <SpanEventBar
                    key={bar.key}
                    bar={bar}
                    timeZone={timeZone}
                    cols={7}
                    laneHeight={LANE_HEIGHT}
                    topOffset={2}
                    selected={bar.occurrence.key === selectedKey}
                    dimmed={dayDrag.draggingKey === bar.occurrence.key || keyboardMove?.occurrence.key === bar.occurrence.key}
                    {...spanHandlers}
                  />
                ))}
              {keyboardMove && isAllDayRowItem(keyboardMove.occurrence) && (
                <KeyboardDayGhost days={days} start={keyboardMove.start} end={keyboardMove.end} allDay={keyboardMove.occurrence.allDay} timeZone={timeZone} />
              )}
            </div>
          </div>
        </div>

        {/* Time grid */}
        <div className="flex">
          <div className={`${GUTTER} relative shrink-0`} aria-hidden="true">
            {HOURS.map((hour) =>
              hour === 0 ? null : (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-[10px] text-slate-400"
                  style={{ top: hour * HOUR_HEIGHT }}
                >
                  {formatHourLabel(zonedToUtc(days[0], hour * 60, timeZone), timeZone)}
                </span>
              ),
            )}
          </div>

          <div ref={columnsRef} className="relative flex-1 select-none border-l border-slate-200" style={{ height: 24 * HOUR_HEIGHT }}>
            <div
              ref={grid.gridRef}
              role="grid"
              aria-label={`Week of ${formatLongDate(days[0])}. Use arrow keys to move between hours and days, Enter to create an event.`}
              aria-rowcount={25}
              aria-colcount={8}
              className="grid h-full grid-cols-7"
              style={{ gridTemplateRows: `repeat(24, ${HOUR_HEIGHT}px)` }}
              onKeyDown={grid.onKeyDown}
              onPointerDown={drag.beginCreate}
            >
              <div role="row" className="contents">
                <span role="columnheader" className="sr-only">
                  Time
                </span>
                {days.map((day) => (
                  <span key={day} role="columnheader" className="sr-only">
                    {formatLongDate(day)}
                  </span>
                ))}
              </div>
              {HOURS.map((hour) => (
                <div key={hour} role="row" className="contents">
                  <span role="rowheader" className="sr-only">
                    {formatHourLabel(zonedToUtc(days[0], hour * 60, timeZone), timeZone)}
                  </span>
                  {days.map((day, col) => {
                    const count = counts[col][hour];
                    return (
                      <div
                        key={day}
                        {...grid.cellProps(hour, col)}
                        aria-label={`${formatLongDate(day)}, ${formatHourLabel(zonedToUtc(day, hour * 60, timeZone), timeZone)}${
                          count ? `, ${count} event${count > 1 ? 's' : ''} starting` : ''
                        }`}
                        className={`border-b border-r border-slate-100 outline-none focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
                          day === today ? 'bg-brand-50/30' : ''
                        }`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Events overlay (clicks on empty space fall through to the grid) */}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
              {timed.map((segments, dayIndex) => (
                <DayColumn
                  key={days[dayIndex]}
                  segments={segments}
                  timeZone={timeZone}
                  selectedKey={selectedKey}
                  draggingKey={drag.draggingKey ?? keyboardMove?.occurrence.key ?? null}
                  handlers={timedHandlers}
                />
              ))}
            </div>

            {todayIndex >= 0 && <NowLine dayIndex={todayIndex} minutes={minutesInZone(now, timeZone)} />}

            {keyboardMove && !isAllDayRowItem(keyboardMove.occurrence) && (
              <KeyboardTimeGhost days={days} timeZone={timeZone} title={keyboardMove.occurrence.event.title} start={keyboardMove.start} end={keyboardMove.end} />
            )}

            {/* Drag preview: positioned imperatively by useDragInteraction (no re-renders while dragging). */}
            <div
              ref={previewRef}
              aria-hidden="true"
              className="pointer-events-none absolute z-40 hidden px-0.5"
            >
              <div className="h-full overflow-hidden rounded-md border-l-[3px] border-brand-700 bg-brand-600/90 px-1.5 py-0.5 text-xs text-white shadow-lg ring-2 ring-white">
                <div data-preview-title className="truncate font-semibold" />
                <div data-preview-time className="truncate opacity-90" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const DayColumn = memo(function DayColumn({
  segments,
  timeZone,
  selectedKey,
  draggingKey,
  handlers,
}: {
  segments: TimedSegment[];
  timeZone: string;
  selectedKey: string | null;
  draggingKey: string | null;
  handlers: EventHandlers;
}) {
  return (
    <div className="relative mr-1.5">
      {segments.map((segment) => (
        <TimedEventBlock
          key={segment.key}
          segment={segment}
          timeZone={timeZone}
          selected={segment.occurrence.key === selectedKey}
          dimmed={segment.occurrence.key === draggingKey}
          {...handlers}
        />
      ))}
    </div>
  );
});

function NowLine({ dayIndex, minutes }: { dayIndex: number; minutes: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 h-0.5 bg-rose-500"
      style={{ top: (minutes / 60) * HOUR_HEIGHT, left: `${(dayIndex / 7) * 100}%`, width: `${100 / 7}%` }}
    >
      <span className="absolute -left-1.5 -top-[5px] h-3 w-3 rounded-full bg-rose-500" />
    </div>
  );
}

/** Where a keyboard-moved timed event will land. */
function KeyboardTimeGhost({ days, timeZone, title, start, end }: { days: DateKey[]; timeZone: string; title: string; start: number; end: number }) {
  const day = dateKeyInZone(start, timeZone);
  const dayIndex = diffDays(days[0], day);
  if (dayIndex < 0 || dayIndex > 6) return null;
  const startMin = minutesInZone(start, timeZone);
  const endMin = dateKeyInZone(end, timeZone) === day ? minutesInZone(end, timeZone) : 1440;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-40 px-0.5"
      style={{
        top: (startMin / 60) * HOUR_HEIGHT,
        height: Math.max(endMin - startMin, 15) * (HOUR_HEIGHT / 60),
        left: `${(dayIndex / 7) * 100}%`,
        width: `${100 / 7}%`,
      }}
    >
      <div className="h-full overflow-hidden rounded-md border-2 border-dashed border-brand-600 bg-brand-100/90 px-1.5 py-0.5 text-xs text-brand-900 shadow-lg">
        <div className="truncate font-semibold">{title}</div>
        <div className="truncate">{formatTimeRange(start, end, timeZone)}</div>
      </div>
    </div>
  );
}

function KeyboardDayGhost({ days, start, end, allDay, timeZone }: { days: DateKey[]; start: number; end: number; allDay: boolean; timeZone: string }) {
  const first = allDay ? utcMsToDateKey(start) : dateKeyInZone(start, timeZone);
  const last = allDay ? utcMsToDateKey(Math.max(start, end - 1)) : dateKeyInZone(Math.max(start, end - 1), timeZone);
  const from = Math.max(0, diffDays(days[0], first));
  const to = Math.min(6, diffDays(days[0], last));
  if (to < 0 || from > 6) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0.5 z-20 rounded-md border-2 border-dashed border-brand-600 bg-brand-100/60"
      style={{ left: `${(from / 7) * 100}%`, width: `${((to - from + 1) / 7) * 100}%` }}
    />
  );
}
