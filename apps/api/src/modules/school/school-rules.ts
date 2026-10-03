/** Pure rules for school structure: dates, periods and days, attendance code defaults, grade levels. */

export const GRADE_LEVELS = [
  'PK',
  'K',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
] as const;
export const DAY_LETTERS = ['M', 'T', 'W', 'R', 'F', 'S', 'U'] as const; // Monday..Sunday; R = Thursday, U = Sunday
const DAY_INDEX: Record<string, number> = {
  M: 1,
  T: 2,
  W: 3,
  R: 4,
  F: 5,
  S: 6,
  U: 0,
};

export function parseGradeLevels(raw: string | null | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((g) => g.trim().toUpperCase())
    .filter(Boolean);
  return list.length
    ? list
    : ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
}

export function isValidGradeLevel(g: string): boolean {
  return (GRADE_LEVELS as readonly string[]).includes(g.trim().toUpperCase());
}

/** "MTWRF" -> true for a Monday; invalid letters are ignored. */
export function meetsOn(days: string, date: Date): boolean {
  const dow = date.getUTCDay();
  return days
    .toUpperCase()
    .split('')
    .some((d) => DAY_INDEX[d] === dow);
}

export function validDays(days: string): boolean {
  return (
    /^[MTWRFSU]{1,7}$/.test(days.toUpperCase()) &&
    new Set(days.toUpperCase()).size === days.length
  );
}

export function validTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function timeBefore(a: string, b: string): boolean {
  return a < b;
}

export function dateRangeValid(
  start: string | Date,
  end: string | Date,
): boolean {
  return new Date(start).getTime() < new Date(end).getTime();
}

/** Terms must sit inside their year; grading periods inside their term. */
export function within(
  inner: { start: Date; end: Date },
  outer: { start: Date; end: Date },
): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

export interface DefaultCode {
  code: string;
  label: string;
  category: 'PRESENT' | 'TARDY' | 'EXCUSED' | 'UNEXCUSED' | 'REMOTE' | 'OTHER';
  countsAsPresent: boolean;
}

/** The code set most US districts start from; schools rename or add codes to match their SIS. */
export const DEFAULT_ATTENDANCE_CODES: readonly DefaultCode[] = [
  { code: 'P', label: 'Present', category: 'PRESENT', countsAsPresent: true },
  { code: 'T', label: 'Tardy', category: 'TARDY', countsAsPresent: true },
  {
    code: 'AE',
    label: 'Absent, excused',
    category: 'EXCUSED',
    countsAsPresent: false,
  },
  {
    code: 'AU',
    label: 'Absent, unexcused',
    category: 'UNEXCUSED',
    countsAsPresent: false,
  },
  { code: 'R', label: 'Remote', category: 'REMOTE', countsAsPresent: true },
  { code: 'FT', label: 'Field trip', category: 'OTHER', countsAsPresent: true },
  {
    code: 'S',
    label: 'Suspended',
    category: 'UNEXCUSED',
    countsAsPresent: false,
  },
];

/** Legacy status kept on each row so older screens and summaries keep working. */
export function statusForCategory(
  category: DefaultCode['category'],
  countsAsPresent: boolean,
): 'PRESENT' | 'ABSENT' | 'TARDY' | 'EXCUSED' {
  if (category === 'TARDY') return 'TARDY';
  if (category === 'EXCUSED') return 'EXCUSED';
  if (category === 'UNEXCUSED') return 'ABSENT';
  return countsAsPresent ? 'PRESENT' : 'ABSENT';
}

/** Chronic absenteeism: missing 10% or more of enrolled days (the federal definition). */
export function isChronicallyAbsent(
  daysEnrolled: number,
  daysAbsent: number,
): boolean {
  return daysEnrolled > 0 && daysAbsent / daysEnrolled >= 0.1;
}

export function averageDailyAttendance(
  rows: Array<{ present: number; enrolled: number }>,
): number {
  const enrolled = rows.reduce((n, r) => n + r.enrolled, 0);
  const present = rows.reduce((n, r) => n + r.present, 0);
  return enrolled === 0 ? 0 : Math.round((present / enrolled) * 10000) / 100;
}

/** "HH:MM" in the school's timezone has passed for the given instant. */
export function deadlinePassed(
  deadline: string | null | undefined,
  now: Date,
  timeZone: string,
): boolean {
  if (!deadline || !validTime(deadline)) return false;
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hh = local.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = local.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh === '24' ? '00' : hh}:${mm}` >= deadline;
}

export function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
