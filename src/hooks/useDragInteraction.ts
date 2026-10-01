/**
 * Pointer-driven create / move / resize for the week time grid, and
 * day-based move / create for the month grid and all-day row.
 *
 * Performance rules (500+ events stay smooth):
 *  - Drag state lives in a ref, never in React state, so pointermove does not re-render.
 *  - pointermove only records coordinates; the preview is repositioned in a
 *    requestAnimationFrame callback, at most once per frame, by writing styles
 *    directly on one preview element.
 *  - The store is touched once, on pointerup (one drag = one undo step).
 *  - React state changes only twice per drag (to dim the original block).
 * Esc cancels at any time.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Occurrence } from '../domain/types';
import { addDays, dateKeyToUtcMs, diffDays, utcMsToDateKey, type DateKey } from '../domain/time/dateKey';
import { dateKeyInZone, minutesInZone, zonedToUtc } from '../domain/time/zoned';
import { formatTimeRange } from '../domain/time/format';
import { DEFAULT_EVENT_MINUTES, DRAG_THRESHOLD_PX, HOUR_HEIGHT, SNAP_MINUTES } from '../config';
import { announce } from '../store/announcerStore';

const MINUTE = 60_000;
const snap = (minutes: number) => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
const floorSnap = (minutes: number) => Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
const ceilSnap = (minutes: number) => Math.ceil(minutes / SNAP_MINUTES) * SNAP_MINUTES;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type TimeDragKind = 'create' | 'move' | 'resize-start' | 'resize-end';

export interface TimeDragResult {
  kind: TimeDragKind;
  occurrence: Occurrence | null;
  start: number;
  end: number;
}

interface TimeDragOptions {
  /** Element spanning the day columns (not the time gutter); used for geometry. */
  columnsRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  previewRef: RefObject<HTMLElement | null>;
  days: DateKey[];
  timeZone: string;
  onCommit: (result: TimeDragResult) => unknown;
}

interface TimeSession {
  kind: TimeDragKind;
  stop: () => void;
  occurrence: Occurrence | null;
  title: string;
  originX: number;
  originY: number;
  originDay: number;
  originMinutes: number;
  clientX: number;
  clientY: number;
  active: boolean;
  frame: number | null;
  start: number;
  end: number;
}

/** Keeps the latest options in a ref so the stable callbacks below never go stale. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Follows one pointer for the length of a gesture: move/up/cancel on window
 * (so it keeps working outside the grid) and Escape to cancel.
 * Returns a function that removes everything again.
 */
function trackPointer(
  target: Element,
  pointerId: number,
  onMove: (event: PointerEvent) => void,
  onEnd: (commit: boolean) => void,
): () => void {
  const move = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onMove(e);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onEnd(e.type === 'pointerup');
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onEnd(false);
  };
  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* capture is optional */
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('keydown', key, true);
  return () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    window.removeEventListener('keydown', key, true);
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    document.body.classList.remove('is-dragging');
  };
}

/** A press only becomes a drag after the pointer travels a few pixels (otherwise it is a click). */
function passedThreshold(origin: { originX: number; originY: number }, e: PointerEvent): boolean {
  return Math.hypot(e.clientX - origin.originX, e.clientY - origin.originY) >= DRAG_THRESHOLD_PX;
}

