/**
 * Thin client for the SmartSchool API (docs/09-API-DESIGN.md).
 * Requests go to the same origin (/api/v1/...) and Next.js proxies them to the API.
 * The access token lives in memory only; the refresh token is an HttpOnly cookie set by the
 * API, so no credential is ever readable by page scripts (docs/11 section 3).
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

export interface TokenResponse {
  accessToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

const BASE = '/api/v1';
const CSRF_HEADERS = { 'x-requested-with': 'SmartSchool' };

let accessToken: string | null = null;

export const tokenStore = {
  get access(): string | null {
    return accessToken;
  },
  set(token: string): void {
    accessToken = token;
  },
  clear(): void {
    accessToken = null;
  },
};

let refreshing: Promise<boolean> | null = null;

/** Rotates the refresh cookie once; concurrent callers share the same attempt. */
export async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', ...CSRF_HEADERS }, body: '{}', credentials: 'same-origin' });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      tokenStore.set(((await res.json()) as TokenResponse).accessToken);
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
    const headers: Record<string, string> = { accept: 'application/json', ...CSRF_HEADERS };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && tokenStore.access) headers.authorization = `Bearer ${tokenStore.access}`;
    return fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'same-origin' });
  };

  if (auth && !tokenStore.access) await tryRefresh();
  let res = await send();
  if (res.status === 401 && auth && (await tryRefresh())) {
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

/** Uploads one file as multipart form data to an authenticated endpoint. */
export async function upload<T = unknown>(path: string, file: File): Promise<T> {
  if (!tokenStore.access) await tryRefresh();
  const form = new FormData();
  form.append('file', file);
  let res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { authorization: `Bearer ${tokenStore.access ?? ''}`, ...CSRF_HEADERS }, body: form, credentials: 'same-origin' });
  if (res.status === 401 && (await tryRefresh())) {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { authorization: `Bearer ${tokenStore.access ?? ''}`, ...CSRF_HEADERS }, body: form, credentials: 'same-origin' });
  }
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const problem = (data ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({ type: problem.type ?? 'about:blank', title: problem.title ?? res.statusText, status: problem.status ?? res.status, detail: problem.detail ?? 'The upload failed.', code: problem.code ?? `http.${res.status}`, errors: problem.errors, traceId: problem.traceId });
  }
  return data as T;
}

/** Downloads a file from an authenticated endpoint (CSV exports, templates). */
export async function download(path: string, filename: string): Promise<void> {
  if (!tokenStore.access) await tryRefresh();
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${tokenStore.access ?? ''}`, ...CSRF_HEADERS }, credentials: 'same-origin' });
  if (!res.ok) throw new Error('Download failed.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.problem.errors?.length) return err.problem.errors.join(' ');
    return err.problem.detail;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
