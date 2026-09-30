import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  );
}

/** Open traps, innermost last: only the top-most modal reacts to Tab/Escape. */
const stack: symbol[] = [];

/**
 * Keeps Tab / Shift+Tab inside a modal, closes it on Escape, focuses the
 * first field on open and gives focus back to whatever opened it on close.
 * Listens on the document so it still works if focus was lost (e.g. the
 * focused button became disabled while saving).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: { onEscape?: () => void; initialFocusRef?: RefObject<HTMLElement | null>; active?: boolean } = {},
) {
  const { onEscape, initialFocusRef, active = true } = options;
  // Latest onEscape without re-installing the trap on every render.
  const onEscapeRef = useRef(onEscape);
  useLayoutEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const id = Symbol('focus-trap');
    stack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial = initialFocusRef?.current ?? focusableIn(container)[0] ?? container;
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || event.defaultPrevented) return;
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      stack.splice(stack.indexOf(id), 1);
      // Restore focus after React has removed the modal.
      requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the trap is set up once per open
  }, [active]);
}
