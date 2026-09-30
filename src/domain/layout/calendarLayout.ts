/**
 * Turns occurrences into positioned pieces for the week and month grids,
 * in the display time zone. Pure functions (memoised by the views).
 */
import type { Occurrence } from '../types';
import { DAY_MS, diffDays, utcMsToDateKey, type DateKey } from '../time/dateKey';
import { dateKeyInZone, minutesInZone } from '../time/zoned';
import { layoutDay, packLanes, type LayoutBox } from './overlap';

/** First and last calendar day an occurrence touches (all-day events are floating dates). */
export function occurrenceDayRange(occurrence: Occurrence, timeZone: string): { first: DateKey; last: DateKey } {
  const lastInstant = Math.max(occurrence.start, occurrence.end - 1);
  if (occurrence.allDay) return { first: utcMsToDateKey(occurrence.start), last: utcMsToDateKey(lastInstant) };
  return { first: dateKeyInZone(occurrence.start, timeZone), last: dateKeyInZone(lastInstant, timeZone) };
}

/** Week view: all-day events and anything 24h+ go in the top row; the rest in the time grid. */
export function isAllDayRowItem(occurrence: Occurrence): boolean {
  return occurrence.allDay || occurrence.end - occurrence.start >= DAY_MS;
}

export interface TimedSegment {
  key: string;
  occurrence: Occurrence;
  dayIndex: number;
  /** Wall-clock minutes within the day (display zone). */
  startMin: number;
  endMin: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  box: LayoutBox;
}

export function buildTimedLayout(occurrences: Occurrence[], days: DateKey[], timeZone: string): TimedSegment[][] {
  const perDay: Omit<TimedSegment, 'box'>[][] = days.map(() => []);
  const firstDay = days[0];

  for (const occurrence of occurrences) {
    if (isAllDayRowItem(occurrence)) continue;
    const { first, last } = occurrenceDayRange(occurrence, timeZone);
    const from = Math.max(0, diffDays(firstDay, first));
    const to = Math.min(days.length - 1, diffDays(firstDay, last));
    for (let dayIndex = from; dayIndex <= to; dayIndex++) {
      const day = days[dayIndex];
      const startMin = day === first ? minutesInZone(occurrence.start, timeZone) : 0;
      const endsToday = day === last && dateKeyInZone(occurrence.end, timeZone) === day;
      const endMin = endsToday ? minutesInZone(occurrence.end, timeZone) : 1440;
      perDay[dayIndex].push({
        key: `${occurrence.key}#${dayIndex}`,
        occurrence,
        dayIndex,
        startMin,
        // Wall-clock end can precede start on a DST fall-back night; never draw negative heights.
        endMin: Math.max(endMin, startMin),
        continuesBefore: day !== first,
        continuesAfter: day !== last,
      });
    }
  }

  return perDay.map((segments) => {
    const boxes = layoutDay(segments.map((s) => ({ id: s.key, start: s.startMin, end: s.endMin })));
    return segments.map((segment) => ({ ...segment, box: boxes.get(segment.key)! }));
  });
}

export interface SpanBar {
  key: string;
  occurrence: Occurrence;
  startCol: number;
  endCol: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Month view: a timed single-day event drawn as a compact "• 9:30 Title" chip. */
  isChip: boolean;
}

export interface SpanRow {
  bars: SpanBar[];
  laneCount: number;
  /** Per column: items that did not fit in the visible lanes. */
  hiddenPerCol: number[];
  /** Per column: every item touching that day (for the "+N more" popover). */
  itemsPerCol: Occurrence[][];
}

/** Packs occurrences into rows of horizontal bars over `days` (a week). */
export function buildSpanRow(
  occurrences: Occurrence[],
  days: DateKey[],
  timeZone: string,
  include: (occurrence: Occurrence) => boolean,
  visibleLanes = Infinity,
): SpanRow {
  const firstDay = days[0];
  const items: Omit<SpanBar, 'lane'>[] = [];
  for (const occurrence of occurrences) {
    if (!include(occurrence)) continue;
    const { first, last } = occurrenceDayRange(occurrence, timeZone);
    const rawStart = diffDays(firstDay, first);
    const rawEnd = diffDays(firstDay, last);
    if (rawEnd < 0 || rawStart > days.length - 1) continue;
    items.push({
      key: `${occurrence.key}@${firstDay}`,
      occurrence,
      startCol: Math.max(0, rawStart),
      endCol: Math.min(days.length - 1, rawEnd),
      continuesBefore: rawStart < 0,
      continuesAfter: rawEnd > days.length - 1,
      isChip: !occurrence.allDay && first === last,
    });
  }

  const lanes = packLanes(
    items.map((item) => ({
      id: item.key,
      startCol: item.startCol,
      endCol: item.endCol,
      // All-day bars sort before timed chips, chips by start time.
      order: (item.occurrence.allDay ? 0 : 1) * 1e15 + item.occurrence.start,
    })),
  );

  const bars = items.map((item) => ({ ...item, lane: lanes.get(item.key)! }));
  const hiddenPerCol = days.map(() => 0);
  const itemsPerCol: Occurrence[][] = days.map(() => []);
  for (const bar of bars) {
    for (let col = bar.startCol; col <= bar.endCol; col++) {
      itemsPerCol[col].push(bar.occurrence);
      if (bar.lane >= visibleLanes) hiddenPerCol[col]++;
    }
  }
  for (const list of itemsPerCol) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);

  return {
    bars,
    laneCount: bars.reduce((max, bar) => Math.max(max, bar.lane + 1), 0),
    hiddenPerCol,
    itemsPerCol,
  };
}
