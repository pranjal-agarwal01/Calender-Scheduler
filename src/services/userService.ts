import { http } from '../api/http';
import type { User } from '../domain/types';

const LIST_FIELDS = 'firstName,lastName,image,email';

interface UsersPage {
  users: User[];
  total: number;
  skip: number;
  limit: number;
}

export const userService = {
  /** GET /users?limit=30&skip=0&select=firstName,lastName,image,email */
  async list(limit = 30, skip = 0, signal?: AbortSignal): Promise<UsersPage> {
    const { data } = await http.get<UsersPage>('/users', { params: { limit, skip, select: LIST_FIELDS }, signal });
    return data;
  },

  /** GET /users/search?q=ravi — callers debounce and abort stale searches. */
  async search(query: string, signal?: AbortSignal): Promise<User[]> {
    const { data } = await http.get<UsersPage>('/users/search', {
      params: { q: query, limit: 20, select: LIST_FIELDS },
      signal,
    });
    return data.users;
  },

  /** GET /users/{id} — full profile (phone, company...) for the details view. */
  async getById(id: number, signal?: AbortSignal): Promise<User> {
    const { data } = await http.get<User>(`/users/${id}`, { signal });
    return data;
  },
};