export function useDragInteraction(options: TimeDragOptions) {
  const latest = useLatest(options);
  const session = useRef<TimeSession | null>(null);
  const suppressClickUntil = useRef(0);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const slotAt = useCallback(
    (clientX: number, clientY: number) => {
      const { columnsRef, days } = latest.current;
      const rect = columnsRef.current!.getBoundingClientRect();
      const dayIndex = clamp(Math.floor(((clientX - rect.left) / rect.width) * days.length), 0, days.length - 1);
      const minutes = clamp(((clientY - rect.top) / HOUR_HEIGHT) * 60, 0, 1440);
      return { dayIndex, minutes };
    },
    [latest],
  );

  /** Computes the dragged times from the pointer position. Pure w.r.t. the session. */
  const computeTimes = useCallback(
    (s: TimeSession) => {
      const { days, timeZone } = latest.current;
      const { dayIndex, minutes } = slotAt(s.clientX, s.clientY);
      const occurrence = s.occurrence;

      if (s.kind === 'create') {
        const anchor = floorSnap(s.originMinutes);
        let startMin: number;
        let endMin: number;
        if (!s.active) {
          startMin = anchor;
          endMin = Math.min(1440, anchor + DEFAULT_EVENT_MINUTES);
        } else if (minutes >= s.originMinutes) {
          startMin = anchor;
          endMin = Math.max(ceilSnap(minutes), anchor + SNAP_MINUTES);
        } else {
          startMin = floorSnap(minutes);
          endMin = anchor + SNAP_MINUTES;
        }
        const day = days[s.originDay]; // creation stays in the column it started in
        return { start: zonedToUtc(day, startMin, timeZone), end: zonedToUtc(day, Math.min(endMin, 1440), timeZone) };
      }

      if (!occurrence) return { start: s.start, end: s.end };

      if (s.kind === 'move') {
        const startKey = dateKeyInZone(occurrence.start, timeZone);
        const startMin = minutesInZone(occurrence.start, timeZone);
        const dayDelta = dayIndex - s.originDay;
        const newStartMin = clamp(snap(startMin + (minutes - s.originMinutes)), 0, 1440 - SNAP_MINUTES);
        const start = zonedToUtc(addDays(startKey, dayDelta), newStartMin, timeZone);
        return { start, end: start + (occurrence.end - occurrence.start) };
      }

      const pointerTime = zonedToUtc(days[dayIndex], snap(minutes), timeZone);
      if (s.kind === 'resize-end') {
        return { start: occurrence.start, end: Math.max(pointerTime, occurrence.start + SNAP_MINUTES * MINUTE) };
      }
      return { start: Math.min(pointerTime, occurrence.end - SNAP_MINUTES * MINUTE), end: occurrence.end };
    },
    [latest, slotAt],
  );

  const renderPreview = useCallback(
    (s: TimeSession) => {
      const { previewRef, days, timeZone } = latest.current;
      const el = previewRef.current;
      if (!el) return;
      const dayKey = dateKeyInZone(s.start, timeZone);
      const dayIndex = clamp(diffDays(days[0], dayKey), 0, days.length - 1);
      const startMin = minutesInZone(s.start, timeZone);
      const sameDayEnd = dateKeyInZone(s.end, timeZone) === dayKey;
      const endMin = sameDayEnd ? minutesInZone(s.end, timeZone) : 1440;
      el.style.display = 'block';
      el.style.top = `${(startMin / 60) * HOUR_HEIGHT}px`;
      el.style.height = `${Math.max(endMin - startMin, SNAP_MINUTES) * (HOUR_HEIGHT / 60)}px`;
      el.style.left = `${(dayIndex / days.length) * 100}%`;
      el.style.width = `${100 / days.length}%`;
      const time = el.querySelector('[data-preview-time]');
      const title = el.querySelector('[data-preview-title]');
      if (time) time.textContent = formatTimeRange(s.start, s.end, timeZone);
      if (title) title.textContent = s.title;
    },
    [latest],
  );

  const hidePreview = useCallback(() => {
    const el = latest.current.previewRef.current;
    if (el) el.style.display = 'none';
  }, [latest]);

  const frame = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.frame = null;

    // Auto-scroll when dragging near the top/bottom edge of the scroll area.
    const scroller = latest.current.scrollRef.current;
    let scrolled = false;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const edge = 48;
      if (s.clientY < rect.top + edge && scroller.scrollTop > 0) {
        scroller.scrollTop -= Math.ceil((rect.top + edge - s.clientY) / 4);
        scrolled = true;
      } else if (s.clientY > rect.bottom - edge && scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight) {
        scroller.scrollTop += Math.ceil((s.clientY - (rect.bottom - edge)) / 4);
        scrolled = true;
      }
    }

    Object.assign(s, computeTimes(s));
    renderPreview(s);
    if (scrolled) s.frame = requestAnimationFrame(frame);
  }, [latest, computeTimes, renderPreview]);

  const finish = useCallback(
    (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      if (s.frame !== null) cancelAnimationFrame(s.frame);
      s.stop();

      const cleanup = () => {
        hidePreview();
        setDraggingKey(null);
      };

      if (!commit) {
        cleanup();
        if (s.active) announce('Drag cancelled. Nothing changed.');
        return;
      }
      // A press on an event without moving is a click: let the click handler open it.
      if (!s.active && s.kind !== 'create') return cleanup();

      Object.assign(s, computeTimes(s));
      renderPreview(s);
      if (s.active) suppressClickUntil.current = performance.now() + 400;
      // Keep the preview on screen while the recurrence-scope dialog is open.
      Promise.resolve(latest.current.onCommit({ kind: s.kind, occurrence: s.occurrence, start: s.start, end: s.end })).finally(cleanup);
    },
    [computeTimes, hidePreview, latest, renderPreview],
  );

  const begin = useCallback(
    (event: ReactPointerEvent, kind: TimeDragKind, occurrence: Occurrence | null) => {
      if (event.button !== 0 || session.current || !latest.current.columnsRef.current) return;
      event.stopPropagation();
      const { dayIndex, minutes } = slotAt(event.clientX, event.clientY);

      const onMove = (e: PointerEvent) => {
        const s = session.current!;
        s.clientX = e.clientX;
        s.clientY = e.clientY;
        if (!s.active) {
          if (!passedThreshold(s, e)) return;
          s.active = true;
          document.body.classList.add('is-dragging');
          if (s.occurrence) setDraggingKey(s.occurrence.key);
        }
        s.frame ??= requestAnimationFrame(frame);
      };
      session.current = {
        kind,
        stop: trackPointer(event.currentTarget as Element, event.pointerId, onMove, finish),
        occurrence,
        title: occurrence?.event.title ?? 'New event',
        originX: event.clientX,
        originY: event.clientY,
        originDay: dayIndex,
        originMinutes: minutes,
        clientX: event.clientX,
        clientY: event.clientY,
        active: false,
        frame: null,
        start: occurrence?.start ?? 0,
        end: occurrence?.end ?? 0,
      };
    },
    [finish, frame, latest, slotAt],
  );

  // Abort a drag if the view unmounts mid-gesture.
  useEffect(() => () => finish(false), [finish]);

  return {
    draggingKey,
    beginCreate: useCallback((e: ReactPointerEvent) => begin(e, 'create', null), [begin]),
    beginMove: useCallback((e: ReactPointerEvent, o: Occurrence) => begin(e, 'move', o), [begin]),
    beginResize: useCallback(
      (e: ReactPointerEvent, o: Occurrence, edge: 'start' | 'end') => begin(e, edge === 'start' ? 'resize-start' : 'resize-end', o),
      [begin],
    ),
    /** True right after a drag, so the click that follows pointerup does not open the event. */
    shouldSuppressClick: useCallback(() => performance.now() < suppressClickUntil.current, []),
  };
}

