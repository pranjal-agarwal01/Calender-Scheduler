import { useEffect, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue';
import { userService } from '../services/userService';
import { useUsersStore } from '../store/usersStore';
import { toApiError } from '../api/apiError';
import type { User } from '../domain/types';

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * Debounced people search (GET /users/search?q=). Each new query aborts the
 * previous request, so a slow early response can never overwrite a newer one.
 */
export function useAttendeeSearch(query: string, delayMs = 300) {
  const debounced = useDebouncedValue(query.trim(), delayMs);
  const [results, setResults] = useState<User[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!debounced) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    userService
      .search(debounced, controller.signal)
      .then((users) => {
        useUsersStore.getState().remember(users);
        setResults(users);
        setStatus('done');
        setError(null);
      })
      .catch((err: unknown) => {
        const apiError = toApiError(err);
        if (apiError.code === 'CANCELLED') return;
        setError(apiError.message);
        setStatus('error');
      });
    return () => controller.abort();
  }, [debounced]);

  const pending = query.trim() !== debounced || status === 'loading';
  return { results: debounced ? results : [], status: pending && query.trim() ? 'loading' : status, error };
}
