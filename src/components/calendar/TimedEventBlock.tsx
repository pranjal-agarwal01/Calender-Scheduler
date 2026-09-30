import { memo, type KeyboardEvent, type PointerEvent } from 'react';
import type { Occurrence } from '../../domain/types';
import type { TimedSegment } from '../../domain/layout/calendarLayout';
import { formatTimeRange } from '../../domain/time/format';
import { describeWhen } from '../../domain/describeWhen';
import { useCalendarStore } from '../../store/calendarStore';
import { EVENT_COLOR_CLASSES } from './eventColors';
import { Icon } from '../ui/Icon';
import { HOUR_HEIGHT } from '../../config';

export type EventPart = 'body' | 'start' | 'end';

export interface EventHandlers {
  onPointerDown: (event: PointerEvent, occurrence: Occurrence, part: EventPart) => void;
  onClick: (occurrence: Occurrence) => void;
  onKeyDown: (event: KeyboardEvent, occurrence: Occurrence) => void;
}

interface Props extends EventHandlers {
  segment: TimedSegment;
  timeZone: string;
  selected: boolean;
  dimmed: boolean;
}

const MIN_HEIGHT = 18;

/**
 * Layout creates fresh segment objects on every change, so compare what is
 * drawn instead of object identity. Occurrences are cached per event, so for
 * unchanged events `occurrence` is the same object and the block is skipped.
 */
function sameBlock(a: Props, b: Props): boolean {
  const x = a.segment;
  const y = b.segment;
  return (
    x.occurrence === y.occurrence &&
    x.startMin === y.startMin &&
    x.endMin === y.endMin &&
    x.box.left === y.box.left &&
    x.box.width === y.box.width &&
    x.continuesBefore === y.continuesBefore &&
    x.continuesAfter === y.continuesAfter &&
    a.timeZone === b.timeZone &&
    a.selected === b.selected &&
    a.dimmed === b.dimmed &&
    a.onPointerDown === b.onPointerDown &&
    a.onClick === b.onClick &&
    a.onKeyDown === b.onKeyDown
  );
}

/**
 * One event (or one day's piece of a multi-day event) in the week grid.
 * Memoised: occurrences are cached per event, so during a re-render only
 * blocks whose event actually changed are re-rendered.
 */
export const TimedEventBlock = memo(function TimedEventBlock({
  segment,
  timeZone,
  selected,
  dimmed,
  onPointerDown,
  onClick,
  onKeyDown,
}: Props) {
  const { occurrence, startMin, endMin, box, continuesBefore, continuesAfter } = segment;
  const pending = useCalendarStore((s) => s.pendingIds[occurrence.event.id] === true);
  const colors = EVENT_COLOR_CLASSES[occurrence.event.color];
  const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT - 2, MIN_HEIGHT);
  const compact = height < 38;
  const recurring = occurrence.seriesId !== null;
  const label = `${occurrence.event.title}, ${describeWhen(occurrence.start, occurrence.end, false, timeZone)}${
    recurring ? ', repeating event' : ''
  }${pending ? ', saving' : ''}`;

  return (
    <button
      type="button"
      data-occurrence-key={occurrence.key}
      aria-label={label}
      aria-pressed={selected}
      className={`pointer-events-auto absolute touch-none overflow-hidden rounded-md border-l-[3px] px-1.5 text-left text-xs leading-tight shadow-sm transition-[opacity,box-shadow] select-none ${
        colors.block
      } ${selected ? 'z-20 ring-2 ring-brand-600' : 'z-10 ring-1 ring-white'} ${dimmed ? 'opacity-40' : ''} ${
        continuesBefore ? 'rounded-t-none' : ''
      } ${continuesAfter ? 'rounded-b-none' : ''} cursor-grab`}
      style={{
        top: (startMin / 60) * HOUR_HEIGHT + 1,
        height,
        left: `calc(${box.left * 100}% + 1px)`,
        width: `calc(${box.width * 100}% - 3px)`,
      }}
      onPointerDown={(e) => onPointerDown(e, occurrence, 'body')}
      onClick={() => onClick(occurrence)}
      onKeyDown={(e) => onKeyDown(e, occurrence)}
    >
      {!continuesBefore && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e, occurrence, 'start');
          }}
        />
      )}
      <span className={`flex min-w-0 items-center gap-1 ${compact ? '' : 'pt-0.5'}`}>
        <span className="truncate font-semibold">{occurrence.event.title}</span>
        {compact && <span className="shrink-0 opacity-75">{formatTimeRange(occurrence.start, occurrence.end, timeZone).split(' – ')[0]}</span>}
        {recurring && <Icon name="repeat" size={11} className="shrink-0 opacity-70" />}
      </span>
      {!compact && <span className="block truncate opacity-80">{formatTimeRange(occurrence.start, occurrence.end, timeZone)}</span>}
      {pending && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-70" aria-hidden="true" />
      )}
      {!continuesAfter && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e, occurrence, 'end');
          }}
        />
      )}
    </button>
  );
}, sameBlock);
