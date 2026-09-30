/**
 * The persisted session (tokens + profile) lives in localStorage so that:
 *  - a reload can restore it (validated with GET /auth/me), and
 *  - other tabs hear about logins/logouts through the `storage` event.
 *
 * This module is framework-free so the Axios interceptors can read tokens
 * without going through React.
 */
import type { AuthUser } from '../domain/types';

export const SESSION_KEY = 'cal.session.v1';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresInMins: number;
  user: AuthUser;
}

export type SessionChangeReason = 'login' | 'refresh' | 'logout' | 'expired' | 'external';
type Listener = (session: StoredSession | null, reason: SessionChangeReason) => void;

const listeners = new Set<Listener>();
let cached: StoredSession | null | undefined;

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresInMins === 'number' &&
    !!v.user &&
    typeof (v.user as Record<string, unknown>).id === 'number'
  );
}

function read(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null; // corrupted or storage blocked: treat as logged out
  }
}

function write(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage full/blocked: keep the in-memory copy so this tab still works.
  }
}

function emit(reason: SessionChangeReason) {
  for (const listener of listeners) listener(cached ?? null, reason);
}

export const tokenStorage = {
  get(): StoredSession | null {
    if (cached === undefined) cached = read();
    return cached;
  },
  set(session: StoredSession, reason: SessionChangeReason = 'login') {
    cached = session;
    write(session);
    emit(reason);
  },
  updateTokens(accessToken: string, refreshToken: string) {
    const current = tokenStorage.get();
    if (!current) return;
    tokenStorage.set({ ...current, accessToken, refreshToken }, 'refresh');
  },
  clear(reason: SessionChangeReason = 'logout') {
    if (tokenStorage.get() === null) return;
    cached = null;
    write(null);
    emit(reason);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// Another tab logged in, refreshed or logged out: re-read and notify.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY && event.key !== null) return;
    cached = read();
    emit('external');
  });
}
