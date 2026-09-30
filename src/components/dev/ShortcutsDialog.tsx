import { Modal } from '../ui/Modal';

const SHORTCUTS: [string, string][] = [
  ['T', 'Go to today'],
  ['N / P', 'Next / previous week or month'],
  ['C', 'Create event'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'],
  ['Arrow keys', 'Move between time slots / days in the grid'],
  ['Enter', 'Create an event in the focused slot, or open the focused event'],
  ['M', 'Move the focused event (then arrows, Shift+↑/↓ to resize, Enter to save, Esc to cancel)'],
  ['Delete', 'Delete the focused event'],
  ['Esc', 'Cancel a drag or close a dialog'],
  ['?', 'Show this list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} size="md">
      <dl className="divide-y divide-slate-100 text-sm">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys} className="flex items-start justify-between gap-4 py-2">
            <dt>
              <kbd className="whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700">{keys}</kbd>
            </dt>
            <dd className="text-right text-slate-600">{action}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
