import { useCallback, useEffect } from 'react';
import { useCalendarStore } from '../store/calendarStore';
import { useUiStore } from '../store/uiStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

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
      // Let text fields keep their native undo, and don't change data under an open dialog or a move.
      if (isTypingTarget(event.target)) return;
      const ui = useUiStore.getState();
      if (ui.editor || ui.scopePrompt || ui.keyboardMove || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, undo, redo]);

  return { canUndo: undoLabel !== null, canRedo: redoLabel !== null, undoLabel, redoLabel, undo, redo };
}
