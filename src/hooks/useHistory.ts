import { useCallback, useEffect } from 'react';
import { useCalendarStore } from '../store/calendarStore';
import { shortcutsBlocked } from '../utils/keyboard';

/** Undo/redo state for the toolbar, plus Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (and Ctrl+Y). */
export function useHistory({ shortcuts = false }: { shortcuts?: boolean } = {}) {
  const undoLabel = useCalendarStore((s) => s.undoStack.at(-1)?.label ?? null);
  const redoLabel = useCalendarStore((s) => s.redoStack.at(-1)?.label ?? null);

  const undo = useCallback(() => useCalendarStore.getState().undo(), []);
  const redo = useCallback(() => useCalendarStore.getState().redo(), []);

  useEffect(() => {
    if (!shortcuts) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey);
      if (!isUndo && !isRedo) return;
      // Text fields keep their native undo; data never changes under an open dialog.
      if (shortcutsBlocked(event)) return;
      event.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, undo, redo]);

  return { canUndo: undoLabel !== null, canRedo: redoLabel !== null, undoLabel, redoLabel, undo, redo };
}
