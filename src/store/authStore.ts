import { create } from 'zustand';
import { authService } from '../services/authService';
import { tokenStorage, type SessionChangeReason } from '../auth/tokenStorage';
import { toApiError } from '../api/apiError';
import type { AuthUser } from '../domain/types';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Why the user is looking at the login page (session expired, logged out elsewhere...). */
  notice: string | null;
  init: () => Promise<void>;
  login: (username: string, password: string, expiresInMins: number) => Promise<void>;
  logout: () => void;
  clearNotice: () => void;
}

// Shared promises make init/login idempotent: a double click (or React
// StrictMode's double effect) reuses the in-flight request instead of sending another.
let initPromise: Promise<void> | null = null;
let loginPromise: Promise<void> | null = null;

const NOTICES: Partial<Record<SessionChangeReason, string>> = {
  expired: 'Your session expired. Please sign in again.',
  external: 'You were signed out in another tab.',
};

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  user: null,
  notice: null,

  init: () => {
    initPromise ??= (async () => {
      const session = tokenStorage.get();
      if (!session) {
        set({ status: 'anonymous', user: null });
        return;
      }
      try {
        // Validates the token; an expired one is refreshed transparently by the http client.
        const user = await authService.me();
        tokenStorage.set({ ...(tokenStorage.get() ?? session), user }, 'refresh');
        set({ status: 'authenticated', user });
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.code === 'NETWORK' || apiError.code === 'TIMEOUT') {
          // Offline: trust the cached profile rather than logging the user out.
          set({ status: 'authenticated', user: session.user });
        } else {
          tokenStorage.clear('expired');
          set({ status: 'anonymous', user: null, notice: NOTICES.expired });
        }
      }
    })().finally(() => {
      initPromise = null;
    });
    return initPromise;
  },

  login: (username, password, expiresInMins) => {
    loginPromise ??= (async () => {
      try {
        const result = await authService.login(username.trim(), password, expiresInMins);
        tokenStorage.set({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresInMins,
          user: result.user,
        });
        set({ status: 'authenticated', user: result.user, notice: null });
      } catch (error) {
        const apiError = toApiError(error);
        // DummyJSON answers wrong credentials with 400 "Invalid credentials".
        if (apiError.status === 400 || apiError.status === 401) {
          throw new Error('Incorrect username or password.', { cause: error });
        }
        throw new Error(apiError.message, { cause: error });
      }
    })().finally(() => {
      loginPromise = null;
    });
    return loginPromise;
  },

  logout: () => {
    tokenStorage.clear('logout'); // removing the key notifies other tabs via the storage event
    set({ status: 'anonymous', user: null, notice: null });
  },

  clearNotice: () => set({ notice: null }),
}));

// Keep the store in sync with session changes made elsewhere: the http client
// ending an expired session, or another tab logging in/out.
tokenStorage.subscribe((session, reason) => {
  const { status, user } = useAuthStore.getState();
  if (!session && status === 'authenticated') {
    useAuthStore.setState({ status: 'anonymous', user: null, notice: NOTICES[reason] ?? null });
  } else if (session && reason === 'external' && (status === 'anonymous' || user?.id !== session.user.id)) {
    // Logged in (or switched user) in another tab: adopt that session.
    useAuthStore.setState({ status: 'authenticated', user: session.user, notice: null });
  }
});
