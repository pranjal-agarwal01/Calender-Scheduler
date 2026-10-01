import { http } from '../api/http';
import type { AuthUser } from '../domain/types';

interface LoginResponse extends AuthUser {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

function toAuthUser(data: AuthUser): AuthUser {
  return {
    id: data.id,
    username: data.username,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    image: data.image,
  };
}

export const authService = {
  /** POST /auth/login: returns the user plus access/refresh tokens. */
  async login(username: string, password: string, expiresInMins: number): Promise<LoginResult> {
    const { data } = await http.post<LoginResponse>(
      '/auth/login',
      { username, password, expiresInMins },
      { skipAuth: true, skipAuthRefresh: true },
    );
    return { user: toAuthUser(data), accessToken: data.accessToken, refreshToken: data.refreshToken };
  },

  /** GET /auth/me: validates the stored token (refreshing it if expired) on reload. */
  async me(signal?: AbortSignal): Promise<AuthUser> {
    const { data } = await http.get<AuthUser>('/auth/me', { signal });
    return toAuthUser(data);
  },
};
