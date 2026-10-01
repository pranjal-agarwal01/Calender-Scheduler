/**
 * Undo/redo with the command pattern, plus rollback of failed saves.
 *
 * A Command is a named list of EventChange snapshots. Because every change
 * stores both `before` and `after`, a command knows how to do AND undo
 * itself, however many records it touches (a recurring "this and following"
 * edit is one command).
 *
 * Every time state changes (do, undo or redo) we emit a Mutation, which is
 * what gets sent to the (fake) server. Mutations are sent one at a time, in
 * order, and each carries FULL snapshots of the events it touches.
 */
import type { EventChange } from '../domain/changes';
import type { CalendarEvent, EventsById } from '../domain/types';

export interface Command {
  id: string;
  label: string;
  changes: EventChange[];
}

export type MutationKind = 'do' | 'undo' | 'redo';

export interface Mutation {
  id: number;
  commandId: string;
  kind: MutationKind;
  label: string;
  /** Changes in the direction they were applied (undo mutations are inverted). */
  changes: EventChange[];
}

export interface HistoryState {
  events: EventsById;
  undoStack: Command[];
  redoStack: Command[];
}

const HISTORY_LIMIT = 100;

function applyChanges(events: EventsById, changes: EventChange[]): EventsById {
  const next = { ...events };
  for (const change of changes) {
    if (change.after) next[change.id] = change.after;
    else delete next[change.id];
  }
  return next;
}

export function invertChanges(changes: EventChange[]): EventChange[] {
  // Reverse order so multi-step commands unwind in the opposite order they were applied.
  return changes.map((c) => ({ id: c.id, before: c.after, after: c.before })).reverse();
}

/** do(): apply a new command. Clears redo (a new branch of history). */
export function doCommand(state: HistoryState, command: Command): HistoryState {
  return {
    events: applyChanges(state.events, command.changes),
    undoStack: [...state.undoStack, command].slice(-HISTORY_LIMIT),
    redoStack: [],
  };
}

export function undoCommand(state: HistoryState): { state: HistoryState; command: Command } | null {
  const command = state.undoStack.at(-1);
  if (!command) return null;
  return {
    command,
    state: {
      events: applyChanges(state.events, invertChanges(command.changes)),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, command],
    },
  };
}

export function redoCommand(state: HistoryState): { state: HistoryState; command: Command } | null {
  const command = state.redoStack.at(-1);
  if (!command) return null;
  return {
    command,
    state: {
      events: applyChanges(state.events, command.changes),
      undoStack: [...state.undoStack, command],
      redoStack: state.redoStack.slice(0, -1),
    },
  };
}

/**
 * Tracks what the server is known to have, per event.
 *
 * - `confirmed[id]`: the last snapshot the server acknowledged (or the state
 *   before the first unsynced change).
 * - `latest[id]`: the newest mutation touching that event.
 *
 * On failure, only the NEWEST mutation for an event is rolled back, and it is
 * rolled back to the last CONFIRMED snapshot. An older failed save is
 * harmless when a newer one is queued: the newer one carries the full state
 * (last write wins), which is exactly what "final state must match the last
 * action" requires.
 */
export class SyncLedger {
  private confirmed = new Map<string, CalendarEvent | null>();
  private latest = new Map<string, number>();

  register(mutation: Mutation) {
    for (const change of mutation.changes) {
      if (!this.confirmed.has(change.id)) this.confirmed.set(change.id, change.before);
      this.latest.set(change.id, mutation.id);
    }
  }

  succeed(mutation: Mutation) {
    for (const change of mutation.changes) {
      if (this.latest.get(change.id) === mutation.id) {
        this.latest.delete(change.id); // nothing newer pending: forget it
        this.confirmed.delete(change.id);
      } else {
        this.confirmed.set(change.id, change.after); // server has it; newer saves still queued
      }
    }
  }

