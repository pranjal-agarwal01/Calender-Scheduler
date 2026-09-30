import { memo } from 'react';
import type { SpanBar } from '../../domain/layout/calendarLayout';
import { formatTime } from '../../domain/time/format';
import { describeWhen } from '../../domain/describeWhen';
import { useCalendarStore } from '../../store/calendarStore';
import { EVENT_COLOR_CLASSES } from './eventColors';
import type { EventHandlers } from './TimedEventBlock';
import { Icon } from '../ui/Icon';

interface Props extends EventHandlers {
  bar: SpanBar;
  timeZone: string;
  cols: number;
  laneHeight: number;
  topOffset: number;
  selected: boolean;
  dimmed: boolean;
}

/** Compares what is drawn (layout creates new bar objects on every change). */
function sameBar(a: Props, b: Props): boolean {
  const x = a.bar;
  const y = b.bar;
  return (
    x.occurrence === y.occurrence &&
    x.startCol === y.startCol &&
    x.endCol === y.endCol &&
    x.lane === y.lane &&
    x.continuesBefore === y.continuesBefore &&
    x.continuesAfter === y.continuesAfter &&
    x.isChip === y.isChip &&
    a.timeZone === b.timeZone &&
    a.cols === b.cols &&
    a.laneHeight === b.laneHeight &&
    a.topOffset === b.topOffset &&
    a.selected === b.selected &&
    a.dimmed === b.dimmed &&
    a.onPointerDown === b.onPointerDown &&
    a.onClick === b.onClick &&
    a.onKeyDown === b.onKeyDown
  );
}

/** A horizontal event: all-day/multi-day bar, or a compact timed "chip" in month view. */
export const SpanEventBar = memo(function SpanEventBar({
  bar,
  timeZone,
  cols,
  laneHeight,
  topOffset,
  selected,
  dimmed,
  onPointerDown,
  onClick,
  onKeyDown,
}: Props) {
  const { occurrence, startCol, endCol, lane, continuesBefore, continuesAfter, isChip } = bar;
  const pending = useCalendarStore((s) => s.pendingIds[occurrence.event.id] === true);
  const colors = EVENT_COLOR_CLASSES[occurrence.event.color];
  const recurring = occurrence.seriesId !== null;
  const label = `${occurrence.event.title}, ${describeWhen(occurrence.start, occurrence.end, occurrence.allDay, timeZone)}${
    recurring ? ', repeating event' : ''
  }${pending ? ', saving' : ''}`;

  return (
    <button
      type="button"
      data-occurrence-key={occurrence.key}
      aria-label={label}
      aria-pressed={selected}
      onPointerDown={(e) => onPointerDown(e, occurrence, 'body')}
      onClick={() => onClick(occurrence)}
      onKeyDown={(e) => onKeyDown(e, occurrence)}
      className={`absolute z-10 flex touch-none items-center gap-1 overflow-hidden px-1.5 text-left text-xs select-none ${
        isChip ? `rounded-md text-slate-700 hover:bg-slate-100` : `${colors.chip} font-medium shadow-sm`
      } ${continuesBefore ? '' : 'rounded-l-md'} ${continuesAfter ? '' : 'rounded-r-md'} ${
        selected ? 'ring-2 ring-brand-600 ring-offset-1' : ''
      } ${dimmed ? 'opacity-40' : ''} cursor-grab`}
      style={{
        top: topOffset + lane * laneHeight,
        height: laneHeight - 2,
        left: `calc(${(startCol / cols) * 100}% + 2px)`,
        width: `calc(${((endCol - startCol + 1) / cols) * 100}% - 4px)`,
      }}
    >
      {isChip && <span className={`h-2 w-2 shrink-0 rounded-full ${colors.dot}`} aria-hidden="true" />}
      {continuesBefore && <Icon name="chevronLeft" size={12} className="-ml-1 shrink-0" />}
      {isChip && <span className="shrink-0 tabular-nums text-slate-500">{formatTime(occurrence.start, timeZone)}</span>}
      <span className={`truncate ${isChip ? 'font-medium' : ''}`}>{occurrence.event.title}</span>
      {recurring && <Icon name="repeat" size={11} className="shrink-0 opacity-70" />}
      {pending && <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current opacity-70" aria-hidden="true" />}
      {continuesAfter && <Icon name="chevronRight" size={12} className="-mr-1 ml-auto shrink-0" />}
    </button>
  );
}, sameBar);
