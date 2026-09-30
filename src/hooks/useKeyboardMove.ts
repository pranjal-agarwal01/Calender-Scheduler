import { useCallback, type KeyboardEvent } from 'react';
import { useUiStore } from '../store/uiStore';
import { announce } from '../store/announcerStore';
import type { Occurrence } from '../domain/types';
import { describeWhen } from '../domain/describeWhen';
import { shiftByDays } from './useDragInteraction';
import { SNAP_MINUTES } from '../config';

const STEP = SNAP_MINUTES * 60_000;

/**
 * Keyboard alternative to dragging: focus an event, press M, then
 *  - ←/→ move by a day, ↑/↓ by 15 minutes (a week in month view)
 *  - Shift+↑/↓ change the end time (resize)
 *  - Enter saves (one undo step), Escape cancels.
 * Every step is announced through the aria-live region.
 */
export function useKeyboardMove(options: {
  view: 'week' | 'month';
  timeZone: string;
  onCommit: (occurrence: Occurrence, start: number, end: number, kind: 'move' | 'resize') => Promise<unknown>;
}) {
  const { view, timeZone, onCommit } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent, occurrence: Occurrence): boolean => {
      const ui = useUiStore.getState();
      const move = ui.keyboardMove;
      const active = move?.occurrence.key === occurrence.key;

      if (!active) {
        if ((event.key === 'm' || event.key === 'M') && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          ui.setKeyboardMove({ occurrence, start: occurrence.start, end: occurrence.end });
          announce(
            `Moving ${occurrence.event.title}. Arrow keys move it${view === 'week' ? ', Shift with up or down arrow changes the end time' : ''}. Enter to save, Escape to cancel.`,
            'assertive',
          );
          return true;
        }
        return false;
      }

      let { start, end } = move;
      const minuteStep = view === 'week' && !occurrence.allDay;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          const shifted = shiftByDays({ ...occurrence, start, end }, event.key === 'ArrowLeft' ? -1 : 1, timeZone);
          start = shifted.start;
          end = shifted.end;
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          const direction = event.key === 'ArrowUp' ? -1 : 1;
          if (!minuteStep) {
            const shifted = shiftByDays({ ...occurrence, start, end }, direction * 7, timeZone);
            start = shifted.start;
            end = shifted.end;
          } else if (event.shiftKey) {
            end = Math.max(start + STEP, end + direction * STEP);
          } else {
            start += direction * STEP;
            end += direction * STEP;
          }
          break;
        }
        case 'Enter': {
          event.preventDefault();
          ui.setKeyboardMove(null);
          const resized = end - start !== occurrence.end - occurrence.start;
          if (start === occurrence.start && end === occurrence.end) announce('No change.');
          else void onCommit(occurrence, start, end, resized ? 'resize' : 'move');
          return true;
        }
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          ui.setKeyboardMove(null);
          announce('Move cancelled. Nothing changed.');
          return true;
        case 'Tab':
          ui.setKeyboardMove(null);
          announce('Move cancelled.');
          return false;
        default:
          return false;
      }
      event.preventDefault();
      event.stopPropagation();
      ui.setKeyboardMove({ occurrence, start, end });
      announce(describeWhen(start, end, occurrence.allDay, timeZone));
      return true;
    },
    [onCommit, timeZone, view],
  );

  return { handleKeyDown };
}
