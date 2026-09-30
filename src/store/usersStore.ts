import { create } from 'zustand';
import { userService } from '../services/userService';
import type { User } from '../domain/types';

/**
 * Attendee cache. The first page (30 users) is loaded once for the picker;
 * any other id (e.g. a todo's organizer #152) is fetched on demand with
 * GET /users/{id}, deduplicated so each id is requested at most once.
 */
interface UsersState {
  byId: Record<number, User>;
  initialIds: number[];
  listState: 'idle' | 'loading' | 'ready' | 'error';
  /** Ids whose full profile (phone, company) has been loaded. */
  detailed: Record<number, true>;
  loadInitial: () => Promise<void>;
  remember: (users: User[]) => void;
  ensure: (ids: number[]) => void;
  loadDetails: (id: number) => Promise<User>;
}

const inFlight = new Map<number, Promise<User>>();
let listPromise: Promise<void> | null = null;

export const useUsersStore = create<UsersState>((set, get) => ({
  byId: {},
  initialIds: [],
  listState: 'idle',
  detailed: {},

  loadInitial: () => {
    if (get().listState === 'ready') return Promise.resolve();
    listPromise ??= (async () => {
      set({ listState: 'loading' });
      try {
        const page = await userService.list(30, 0);
        get().remember(page.users);
        set({ initialIds: page.users.map((u) => u.id), listState: 'ready' });
      } catch {
        set({ listState: 'error' });
      } finally {
        listPromise = null;
      }
    })();
    return listPromise;
  },

  remember: (users) => {
    if (!users.length) return;
    const byId = { ...get().byId };
    for (const user of users) byId[user.id] = { ...byId[user.id], ...user };
    set({ byId });
  },

  ensure: (ids) => {
    for (const id of ids) {
      if (get().byId[id] || inFlight.has(id)) continue;
      void get()
        .loadDetails(id)
        .catch(() => undefined);
    }
  },

  loadDetails: (id) => {
    if (get().detailed[id]) return Promise.resolve(get().byId[id]);
    let request = inFlight.get(id);
    if (!request) {
      request = userService.getById(id).then(
        (user) => {
          get().remember([user]);
          set({ detailed: { ...get().detailed, [id]: true } });
          inFlight.delete(id);
          return user;
        },
        (error: unknown) => {
          inFlight.delete(id);
          throw error;
        },
      );
      inFlight.set(id, request);
    }
    return request;
  },
}));

export function userName(user: User | undefined, fallbackId?: number): string {
  if (!user) return fallbackId ? `User #${fallbackId}` : 'Unknown';
  return `${user.firstName} ${user.lastName}`.trim();
}
