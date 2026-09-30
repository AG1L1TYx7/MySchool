/**
 * Thin client for the SmartSchool API (docs/09-API-DESIGN.md).
 * Requests go to the same origin (/api/v1/...) and Next.js proxies them to the API.
 * Errors are RFC 9457 problem details; ApiError carries the machine-readable code.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  errors?: string[];
  traceId?: string;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
  }
  get code(): string {
    return this.problem.code;
  }
  get status(): number {
    return this.problem.status;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

const ACCESS_KEY = 'smartschool.access';
const REFRESH_KEY = 'smartschool.refresh';
const BASE = '/api/v1';

export const tokenStore = {
  get access(): string | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  get refresh(): string | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(pair: Pick<TokenPair, 'accessToken' | 'refreshToken'>): void {
    try {
      window.localStorage.setItem(ACCESS_KEY, pair.accessToken);
      window.localStorage.setItem(REFRESH_KEY, pair.refreshToken);
    } catch {
      /* private mode or blocked storage: the session lasts for this page only */
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(ACCESS_KEY);
      window.localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
  },
};

let refreshing: Promise<boolean> | null = null;

/** Rotates the refresh token once; concurrent callers share the same attempt. */
async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = tokenStore.refresh;
      if (!refreshToken) return false;
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      tokenStore.set((await res.json()) as TokenPair);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = auth ? tokenStore.access : null;
    if (token) headers.authorization = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  };

  let res = await send();
  if (res.status === 401 && auth && tokenStore.refresh && (await tryRefresh())) {
    res = await send();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const problem = (data ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({
      type: problem.type ?? 'about:blank',
      title: problem.title ?? res.statusText,
      status: problem.status ?? res.status,
      detail: problem.detail ?? 'The request failed.',
      code: problem.code ?? `http.${res.status}`,
      errors: problem.errors,
      traceId: problem.traceId,
      instance: problem.instance,
    });
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.problem.errors?.length) return err.problem.errors.join(' ');
    return err.problem.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
