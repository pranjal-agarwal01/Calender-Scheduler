import axios from 'axios';

/**
 * The single error shape every API call rejects with. Components never see
 * raw Axios errors, so error handling is the same everywhere:
 * `if (error.code === 'UNAUTHORIZED') ...` / `toast(error.message)`.
 */
export type ApiErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SERVER'
  | 'SIMULATED'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(init: { code: ApiErrorCode; message: string; status?: number | null; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status ?? null;
    this.details = init.details;
  }
}

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  NETWORK: "Can't reach the server. Check your connection and try again.",
  TIMEOUT: 'The server took too long to respond. Please try again.',
  CANCELLED: 'The request was cancelled.',
  BAD_REQUEST: 'The request was invalid.',
  UNAUTHORIZED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'The requested resource was not found.',
  SERVER: 'The server had a problem. Please try again.',
  SIMULATED: 'The server rejected the change (simulated failure).',
  UNKNOWN: 'Something went wrong. Please try again.',
};

function codeForStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isCancel(error)) return new ApiError({ code: 'CANCELLED', message: DEFAULT_MESSAGES.CANCELLED });
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError({ code: 'TIMEOUT', message: DEFAULT_MESSAGES.TIMEOUT });
    }
    if (!error.response) return new ApiError({ code: 'NETWORK', message: DEFAULT_MESSAGES.NETWORK });
    const { status, data } = error.response;
    const code = codeForStatus(status);
    const serverMessage =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : null;
    return new ApiError({ code, status, message: serverMessage ?? DEFAULT_MESSAGES[code], details: data });
  }
  if (error instanceof Error) return new ApiError({ code: 'UNKNOWN', message: error.message || DEFAULT_MESSAGES.UNKNOWN });
  return new ApiError({ code: 'UNKNOWN', message: DEFAULT_MESSAGES.UNKNOWN });
}
