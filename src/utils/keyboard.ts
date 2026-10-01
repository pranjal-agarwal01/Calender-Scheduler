import { useUiStore } from '../store/uiStore';

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/**
 * Global shortcuts (Ctrl+Z, T, N, ...) must not fire while the user is typing,
 * while a dialog is open, or during a keyboard move.
 */
export function shortcutsBlocked(event: KeyboardEvent): boolean {
  if (isTypingTarget(event.target)) return true;
  const ui = useUiStore.getState();
  return Boolean(ui.editor || ui.scopePrompt || ui.keyboardMove || document.querySelector('[aria-modal="true"]'));
}
