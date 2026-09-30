import { http } from '../api/http';
import type { EventChange } from '../domain/changes';
import type { Todo } from '../domain/seed';
import { useDevSettings } from '../store/devSettingsStore';
import { unreliableNetwork } from './fakeNetwork';

interface TodosPage {
  todos: Todo[];
  total: number;
  skip: number;
  limit: number;
}

const PAGE_SIZE = 100;

async function syncChange(change: EventChange): Promise<void> {
  const event = change.after ?? change.before;
  if (!event) return;
  const remoteId = event.remoteId;

  if (change.after === null) {
    // Only seeded events exist on DummyJSON; ids created here would 404.
    if (remoteId !== null) await http.delete(`/todos/${remoteId}`);
    return;
  }
  const body = { todo: change.after.title, completed: false, userId: change.after.organizerId };
  if (remoteId !== null) {
    await http.put(`/todos/${remoteId}`, { todo: body.todo, completed: body.completed });
  } else if (change.before === null) {
    await http.post('/todos/add', body);
  }
  // Updates to locally-created events have no remote id: DummyJSON never
  // stored them (new ids return 404), so the browser store is the only truth.
}

export const eventService = {
  /** Seed events: GET /todos?limit=100&skip=N, paging with skip until `total` (254). */
  async fetchAllTodos(signal?: AbortSignal): Promise<Todo[]> {
    const first = await http.get<TodosPage>('/todos', { params: { limit: PAGE_SIZE, skip: 0 }, signal });
    const pageCount = Math.ceil(first.data.total / PAGE_SIZE);
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) =>
        http.get<TodosPage>('/todos', { params: { limit: PAGE_SIZE, skip: (i + 1) * PAGE_SIZE }, signal }),
      ),
    );
    return [first.data, ...rest.map((r) => r.data)].flatMap((page) => page.todos);
  },

  /**
   * Fake sync of one mutation (a command, undo or redo). The fake API fails
   * ~20% of the time; otherwise the matching DummyJSON calls are made
   * (POST /todos/add, PUT /todos/{id}, DELETE /todos/{id}).
   */
  async syncChanges(changes: EventChange[]): Promise<void> {
    await unreliableNetwork(useDevSettings.getState().failureRate);
    await Promise.all(changes.map(syncChange));
  },
};
