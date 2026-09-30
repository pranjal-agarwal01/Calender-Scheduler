import { describe, expect, it } from 'vitest';
import {
  doCommand,
  invertChanges,
  redoCommand,
  rollbackMutation,
  SyncLedger,
  undoCommand,
  type Command,
  type HistoryState,
  type Mutation,
  type MutationKind,
} from './history';
import { created, updated } from '../domain/changes';
import type { CalendarEvent } from '../domain/types';
import { makeEvent } from '../test/makeEvent';

/**
 * A tiny harness that mirrors what the store does: apply a transition,
 * register the mutation with the ledger, then settle it later.
 */
function harness(initial: CalendarEvent[]) {
  let state: HistoryState = {
    events: Object.fromEntries(initial.map((e) => [e.id, e])),
    undoStack: [],
    redoStack: [],
  };
  const ledger = new SyncLedger();
  let nextMutation = 1;
  let nextCommand = 1;

  const emit = (command: Command, kind: MutationKind): Mutation => {
    const mutation: Mutation = {
      id: nextMutation++,
      commandId: command.id,
      kind,
      label: command.label,
      changes: kind === 'undo' ? invertChanges(command.changes) : command.changes,
    };
    ledger.register(mutation);
    return mutation;
  };

  return {
    get state() {
      return state;
    },
    move(id: string, start: string): Mutation {
      const before = state.events[id];
      const command: Command = { id: `c${nextCommand++}`, label: `move ${id}`, changes: [updated(before, { ...before, start })] };
      state = doCommand(state, command);
      return emit(command, 'do');
    },
    create(event: CalendarEvent): Mutation {
      const command: Command = { id: `c${nextCommand++}`, label: `create ${event.id}`, changes: [created(event)] };
      state = doCommand(state, command);
      return emit(command, 'do');
    },
    undo(): Mutation {
      const result = undoCommand(state)!;
      state = result.state;
      return emit(result.command, 'undo');
    },
    redo(): Mutation {
      const result = redoCommand(state)!;
      state = result.state;
      return emit(result.command, 'redo');
    },
    succeed(mutation: Mutation) {
      ledger.succeed(mutation);
    },
    fail(mutation: Mutation) {
      state = rollbackMutation(state, mutation, ledger.fail(mutation));
    },
    start(id: string) {
      return state.events[id]?.start;
    },
  };
}

const T = (h: number) => `2026-10-05T${String(h).padStart(2, '0')}:00:00.000Z`;

describe('command history', () => {
  it('undoes and redoes a command', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) })]);
    h.move('a', T(10));
    h.undo();
    expect(h.start('a')).toBe(T(9));
    h.redo();
    expect(h.start('a')).toBe(T(10));
  });
});

describe('rollback of failed saves', () => {
  it('reverts only the failed command and keeps later undo steps intact', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) }), makeEvent({ id: 'b', start: T(9) })]);
    const moveA = h.move('a', T(10));
    const moveB = h.move('b', T(11));

    h.fail(moveA); // A's save fails after B was already changed
    h.succeed(moveB);

    expect(h.start('a')).toBe(T(9)); // rolled back
    expect(h.start('b')).toBe(T(11)); // untouched
    expect(h.state.undoStack.map((c) => c.label)).toEqual(['move b']);

    h.undo(); // Ctrl+Z undoes B, not the failed A
    expect(h.start('b')).toBe(T(9));
    expect(h.start('a')).toBe(T(9));
  });

  it('removes a failed create entirely', () => {
    const h = harness([]);
    const create = h.create(makeEvent({ id: 'n' }));
    h.fail(create);
    expect(h.state.events.n).toBeUndefined();
    expect(h.state.undoStack).toHaveLength(0);
  });

  it('keeps the last action when an older save of the same event fails (race)', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) })]);
    const drag1 = h.move('a', T(10));
    const drag2 = h.move('a', T(12)); // second drag while the first save is pending

    h.fail(drag1); // superseded: drag2 carries the full state
    h.succeed(drag2);

    expect(h.start('a')).toBe(T(12));
    expect(h.state.undoStack).toHaveLength(2);
  });

  it('ignores a stale success arriving after a newer failure of the same event', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) })]);
    const drag1 = h.move('a', T(10));
    const drag2 = h.move('a', T(12));

    h.succeed(drag1); // server now has 10:00
    h.fail(drag2); // newest failed -> back to the last confirmed value

    expect(h.start('a')).toBe(T(10));
    expect(h.state.undoStack.map((c) => c.label)).toEqual(['move a']);
    h.undo();
    expect(h.start('a')).toBe(T(9));
  });

  it('rolls back through an older failure that was superseded', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) })]);
    const drag1 = h.move('a', T(10));
    const drag2 = h.move('a', T(12));

    h.fail(drag1); // superseded, nothing visible happens
    expect(h.start('a')).toBe(T(12));
    h.fail(drag2); // now nothing reached the server: back to the original

    expect(h.start('a')).toBe(T(9));
    expect(h.state.undoStack).toHaveLength(0); // no step points at a state that never saved
  });

  it('a failed undo puts the command back on the undo stack', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) })]);
    const drag = h.move('a', T(10));
    h.succeed(drag);
    const undo = h.undo();
    expect(h.start('a')).toBe(T(9));

    h.fail(undo);

    expect(h.start('a')).toBe(T(10));
    expect(h.state.undoStack.map((c) => c.label)).toEqual(['move a']);
    expect(h.state.redoStack).toHaveLength(0);
  });

  it('a failed redo puts the command back on the redo stack', () => {
    const h = harness([makeEvent({ id: 'a', start: T(9) })]);
    h.succeed(h.move('a', T(10)));
    h.succeed(h.undo());
    const redo = h.redo();

    h.fail(redo);

    expect(h.start('a')).toBe(T(9));
    expect(h.state.redoStack.map((c) => c.label)).toEqual(['move a']);
    expect(h.state.undoStack).toHaveLength(0);
  });
});