  /** Returns the rollback targets for events where this mutation was the newest word. */
  fail(mutation: Mutation): Map<string, CalendarEvent | null> {
    const reverts = new Map<string, CalendarEvent | null>();
    for (const change of mutation.changes) {
      if (this.latest.get(change.id) !== mutation.id) continue; // superseded by a newer queued save
      reverts.set(change.id, this.confirmed.get(change.id) ?? null);
      this.latest.delete(change.id);
      this.confirmed.delete(change.id);
    }
    return reverts;
  }

  isPending(id: string): boolean {
    return this.latest.has(id);
  }

  pendingIds(): string[] {
    return [...this.latest.keys()];
  }

  reset() {
    this.confirmed.clear();
    this.latest.clear();
  }
}

function withoutIds(command: Command, ids: Set<string>): Command {
  return { ...command, changes: command.changes.filter((c) => !ids.has(c.id)) };
}

function onlyIds(command: Command, ids: Set<string>): Command {
  return { ...command, changes: command.changes.filter((c) => ids.has(c.id)) };
}

/**
 * Makes a stack consistent with the current value of one event again: the
 * top-most command touching it must end (undo stack) or start (redo stack)
 * at the current value. Changes that no longer line up are dropped.
 * Snapshots are immutable objects, so reference equality is enough.
 */
function reconcileStack(stack: Command[], id: string, current: CalendarEvent | null, side: 'undo' | 'redo'): Command[] {
  const result = [...stack];
  for (let i = result.length - 1; i >= 0; i--) {
    const change = result[i].changes.find((c) => c.id === id);
    if (!change) continue;
    const edge = side === 'undo' ? change.after : change.before;
    if (edge === current) break;
    result[i] = withoutIds(result[i], new Set([id]));
  }
  return result;
}

/**
 * Rolls back a failed mutation without corrupting unrelated history:
 *  1. Events where it was the newest change go back to their confirmed value.
 *  2. The transition is reverted in history for those events only:
 *     a failed "do" is dropped, a failed "undo" goes back on the undo stack,
 *     a failed "redo" goes back on the redo stack.
 *  3. Any remaining history step that no longer matches the reverted value
 *     (e.g. an older superseded failure) is trimmed.
 * Later commands on other events are untouched, so Ctrl+Z keeps working.
 */
export function rollbackMutation(
  state: HistoryState,
  mutation: Mutation,
  reverts: Map<string, CalendarEvent | null>,
): HistoryState {
  if (reverts.size === 0) return state;
  const ids = new Set(reverts.keys());

  const events = { ...state.events };
  for (const [id, value] of reverts) {
    if (value) events[id] = value;
    else delete events[id];
  }

  let undoStack = state.undoStack;
  let redoStack = state.redoStack;
  const inUndo = undoStack.find((c) => c.id === mutation.commandId);
  const inRedo = redoStack.find((c) => c.id === mutation.commandId);

  if (mutation.kind === 'do') {
    undoStack = undoStack.map((c) => (c.id === mutation.commandId ? withoutIds(c, ids) : c));
    redoStack = redoStack.map((c) => (c.id === mutation.commandId ? withoutIds(c, ids) : c));
  } else if (mutation.kind === 'undo' && inRedo) {
    redoStack = redoStack.map((c) => (c.id === mutation.commandId ? withoutIds(c, ids) : c));
    undoStack = [...undoStack, onlyIds(inRedo, ids)];
  } else if (mutation.kind === 'redo' && inUndo) {
    undoStack = undoStack.map((c) => (c.id === mutation.commandId ? withoutIds(c, ids) : c));
    redoStack = [...redoStack, onlyIds(inUndo, ids)];
  }

  for (const id of ids) {
    const current = events[id] ?? null;
    undoStack = reconcileStack(undoStack, id, current, 'undo');
    redoStack = reconcileStack(redoStack, id, current, 'redo');
  }

  return {
    events,
    undoStack: undoStack.filter((c) => c.changes.length > 0),
    redoStack: redoStack.filter((c) => c.changes.length > 0),
  };
}
