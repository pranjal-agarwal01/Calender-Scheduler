import { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUiStore } from '../../store/uiStore';
import type { EditScope } from '../../domain/types';

const LABELS: Record<EditScope, string> = {
  this: 'This event',
  following: 'This and following events',
  all: 'All events',
};

const TITLES = { edit: 'Edit recurring event', move: 'Change recurring event', delete: 'Delete recurring event' };

/** Asks which occurrences a change applies to. Resolves the promise from uiStore.askScope. */
export function ScopeDialog() {
  const prompt = useUiStore((s) => s.scopePrompt);
  const answer = useUiStore((s) => s.answerScope);
  const [choice, setChoice] = useState<EditScope>(prompt?.scopes[0] ?? 'this');
  const firstRef = useRef<HTMLInputElement>(null);
  if (!prompt) return null;
  const selected = prompt.scopes.includes(choice) ? choice : prompt.scopes[0];

  return (
    <Modal
      title={TITLES[prompt.action]}
      onClose={() => answer(null)}
      size="sm"
      initialFocusRef={firstRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancel
          </Button>
          <Button variant={prompt.action === 'delete' ? 'danger' : 'primary'} onClick={() => answer(selected)}>
            {prompt.action === 'delete' ? 'Delete' : 'OK'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          answer(selected);
        }}
      >
        <fieldset className="space-y-2">
          <legend className="sr-only">Apply to</legend>
          {prompt.scopes.map((scope, index) => (
            <label key={scope} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
              <input
                ref={index === 0 ? firstRef : undefined}
                type="radio"
                name="scope"
                value={scope}
                checked={selected === scope}
                onChange={() => setChoice(scope)}
                className="h-4 w-4 accent-brand-600"
              />
              {LABELS[scope]}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="sr-only">
          Confirm
        </button>
      </form>
    </Modal>
  );
}
