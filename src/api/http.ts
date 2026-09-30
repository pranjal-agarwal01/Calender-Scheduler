/**
 * The one shared Axios instance. Responsibilities:
 *  1. Attach `Authorization: Bearer <accessToken>` to every request.
 *  2. On 401: refresh the token ONCE, then retry the request once.
 *     Concurrent 401s share the same in-flight refresh promise, so ten failing
 *     requests cause exactly one POST /auth/refresh.
 *  3. Reject with one consistent error shape (ApiError) for every failure.
 */
import axios, { type AxiosAdapter, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { ApiError, toApiError } from './apiError';
import { tokenStorage } from '../auth/tokenStorage';
import { useDevSettings } from '../store/devSettingsStore';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Do not attach the access token (login/refresh). */
    skipAuth?: boolean;
    /** Do not try to refresh on 401 (login/refresh themselves). */
    skipAuthRefresh?: boolean;
    /** Internal: this request was already retried after a refresh. */
    _retried?: boolean;
  }
}

export const API_BASE_URL = 'https://dummyjson.com';

/** Where the client reads and writes tokens. Injected so the client can be unit-tested. */
export interface SessionAdapter {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  getExpiresInMins(): number;
  saveTokens(accessToken: string, refreshToken: string): void;
  /** Refresh failed: the session is over. */
  endSession(): void;
  /** Adds ?delay=3000 when slow-network testing is on. */
  isSlowNetwork?(): boolean;
}

export interface HttpClient {
  instance: AxiosInstance;
  /** Number of refresh calls made (shown in the developer panel to prove single-flight). */
  getRefreshCount(): number;
}

export function createHttpClient(session: SessionAdapter, options: { adapter?: AxiosAdapter } = {}): HttpClient {
  const instance = axios.create({
    baseURL: API_BASE_URL,
    timeout: 20_000,
    headers: { 'Content-Type': 'application/json' },
    adapter: options.adapter,
  });

  let refreshInFlight: Promise<string> | null = null;
  let refreshCount = 0;

  function refreshAccessToken(): Promise<string> {
    // Single-flight: everyone who hits a 401 while a refresh is running awaits the same promise.
    refreshInFlight ??= (async () => {
      const refreshToken = session.getRefreshToken();
      if (!refreshToken) throw new ApiError({ code: 'UNAUTHORIZED', status: 401, message: 'Please sign in again.' });
      refreshCount++;
      const { data } = await instance.post<{ accessToken: string; refreshToken?: string }>(
        '/auth/refresh',
        { refreshToken, expiresInMins: session.getExpiresInMins() },
        { skipAuth: true, skipAuthRefresh: true },
      );
      session.saveTokens(data.accessToken, data.refreshToken ?? refreshToken);
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  instance.interceptors.request.use((config) => {
    if (!config.skipAuth) {
      const token = session.getAccessToken();
      if (token) config.headers.set('Authorization', `Bearer ${token}`);
    }
    if (session.isSlowNetwork?.()) config.params = { ...config.params, delay: 3000 };
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      const config = axios.isAxiosError(error) ? (error.config as InternalAxiosRequestConfig | undefined) : undefined;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;

      if (status !== 401 || !config || config.skipAuthRefresh || config._retried) {
        throw toApiError(error);
      }

      config._retried = true;
      try {
        const sentWith = String(config.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
        const current = session.getAccessToken();
        // If another request already refreshed while this one was in flight, just retry with the new token.
        if (!current || current === sentWith) await refreshAccessToken();
      } catch (refreshError) {
        const normalised = toApiError(refreshError);
        // Offline is not a logout: keep the session so the next attempt can refresh.
        if (normalised.code === 'NETWORK' || normalised.code === 'TIMEOUT') throw normalised;
        session.endSession();
        throw new ApiError({ code: 'UNAUTHORIZED', status: 401, message: 'Your session has expired. Please sign in again.' });
      }
      // The request interceptor attaches the fresh token on the retry.
      return instance.request(config);
    },
  );

  return { instance, getRefreshCount: () => refreshCount };
}

const browserSession: SessionAdapter = {
  getAccessToken: () => tokenStorage.get()?.accessToken ?? null,
  getRefreshToken: () => tokenStorage.get()?.refreshToken ?? null,
  getExpiresInMins: () => tokenStorage.get()?.expiresInMins ?? 30,
  saveTokens: (accessToken, refreshToken) => tokenStorage.updateTokens(accessToken, refreshToken),
  endSession: () => tokenStorage.clear('expired'),
  isSlowNetwork: () => useDevSettings.getState().slowNetwork,
};

const client = createHttpClient(browserSession);

/** The shared Axios instance. Only service files import this. */
export const http = client.instance;
export const getRefreshCount = client.getRefreshCount;