// ---------------------------------------------------------------------------
// Day-based dragging (month grid, all-day row)
// ---------------------------------------------------------------------------

export interface DayDragResult {
  kind: 'create' | 'move';
  occurrence: Occurrence | null;
  /** create: first/last selected day. */
  firstDay: DateKey;
  lastDay: DateKey;
  /** move: new times. */
  start: number;
  end: number;
}

interface DayDragOptions {
  containerRef: RefObject<HTMLElement | null>;
  timeZone: string;
  onCommit: (result: DayDragResult) => unknown;
}

interface DaySession {
  kind: 'create' | 'move';
  stop: () => void;
  occurrence: Occurrence | null;
  originDay: DateKey;
  currentDay: DateKey;
  originX: number;
  originY: number;
  active: boolean;
  frame: number | null;
  clientX: number;
  clientY: number;
}

function dayAtPoint(x: number, y: number): DateKey | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const day = (el as HTMLElement).dataset?.day;
    if (day) return day;
  }
  return null;
}

/** New start/end when an occurrence is moved by whole days (keeps its wall-clock time). */
export function shiftByDays(occurrence: Occurrence, days: number, timeZone: string): { start: number; end: number } {
  const duration = occurrence.end - occurrence.start;
  if (occurrence.allDay) {
    const start = dateKeyToUtcMs(addDays(utcMsToDateKey(occurrence.start), days));
    return { start, end: start + duration };
  }
  const start = zonedToUtc(
    addDays(dateKeyInZone(occurrence.start, timeZone), days),
    minutesInZone(occurrence.start, timeZone),
    timeZone,
  );
  return { start, end: start + duration };
}

