import { ApiError, tokenStore, tryRefresh, type ProblemDetails } from './api';

/** School structure, calendar and period attendance (docs/13 sections 3 and 5). */

export interface GradingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
}
export interface Term {
  id: string;
  academicYearId: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
  gradingPeriods: GradingPeriod[];
}
export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  terms: Term[];
}
export interface Period {
  id: string;
  bellScheduleId: string;
  name: string;
  startTime: string;
  endTime: string;
  days: string;
  sortOrder: number;
}
export interface BellSchedule {
  id: string;
  name: string;
  isDefault: boolean;
  periods: Period[];
}
export interface AttendanceCode {
  id: string;
  code: string;
  label: string;
  category: string;
  countsAsPresent: boolean;
  isActive: boolean;
  sortOrder: number;
}
export interface SchoolStructure {
  gradeLevels: string[];
  attendanceDeadlineTime: string | null;
  timezone: string;
  years: AcademicYear[];
  bellSchedules: BellSchedule[];
  attendanceCodes: AttendanceCode[];
}

export interface FeedItem {
  id: string;
  kind: 'event' | 'assignment' | 'term';
  type: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  classId: string | null;
  className: string | null;
  link: string | null;
  canEdit: boolean;
}

export interface ClassTakenStatus {
  classId: string;
  name: string;
  period: string | null;
  teachers: string[];
  taken: boolean;
  marked: number;
  enrolled: number;
}
export interface TakenStatus {
  date: string;
  deadline: string | null;
  taken: ClassTakenStatus[];
  missing: ClassTakenStatus[];
}

export const GRADE_LEVELS = ['PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
export const TERM_TYPES = ['semester', 'trimester', 'quarter', 'term'] as const;
export const CODE_CATEGORIES = ['present', 'tardy', 'excused', 'unexcused', 'remote', 'other'] as const;
export const EVENT_TYPES = ['day_off', 'early_release', 'school_event', 'class_event'] as const;
export const EVENT_LABELS: Record<string, string> = { day_off: 'Day off', early_release: 'Early release', term_start: 'Term starts', term_end: 'Term ends', school_event: 'School event', class_event: 'Class event', assignment_due: 'Due' };
export const DAY_LETTERS: Array<[string, string]> = [
  ['M', 'Mon'],
  ['T', 'Tue'],
  ['W', 'Wed'],
  ['R', 'Thu'],
  ['F', 'Fri'],
  ['S', 'Sat'],
  ['U', 'Sun'],
];

export const gradeLabel = (g: string) => (g === 'K' ? 'Kindergarten' : g === 'PK' ? 'Pre-K' : `Grade ${g}`);
export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
export const periodLabel = (p: Pick<Period, 'name' | 'startTime' | 'endTime'>) => `Period ${p.name} · ${p.startTime}–${p.endTime}`;

/** Fetches a CSV behind the bearer token and hands it to the browser as a download. */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  if (!tokenStore.access) await tryRefresh();
  const send = () => fetch(`/api/v1${path}`, { headers: { authorization: `Bearer ${tokenStore.access ?? ''}`, 'x-requested-with': 'SmartSchool' }, credentials: 'same-origin' });
  let res = await send();
  if (res.status === 401 && (await tryRefresh())) res = await send();
  if (!res.ok) {
    const problem = ((await res.json().catch(() => ({}))) ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({ type: problem.type ?? 'about:blank', title: problem.title ?? res.statusText, status: problem.status ?? res.status, detail: problem.detail ?? 'The export failed.', code: problem.code ?? `http.${res.status}`, errors: problem.errors, traceId: problem.traceId });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
