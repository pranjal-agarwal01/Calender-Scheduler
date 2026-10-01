/**
 * The events store (Zustand): events + undo/redo stacks + sync status.
 *
 * Flow of every change:
 *   component -> planX() (pure, domain/) -> execute(label, changes)
 *     -> doCommand (optimistic, instant UI)
 *     -> enqueue mutation -> fake API (serial queue)
 *         success: ledger.succeed
 *         failure: ledger.fail -> rollbackMutation (targeted revert + history repair)
 *   and a debounced write to localStorage.
 */
import { create } from 'zustand';
import type { EventChange } from '../domain/changes';
import type { EventsById } from '../domain/types';
import { generateStressEvents, seedAnchorFor, todoToEvent } from '../domain/seed';
import { todayKey } from '../domain/time/zoned';
import { eventService } from '../services/eventService';
import { toApiError } from '../api/apiError';
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
import { loadCalendar, saveCalendar, storageKey } from './persistence';
import { toast } from './toastStore';
import { announce } from './announcerStore';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type SyncState = 'idle' | 'saving' | 'saved' | 'failed';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastError: string | null;
}

interface CalendarState extends HistoryState {
  userId: number | null;
  loadState: LoadState;
  loadError: string | null;
  seedAnchor: string | null;
  sync: SyncStatus;
  /** Events with a save in flight or queued (drives the per-event "saving" dot). */
  pendingIds: Record<string, true>;

  load: (userId: number, timeZone: string, options?: { force?: boolean }) => Promise<void>;
  unload: () => void;
  execute: (label: string, changes: EventChange[]) => string | null;
  undo: () => Command | null;
  redo: () => Command | null;
  addStressEvents: (count: number, anchor: string, timeZone: string) => void;
  removeStressEvents: () => number;
  resetData: (timeZone: string) => Promise<void>;
}

const byId = (events: { id: string }[]) => Object.fromEntries(events.map((e) => [e.id, e])) as EventsById;

// ---- sync queue (module state: not rendered, so it lives outside React) ----
const ledger = new SyncLedger();
let queue: Mutation[] = [];
let pumping = false;
let pendingCount = 0;
/** Failures since the queue was last empty: decides "Saved" vs "Some changes failed". */
let batchFailures = 0;
let mutationSeq = 0;
let commandSeq = 0;
/** Bumped on logout/reset so results from an old session are ignored. */
let generation = 0;
let loadPromise: { userId: number; promise: Promise<void> } | null = null;

const initialSync: SyncStatus = { state: 'idle', pending: 0, lastError: null };