export function useDayDragInteraction(options: DayDragOptions) {
  const latest = useLatest(options);
  const session = useRef<DaySession | null>(null);
  const suppressClickUntil = useRef(0);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  /** Highlights the target days by toggling a data attribute on the day cells. */
  const paint = useCallback(
    (s: DaySession | null) => {
      const container = latest.current.containerRef.current;
      if (!container) return;
      let first: DateKey | null = null;
      let last: DateKey | null = null;
      if (s?.active) {
        if (s.kind === 'create') {
          [first, last] = s.originDay <= s.currentDay ? [s.originDay, s.currentDay] : [s.currentDay, s.originDay];
        } else if (s.occurrence) {
          const delta = diffDays(s.originDay, s.currentDay);
          const { start, end } = shiftByDays(s.occurrence, delta, latest.current.timeZone);
          const zone = s.occurrence.allDay ? 'UTC' : latest.current.timeZone;
          first = dateKeyInZone(start, zone);
          last = dateKeyInZone(Math.max(start, end - 1), zone);
        }
      }
      for (const cell of container.querySelectorAll<HTMLElement>('[data-day]')) {
        const day = cell.dataset.day!;
        const inRange = first !== null && last !== null && day >= first && day <= last;
        if (inRange) cell.setAttribute('data-drop', '');
        else cell.removeAttribute('data-drop');
      }
    },
    [latest],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      if (s.frame !== null) cancelAnimationFrame(s.frame);
      s.stop();
      const clear = () => {
        paint(null);
        setDraggingKey(null);
      };
      if (!commit) {
        clear();
        if (s.active) announce('Drag cancelled. Nothing changed.');
        return;
      }
      if (!s.active && s.kind === 'move') return clear(); // plain click on an event
      if (s.active) suppressClickUntil.current = performance.now() + 400;
      // Use the final pointer position: a fast drag can end before the next animation frame ran.
      s.currentDay = dayAtPoint(s.clientX, s.clientY) ?? s.currentDay;

      let result: DayDragResult;
      if (s.kind === 'create') {
        const [firstDay, lastDay] = s.originDay <= s.currentDay ? [s.originDay, s.currentDay] : [s.currentDay, s.originDay];
        result = { kind: 'create', occurrence: null, firstDay, lastDay, start: 0, end: 0 };
      } else {
        const { start, end } = shiftByDays(s.occurrence!, diffDays(s.originDay, s.currentDay), latest.current.timeZone);
        result = { kind: 'move', occurrence: s.occurrence, firstDay: s.currentDay, lastDay: s.currentDay, start, end };
      }
      Promise.resolve(latest.current.onCommit(result)).finally(clear);
    },
    [latest, paint],
  );

  const begin = useCallback(
    (event: ReactPointerEvent, kind: 'create' | 'move', occurrence: Occurrence | null) => {
      if (event.button !== 0 || session.current) return;
      const day = dayAtPoint(event.clientX, event.clientY);
      if (!day) return;
      event.stopPropagation();

      const onFrame = () => {
        const s = session.current;
        if (!s) return;
        s.frame = null;
        const hovered = dayAtPoint(s.clientX, s.clientY);
        if (hovered) s.currentDay = hovered;
        paint(s);
      };
      const onMove = (e: PointerEvent) => {
        const s = session.current!;
        s.clientX = e.clientX;
        s.clientY = e.clientY;
        if (!s.active) {
          if (!passedThreshold(s, e)) return;
          s.active = true;
          document.body.classList.add('is-dragging');
          if (s.occurrence) setDraggingKey(s.occurrence.key);
        }
        s.frame ??= requestAnimationFrame(onFrame);
      };
      session.current = {
        kind,
        stop: trackPointer(event.currentTarget as Element, event.pointerId, onMove, finish),
        occurrence,
        originDay: day,
        currentDay: day,
        originX: event.clientX,
        originY: event.clientY,
        active: false,
        frame: null,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    },
    [finish, paint],
  );

  useEffect(() => () => finish(false), [finish]);

  return {
    draggingKey,
    beginCreate: useCallback((e: ReactPointerEvent) => begin(e, 'create', null), [begin]),
    beginMove: useCallback((e: ReactPointerEvent, o: Occurrence) => begin(e, 'move', o), [begin]),
    shouldSuppressClick: useCallback(() => performance.now() < suppressClickUntil.current, []),
  };
}
