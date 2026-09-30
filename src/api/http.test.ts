import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { createHttpClient, type SessionAdapter } from './http';
import { ApiError } from './apiError';

function memorySession(initial = { access: 'old', refresh: 'r1' }) {
  const state = { ...initial, ended: false };
  const adapter: SessionAdapter = {
    getAccessToken: () => (state.ended ? null : state.access),
    getRefreshToken: () => (state.ended ? null : state.refresh),
    getExpiresInMins: () => 1,
    saveTokens: (access, refresh) => Object.assign(state, { access, refresh }),
    endSession: () => (state.ended = true),
  };
  return { state, adapter };
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
  if (status >= 400) {
    return Promise.reject(new AxiosError(`HTTP ${status}`, undefined, config, null, response));
  }
  return Promise.resolve(response);
}

/** Fake DummyJSON: /auth/refresh issues "new"; other endpoints need the "new" token. */
function fakeServer(options: { refreshFails?: boolean } = {}) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config.url ?? '');
    await new Promise((r) => setTimeout(r, 5));
    if (config.url === '/auth/refresh') {
      return options.refreshFails
        ? respond(config, 401, { message: 'Invalid refresh token' })
        : respond(config, 200, { accessToken: 'new', refreshToken: 'r2' });
    }
    const auth = config.headers.get('Authorization');
    if (auth !== 'Bearer new') return respond(config, 401, { message: 'Token Expired!' });
    return respond(config, 200, { ok: config.url });
  };
  return { adapter, calls };
}

describe('shared http client', () => {
  it('refreshes once for many concurrent 401s and retries each request', async () => {
    const { adapter: session, state } = memorySession();
    const server = fakeServer();
    const client = createHttpClient(session, { adapter: server.adapter });

    const results = await Promise.all(['/a', '/b', '/c', '/d', '/e'].map((url) => client.instance.get(url)));

    expect(results.map((r) => r.data.ok)).toEqual(['/a', '/b', '/c', '/d', '/e']);
    expect(client.getRefreshCount()).toBe(1);
    expect(server.calls.filter((url) => url === '/auth/refresh')).toHaveLength(1);
    expect(state.access).toBe('new');
  });

  it('ends the session and rejects with a normalised error when refresh fails', async () => {
    const { adapter: session, state } = memorySession();
    const server = fakeServer({ refreshFails: true });
    const client = createHttpClient(session, { adapter: server.adapter });

    const failures = await Promise.allSettled([client.instance.get('/a'), client.instance.get('/b')]);

    for (const failure of failures) {
      expect(failure.status).toBe('rejected');
      const reason = (failure as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ApiError);
      expect(reason).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    }
    expect(client.getRefreshCount()).toBe(1);
    expect(state.ended).toBe(true);
  });

  it('normalises network errors', async () => {
    const { adapter: session } = memorySession({ access: 'new', refresh: 'r' });
    const client = createHttpClient(session, {
      adapter: (config) => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config)),
    });
    await expect(client.instance.get('/x')).rejects.toMatchObject({ code: 'NETWORK', status: null });
  });
});