export const useCalendarStore = create<CalendarState>((set, get) => {
  const pendingRecord = () => Object.fromEntries(ledger.pendingIds().map((id) => [id, true as const]));

  function enqueue(kind: MutationKind, command: Command) {
    const mutation: Mutation = {
      id: ++mutationSeq,
      commandId: command.id,
      kind,
      label: command.label,
      changes: kind === 'undo' ? invertChanges(command.changes) : command.changes,
    };
    ledger.register(mutation);
    queue.push(mutation);
    const newBatch = pendingCount === 0;
    if (newBatch) batchFailures = 0;
    pendingCount++;
    set({
      sync: { state: 'saving', pending: pendingCount, lastError: newBatch ? null : get().sync.lastError },
      pendingIds: pendingRecord(),
    });
    void pump();
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    const gen = generation;
    while (queue.length && gen === generation) {
      const mutation = queue.shift()!;
      let failure: string | null = null;
      try {
        await eventService.syncChanges(mutation.changes);
        if (gen !== generation) break;
        ledger.succeed(mutation);
      } catch (error) {
        if (gen !== generation) break;
        failure = toApiError(error).message;
        const reverts = ledger.fail(mutation);
        const state = get();
        const next = rollbackMutation(state, mutation, reverts);
        set({ events: next.events, undoStack: next.undoStack, redoStack: next.redoStack });
        const verb = mutation.kind === 'do' ? '' : mutation.kind === 'undo' ? 'Undo of ' : 'Redo of ';
        if (reverts.size > 0) {
          toast({
            kind: 'error',
            title: `Couldn't save: ${verb}${mutation.label}`,
            message: 'The change was rolled back. Your other changes are unaffected.',
          });
          announce(`Save failed. ${verb}${mutation.label} was rolled back.`, 'assertive');
        }
      }
      pendingCount--;
      if (failure) batchFailures++;
      set({
        sync: {
          state: pendingCount > 0 ? 'saving' : batchFailures > 0 ? 'failed' : 'saved',
          pending: pendingCount,
          lastError: failure ?? get().sync.lastError,
        },
        pendingIds: pendingRecord(),
      });
    }
    pumping = false;
    if (queue.length) void pump(); // a new session queued work while an old request was finishing
  }

  function resetSync() {
    generation++;
    queue = [];
    pendingCount = 0;
    batchFailures = 0;
    ledger.reset();
  }

  async function doLoad(userId: number, timeZone: string) {
    const gen = generation;
    const outcome = loadCalendar(userId);

    if (outcome.kind === 'loaded' && (outcome.data.events.length > 0 || outcome.data.seedAnchor)) {
      set({ events: byId(outcome.data.events), seedAnchor: outcome.data.seedAnchor, loadState: 'ready' });
      if (outcome.dropped || outcome.repaired) {
        toast({
          kind: 'warning',
          title: 'Some saved events were damaged',
          message: `${outcome.dropped} removed, ${outcome.repaired} repaired. Everything else was recovered.`,
        });
      }
      return;
    }
    if (outcome.kind === 'corrupt') {
      toast({
        kind: 'warning',
        title: 'Saved calendar could not be read',
        message: `${outcome.reason} It was reset${outcome.backupKey ? ' and a backup was kept' : ''}.`,
      });
    }

    // First visit (or unreadable data): seed from DummyJSON todos.
    try {
      const todos = await eventService.fetchAllTodos();
      if (gen !== generation) return;
      const anchor = seedAnchorFor(todayKey(timeZone));
      const now = new Date().toISOString();
      set({
        events: byId(todos.map((todo) => todoToEvent(todo, anchor, timeZone, now))),
        seedAnchor: anchor,
        loadState: 'ready',
      });
      flushSave();
    } catch (error) {
      if (gen !== generation) return;
      set({ loadState: 'error', loadError: toApiError(error).message });
    }
  }

  return {
    userId: null,
    loadState: 'idle',
    loadError: null,
    seedAnchor: null,
    events: {},
    undoStack: [],
    redoStack: [],
    sync: initialSync,
    pendingIds: {},

    load: (userId, timeZone, options = {}) => {
      const state = get();
      if (!options.force && state.userId === userId && state.loadState === 'ready') return Promise.resolve();
      if (!options.force && loadPromise?.userId === userId) return loadPromise.promise;

      resetSync();
      set({
        userId,
        loadState: 'loading',
        loadError: null,
        events: {},
        undoStack: [],
        redoStack: [],
        sync: initialSync,
        pendingIds: {},
      });
      const promise = doLoad(userId, timeZone).finally(() => {
        if (loadPromise?.promise === promise) loadPromise = null;
      });
      loadPromise = { userId, promise };
      return promise;
    },

    unload: () => {
      flushSave();
      resetSync();
      loadPromise = null;
      set({
        userId: null,
        loadState: 'idle',
        loadError: null,
        seedAnchor: null,
        events: {},
        undoStack: [],
        redoStack: [],
        sync: initialSync,
        pendingIds: {},
      });
    },

    execute: (label, changes) => {
      if (!changes.length) return null;
      const state = get();
      // Guard against plans computed from stale data (e.g. a form opened before a rollback):
      // every `before` must be exactly what is in the store right now.
      const stale = changes.some((c) => (state.events[c.id] ?? null) !== c.before);
      if (stale) {
        toast({ kind: 'warning', title: 'That event changed in the meantime', message: 'Please try again.' });
        return null;
      }
      const command: Command = { id: `cmd-${++commandSeq}`, label, changes };
      set(doCommand(state, command));
      enqueue('do', command);
      return command.id;
    },

    undo: () => {
      const result = undoCommand(get());
      if (!result) return null;
      set(result.state);
      enqueue('undo', result.command);
      announce(`Undid: ${result.command.label}`);
      return result.command;
    },

    redo: () => {
      const result = redoCommand(get());
      if (!result) return null;
      set(result.state);
      enqueue('redo', result.command);
      announce(`Redid: ${result.command.label}`);
      return result.command;
    },

    addStressEvents: (count, anchor, timeZone) => {
      const generated = generateStressEvents(count, anchor, timeZone, new Date().toISOString());
      set({ events: { ...get().events, ...byId(generated) } });
    },

    removeStressEvents: () => {
      const { events, undoStack, redoStack } = get();
      const isStress = (id: string) => id.startsWith('stress-');
      const remaining = Object.fromEntries(Object.entries(events).filter(([id]) => !isStress(id)));
      const touchesStress = (c: Command) => c.changes.some((ch) => isStress(ch.id));
      set({
        events: remaining,
        undoStack: undoStack.filter((c) => !touchesStress(c)),
        redoStack: redoStack.filter((c) => !touchesStress(c)),
      });
      return Object.keys(events).length - Object.keys(remaining).length;
    },

    resetData: async (timeZone) => {
      const { userId } = get();
      if (userId === null) return;
      try {
        localStorage.removeItem(storageKey(userId));
      } catch {
        /* ignore */
      }
      await get().load(userId, timeZone, { force: true });
    },
  };
});

// ---- persistence: debounced write whenever events change ----
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const { userId, events, seedAnchor, loadState } = useCalendarStore.getState();
  if (userId === null || loadState !== 'ready') return;
  const result = saveCalendar(userId, { seedAnchor, events: Object.values(events) });
  if (!result.ok) toast({ kind: 'error', title: 'Could not save to this browser', message: result.error });
}

useCalendarStore.subscribe((state, previous) => {
  if (state.events === previous.events || state.loadState !== 'ready') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', (event) => {
    flushSave();
    if (pendingCount > 0) event.preventDefault(); // "changes are still saving" prompt
  });
}
