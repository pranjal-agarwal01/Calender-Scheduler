import { useCallback } from 'react';
import { useCalendarStore } from '../store/calendarStore';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { announce } from '../store/announcerStore';
import { toast } from '../store/toastStore';
import { resolveOccurrence } from '../domain/recurrence/expand';
import {
  availableScopes,
  draftFromOccurrence,
  planCreate,
  planDelete,
  planEdit,
  type PlanContext,
} from '../domain/recurrence/edit';
import type { EditScope, EventDraft, Occurrence } from '../domain/types';
import { describeWhen } from '../domain/describeWhen';

function newEventId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`;
  return `evt_${random.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
}

function planContext(): PlanContext {
  return {
    now: new Date().toISOString(),
    newId: newEventId,
    organizerId: useAuthStore.getState().user?.id ?? 1,
  };
}

const SCOPE_SUFFIX: Record<EditScope, string> = { this: '', following: ' (this and following)', all: ' (all events)' };

/** Re-reads an occurrence after an await: the store may have changed (e.g. a rollback) meanwhile. */
function refresh(occurrence: Occurrence): Occurrence | null {
  return resolveOccurrence(useCalendarStore.getState().events, occurrence.key);
}

async function chooseScope(
  action: 'edit' | 'delete' | 'move',
  occurrence: Occurrence,
  draft: EventDraft | null,
): Promise<EditScope | null> {
  const scopes = availableScopes(occurrence, draft, useCalendarStore.getState().events);
  if (scopes.length === 0) return 'this';
  return useUiStore.getState().askScope(action, scopes);
}

/**
 * All user-initiated changes go through here: plan (pure) -> ask recurrence
 * scope if needed -> execute as one undoable command -> announce.
 */
export function useEventActions(timeZone: string) {
  const createEvent = useCallback(
    (draft: EventDraft): boolean => {
      const id = useCalendarStore.getState().execute(`Create “${draft.title.trim()}”`, planCreate(draft, planContext()));
      if (id) announce(`Created ${draft.title.trim()}, ${describeWhen(draft.start, draft.end, draft.allDay, timeZone)}`);
      return id !== null;
    },
    [timeZone],
  );

  const updateOccurrence = useCallback(
    async (occurrence: Occurrence, draft: EventDraft, verb: 'Edit' | 'Move' | 'Resize'): Promise<boolean> => {
      const scope = await chooseScope(verb === 'Edit' ? 'edit' : 'move', occurrence, draft);
      if (!scope) {
        announce(`${verb} cancelled`);
        return false;
      }
      const current = refresh(occurrence);
      if (!current) {
        toast({ kind: 'warning', title: 'This event no longer exists', message: 'It may have been rolled back after a failed save.' });
        return false;
      }
      const { events } = useCalendarStore.getState();
      const changes = planEdit(events, current, draft, scope, planContext());
      const title = draft.title.trim() || current.event.title;
      const id = useCalendarStore.getState().execute(`${verb} “${title}”${SCOPE_SUFFIX[scope]}`, changes);
      if (id) {
        const past = verb === 'Edit' ? 'Saved' : verb === 'Move' ? 'Moved' : 'Resized';
        announce(`${past} ${title}${SCOPE_SUFFIX[scope]}: ${describeWhen(draft.start, draft.end, draft.allDay, timeZone)}`);
      }
      return id !== null;
    },
    [timeZone],
  );

  /** Drag or keyboard move/resize: only the times change. */
  const commitTimeChange = useCallback(
    (occurrence: Occurrence, start: number, end: number, kind: 'move' | 'resize'): Promise<boolean> => {
      if (start === occurrence.start && end === occurrence.end) return Promise.resolve(false);
      const draft = { ...draftFromOccurrence(occurrence, useCalendarStore.getState().events), start, end };
      return updateOccurrence(occurrence, draft, kind === 'move' ? 'Move' : 'Resize');
    },
    [updateOccurrence],
  );

  const deleteOccurrence = useCallback(async (occurrence: Occurrence): Promise<boolean> => {
    const scope = await chooseScope('delete', occurrence, null);
    if (!scope) return false;
    const current = refresh(occurrence);
    if (!current) return false;
    const store = useCalendarStore.getState();
    const title = current.event.title;
    const commandId = store.execute(`Delete “${title}”${SCOPE_SUFFIX[scope]}`, planDelete(store.events, current, scope, planContext()));
    if (!commandId) return false;
    announce(`Deleted ${title}`);
    toast({
      kind: 'info',
      title: `Deleted “${title}”`,
      action: {
        label: 'Undo',
        run: () => {
          // Only undo if the delete is still the latest step (don't undo something else).
          const latest = useCalendarStore.getState().undoStack.at(-1);
          if (latest?.id === commandId) useCalendarStore.getState().undo();
        },
      },
    });
    return true;
  }, []);

  return { createEvent, updateOccurrence, commitTimeChange, deleteOccurrence };
}
