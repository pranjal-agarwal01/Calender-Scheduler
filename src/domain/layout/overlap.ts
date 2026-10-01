/**
 * Side-by-side layout for overlapping timed events in one day column
 * (Google Calendar style). O(n log n + n·c) where c = columns.
 *
 * 1. Sort by start (longer first on ties) so long events claim the left.
 * 2. Split into clusters: groups of events connected by overlaps. Events in
 *    different clusters never affect each other's width.
 * 3. Inside a cluster, greedily put each event in the first column whose last
 *    event has already ended; otherwise open a new column.
 * 4. Each event gets width 1/columns, then expands right across neighbouring
 *    columns that are free for its whole duration (so a lone late event is not
 *    squeezed just because the cluster was wide earlier).
 */

export interface LayoutItem {
  id: string;
  /** Minutes from the top of the day column. */
  start: number;
  end: number;
}

export interface LayoutBox {
  /** 0..1 fraction of the column width. */
  left: number;
  width: number;
  column: number;
  columns: number;
}

export function layoutDay(items: LayoutItem[], minDurationMinutes = 20): Map<string, LayoutBox> {
  const result = new Map<string, LayoutBox>();
  // Very short events are drawn taller than their duration, so collide on their visual size.
  const sorted = items
    .map((item) => ({ ...item, visualEnd: Math.max(item.end, item.start + minDurationMinutes) }))
    .sort((a, b) => a.start - b.start || b.visualEnd - a.visualEnd || a.id.localeCompare(b.id));

  type Placed = (typeof sorted)[number];
  let columns: Placed[][] = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    const count = columns.length;
    columns.forEach((column, columnIndex) => {
      for (const item of column) {
        let span = 1;
        for (let next = columnIndex + 1; next < count; next++) {
          const blocked = columns[next].some((other) => other.start < item.visualEnd && other.visualEnd > item.start);
          if (blocked) break;
          span++;
        }
        result.set(item.id, { left: columnIndex / count, width: span / count, column: columnIndex, columns: count });
      }
    });
    columns = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && columns.length) flushCluster();
    const free = columns.find((column) => column[column.length - 1].visualEnd <= item.start);
    if (free) free.push(item);
    else columns.push([item]);
    clusterEnd = Math.max(clusterEnd, item.visualEnd);
  }
  if (columns.length) flushCluster();
  return result;
}

/**
 * Lane packing for horizontal bars (all-day row, month view). Each item spans
 * a range of day columns; returns the row ("lane") each item sits in.
 */
export interface SpanItem {
  id: string;
  startCol: number;
  endCol: number; // inclusive
  /** Tie-breaker among equal spans, e.g. start time so chips read top-to-bottom chronologically. */
  order?: number;
}

export function packLanes(items: SpanItem[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const laneEnds: number[] = []; // last occupied column per lane
  const sorted = [...items].sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.id.localeCompare(b.id),
  );
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end < item.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endCol);
    } else {
      laneEnds[lane] = item.endCol;
    }
    lanes.set(item.id, lane);
  }
  return lanes;
}
