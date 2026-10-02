import { ApiError, tokenStore, tryRefresh, type ProblemDetails } from './api';

/** Rostering and sign-in settings (docs/13 section 2). */

export interface RosterSource {
  id: string;
  organizationId: string;
  provider: 'oneroster_api' | 'clever' | 'classlink' | 'oneroster_csv';
  name: string;
  config: Record<string, string>;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastRun: RosterRun | null;
  createdAt: string;
}

export interface SyncCounts {
  users: { created: number; updated: number; linked: number };
  students: { created: number; updated: number };
  guardians: { created: number };
  courses: { created: number; updated: number };
  classes: { created: number; updated: number };
  enrollments: { created: number; updated: number; dropped: number };
  teachers: { created: number };
  skipped: number;
}

export interface RosterRun {
  id: string;
  sourceId: string | null;
  provider: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  summary: SyncCounts | null;
  errorMessage: string | null;
  errorCount: number;
  errors?: Array<{ entityType: string; externalId: string | null; message: string }>;
}

export interface SsoSettings {
  providers: Array<'google' | 'microsoft' | 'clever' | 'classlink'>;
  allowedDomains: string[];
  passwordOptional: boolean;
  schoolExternalId: string | null;
}

export const PROVIDER_LABELS: Record<string, string> = { oneroster_api: 'OneRoster API', oneroster_csv: 'OneRoster CSV', clever: 'Clever', classlink: 'ClassLink', google: 'Google', microsoft: 'Microsoft' };

/** Uploads one or more OneRoster files (a zip or the CSVs) to the import endpoint. */
export async function uploadRoster(organizationId: string, files: File[], dryRun: boolean): Promise<RosterRun> {
  if (!tokenStore.access) await tryRefresh();
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const send = () => fetch(`/api/v1/organizations/${organizationId}/roster/import?dryRun=${dryRun}`, { method: 'POST', headers: { authorization: `Bearer ${tokenStore.access ?? ''}`, 'x-requested-with': 'SmartSchool' }, body: form, credentials: 'same-origin' });
  let res = await send();
  if (res.status === 401 && (await tryRefresh())) res = await send();
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const problem = (data ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({ type: problem.type ?? 'about:blank', title: problem.title ?? res.statusText, status: problem.status ?? res.status, detail: problem.detail ?? 'The import failed.', code: problem.code ?? `http.${res.status}`, errors: problem.errors, traceId: problem.traceId });
  }
  return data as RosterRun;
}
