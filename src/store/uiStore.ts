import { create } from 'zustand';
import type { EditScope, EventDraft, Occurrence } from '../domain/types';

/**
 * Transient UI state shared across the calendar: which modal is open and the
 * keyboard move session. Kept separate from the events store so opening a
 * dialog never touches undo history or persistence.
 */
export type EditorState =
  | { mode: 'create'; draft: EventDraft }
  | { mode: 'edit'; occurrence: Occurrence; draft: EventDraft };

export interface ScopePrompt {
  action: 'edit' | 'delete' | 'move';
  scopes: EditScope[];
  resolve: (scope: EditScope | null) => void;
}

export interface KeyboardMove {
  occurrence: Occurrence;
  start: number;
  end: number;
}

interface UiState {
  editor: EditorState | null;
  /** Bumped each time the editor opens so the form remounts with fresh values. */
  editorVersion: number;
  scopePrompt: ScopePrompt | null;
  keyboardMove: KeyboardMove | null;
  openEditor: (editor: EditorState) => void;
  closeEditor: () => void;
  /** Shows the "this / following / all" dialog and resolves with the choice (null = cancelled). */
  askScope: (action: ScopePrompt['action'], scopes: EditScope[]) => Promise<EditScope | null>;
  answerScope: (scope: EditScope | null) => void;
  setKeyboardMove: (move: KeyboardMove | null) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  editor: null,
  editorVersion: 0,
  scopePrompt: null,
  keyboardMove: null,
  openEditor: (editor) => set({ editor, editorVersion: get().editorVersion + 1 }),
  closeEditor: () => set({ editor: null }),
  askScope: (action, scopes) => {
    get().scopePrompt?.resolve(null); // never leave a previous prompt dangling
    return new Promise((resolve) => set({ scopePrompt: { action, scopes, resolve } }));
  },
  answerScope: (scope) => {
    const prompt = get().scopePrompt;
    if (!prompt) return;
    set({ scopePrompt: null });
    prompt.resolve(scope);
  },
  setKeyboardMove: (keyboardMove) => set({ keyboardMove }),
}));
