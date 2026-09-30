import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Roving-tabindex keyboard navigation for an ARIA grid (WAI-ARIA grid pattern):
 * only one cell is tabbable; arrow keys move focus between cells,
 * Home/End jump within the row, Ctrl+Home/End to the corners,
 * PageUp/PageDown by `pageRows`. Enter/Space activates the cell.
 */
export function useGridNavigation(options: {
  rows: number;
  cols: number;
  initial: { row: number; col: number };
  pageRows?: number;
  onActivate: (row: number, col: number) => void;
  /** Called when arrowing past the first/last column (e.g. to change week). */
  onEdge?: (direction: -1 | 1) => void;
}) {
  const { rows, cols, initial, pageRows = 4, onActivate, onEdge } = options;
  const [active, setActive] = useState(initial);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(false);

  // Keep the active cell inside the grid when its size changes (e.g. month with 5 vs 6 weeks).
  const row = Math.min(active.row, rows - 1);
  const col = Math.min(active.col, cols - 1);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus();
  }, [row, col]);

  const moveTo = useCallback((nextRow: number, nextCol: number) => {
    shouldFocus.current = true;
    setActive({ row: nextRow, col: nextCol });
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      let nextRow = row;
      let nextCol = col;
      switch (event.key) {
        case 'ArrowUp':
          nextRow = Math.max(0, row - 1);
          break;
        case 'ArrowDown':
          nextRow = Math.min(rows - 1, row + 1);
          break;
        case 'ArrowLeft':
          if (col === 0 && onEdge) {
            event.preventDefault();
            onEdge(-1);
            moveTo(row, cols - 1);
            return;
          }
          nextCol = Math.max(0, col - 1);
          break;
        case 'ArrowRight':
          if (col === cols - 1 && onEdge) {
            event.preventDefault();
            onEdge(1);
            moveTo(row, 0);
            return;
          }
          nextCol = Math.min(cols - 1, col + 1);
          break;
        case 'Home':
          nextCol = 0;
          if (event.ctrlKey) nextRow = 0;
          break;
        case 'End':
          nextCol = cols - 1;
          if (event.ctrlKey) nextRow = rows - 1;
          break;
        case 'PageUp':
          nextRow = Math.max(0, row - pageRows);
          break;
        case 'PageDown':
          nextRow = Math.min(rows - 1, row + pageRows);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          onActivate(row, col);
          return;
        default:
          return;
      }
      event.preventDefault();
      moveTo(nextRow, nextCol);
    },
    [row, col, rows, cols, pageRows, onActivate, onEdge, moveTo],
  );

  const cellProps = useCallback(
    (r: number, c: number) => ({
      role: 'gridcell' as const,
      tabIndex: r === row && c === col ? 0 : -1,
      'data-cell': `${r}:${c}`,
      onFocus: () => {
        if (r !== row || c !== col) setActive({ row: r, col: c });
      },
    }),
    [row, col],
  );

  return { gridRef, onKeyDown, cellProps, active: { row, col }, setActive };
}
