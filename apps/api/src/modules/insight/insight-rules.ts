/**
 * Insight rules (docs/02 section 16, docs/13 section 9): the pure arithmetic behind the principal dashboard,
 * class and student analytics, scheduled reports and transcripts. No database, no clock unless passed in.
 */

/** Below this percentage a current grade counts as failing. */
export const PASSING_PERCENT = 60;
/** At or above this many missing items a student is flagged. */
export const MISSING_FLAG = 3;
/** Below this attendance rate (percent) a student is flagged. */
export const ATTENDANCE_FLAG = 90;

const PRESENT_LIKE = new Set(['PRESENT', 'LATE', 'TARDY', 'LEFT_EARLY']);

export const REPORT_KINDS = [
  'school_overview',
  'attendance_today',
  'missing_work',
  'failing_students',
  'gradebook_completeness',
  'ai_usage',
  'class_summary',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface GradeBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

/** Five buckets from A to failing; percentages are rounded before bucketing so 89.6 lands in the A bucket. */
export function gradeBuckets(percentages: number[]): GradeBucket[] {
  const buckets: GradeBucket[] = [
    { label: '90-100', min: 90, max: 100, count: 0 },
    { label: '80-89', min: 80, max: 89, count: 0 },
    { label: '70-79', min: 70, max: 79, count: 0 },
    { label: '60-69', min: 60, max: 69, count: 0 },
    { label: 'Below 60', min: 0, max: 59, count: 0 },
  ];
  for (const raw of percentages) {
    const p = Math.max(0, Math.min(100, Math.round(raw)));
    const b = buckets.find((x) => p >= x.min && p <= x.max);
    if (b) b.count += 1;
  }
  return buckets;
}

export function isFailing(percentage: number | null): boolean {
  return percentage !== null && percentage < PASSING_PERCENT;
}

/** Present-like statuses over every record, as a percentage with one decimal; null without records. */
export function attendanceRate(statuses: string[]): number | null {
  if (statuses.length === 0) return null;
  const present = statuses.filter((s) => PRESENT_LIKE.has(s)).length;
  return Math.round((present / statuses.length) * 1000) / 10;
}

export type RiskFlag = 'failing' | 'missing_work' | 'attendance';

export function riskFlags(input: {
  grade: number | null;
  missing: number;
  attendanceRate: number | null;
}): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (isFailing(input.grade)) flags.push('failing');
  if (input.missing >= MISSING_FLAG) flags.push('missing_work');
  if (input.attendanceRate !== null && input.attendanceRate < ATTENDANCE_FLAG)
    flags.push('attendance');
  return flags;
}

/** Graded cells over expected cells (enrolled students times past-due assignments), as a percentage. */
export function completeness(graded: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((Math.min(graded, expected) / expected) * 1000) / 10;
}

export interface MissingItem {
  gradeLevel: string | null;
  studentId: string;
}

/** Missing items grouped by grade level, kindergarten first, unknown last. */
export function missingByGradeLevel(
  items: MissingItem[],
): Array<{ gradeLevel: string; items: number; students: number }> {
  const groups = new Map<string, { items: number; students: Set<string> }>();
  for (const it of items) {
    const key = it.gradeLevel ?? 'Unknown';
    const g = groups.get(key) ?? { items: 0, students: new Set<string>() };
    g.items += 1;
    g.students.add(it.studentId);
    groups.set(key, g);
  }
  const order = (g: string) =>
    g === 'Unknown'
      ? 1000
      : g === 'K' || g === 'PK'
        ? g === 'PK'
          ? -1
          : 0
        : Number(g) || 500;
  return [...groups.entries()]
    .map(([gradeLevel, g]) => ({
      gradeLevel,
      items: g.items,
      students: g.students.size,
    }))
    .sort((a, b) => order(a.gradeLevel) - order(b.gradeLevel));
}

/**
 * The next time a schedule should run after `from`, in UTC: daily at the hour, weekly on the weekday
 * (0 = Sunday), monthly on the day (clamped to the month's length).
 */
export function nextRunAt(
  schedule: {
    frequency: Frequency;
    dayOfWeek?: number | null;
    dayOfMonth?: number | null;
    hour: number;
  },
  from: Date,
): Date {
  const hour = Math.max(0, Math.min(23, schedule.hour));
  const at = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = from.getUTCDate();
  if (schedule.frequency === 'daily') {
    const today = at(y, m, d);
    return today > from ? today : at(y, m, d + 1);
  }
  if (schedule.frequency === 'weekly') {
    const want = (((schedule.dayOfWeek ?? 1) % 7) + 7) % 7;
    for (let i = 0; i < 8; i += 1) {
      const c = at(y, m, d + i);
      if (c.getUTCDay() === want && c > from) return c;
    }
    return at(y, m, d + 7);
  }
  const day = Math.max(1, Math.min(31, schedule.dayOfMonth ?? 1));
  const clamp = (yy: number, mm: number) =>
    Math.min(day, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate());
  const thisMonth = at(y, m, clamp(y, m));
  if (thisMonth > from) return thisMonth;
  return at(y, m + 1, clamp(y, m + 1));
}

/** RFC 4180 CSV: quotes when a cell holds a comma, quote or newline; CRLF line ends; a BOM for Excel. */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    String.fromCharCode(0xfeff) +
    [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') +
    '\r\n'
  );
}

export interface TranscriptLine {
  yearName: string;
  termName: string;
  periodName: string;
  periodStart: string;
  courseTitle: string;
  className: string;
  teacherName: string | null;
  percentage: number | null;
  letter: string | null;
  gpaPoints: number | null;
}

export interface TranscriptYear {
  yearName: string;
  gpa: number | null;
  lines: TranscriptLine[];
}

/** Lines grouped by school year (oldest first), each year's GPA and the cumulative GPA, all unweighted means of GPA points. */
export function transcriptSummary(lines: TranscriptLine[]): {
  years: TranscriptYear[];
  cumulativeGpa: number | null;
  courses: number;
} {
  const mean = (xs: number[]) =>
    xs.length
      ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100
      : null;
  const byYear = new Map<string, TranscriptLine[]>();
  for (const l of [...lines].sort(
    (a, b) =>
      a.periodStart.localeCompare(b.periodStart) ||
      a.courseTitle.localeCompare(b.courseTitle),
  ))
    byYear.set(l.yearName, [...(byYear.get(l.yearName) ?? []), l]);
  const years = [...byYear.entries()].map(([yearName, ls]) => ({
    yearName,
    gpa: mean(
      ls.map((l) => l.gpaPoints).filter((x): x is number => x !== null),
    ),
    lines: ls,
  }));
  return {
    years,
    cumulativeGpa: mean(
      lines.map((l) => l.gpaPoints).filter((x): x is number => x !== null),
    ),
    courses: lines.length,
  };
}

/** ISO date of the Monday starting the week that holds `d` (UTC). */
export function weekStartOf(d: Date): string {
  const day = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** Counts per week for the last `weeks` weeks ending with the current one, oldest first. */
export function weeklyCounts(
  dates: Date[],
  weeks: number,
  now = new Date(),
): Array<{ weekStart: string; count: number }> {
  const out: Array<{ weekStart: string; count: number }> = [];
  const thisWeek = new Date(`${weekStartOf(now)}T00:00:00Z`);
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(thisWeek.getTime() - i * 7 * 86_400_000);
    out.push({ weekStart: start.toISOString().slice(0, 10), count: 0 });
  }
  const index = new Map(out.map((o, i) => [o.weekStart, i]));
  for (const d of dates) {
    const i = index.get(weekStartOf(d));
    if (i !== undefined) out[i].count += 1;
  }
  return out;
}

export interface AiUsageRow {
  role: string;
  messageCount: number;
  refused: number;
}

/** Conversations and messages per role plus the refusal share, for the AI usage card. */
export function aiUsageSummary(rows: AiUsageRow[]): {
  conversations: number;
  messages: number;
  refusals: number;
  refusalRate: number | null;
  byRole: Array<{ role: string; conversations: number; messages: number }>;
} {
  const byRole = new Map<string, { conversations: number; messages: number }>();
  let messages = 0;
  let refusals = 0;
  for (const r of rows) {
    const g = byRole.get(r.role) ?? { conversations: 0, messages: 0 };
    g.conversations += 1;
    g.messages += r.messageCount;
    byRole.set(r.role, g);
    messages += r.messageCount;
    refusals += r.refused;
  }
  return {
    conversations: rows.length,
    messages,
    refusals,
    refusalRate: messages
      ? Math.round((refusals / messages) * 1000) / 10
      : null,
    byRole: [...byRole.entries()]
      .map(([role, g]) => ({ role, ...g }))
      .sort((a, b) => b.conversations - a.conversations),
  };
}

/** A file name safe for an email attachment: lowercase, dashes, a date suffix. */
export function reportFileName(
  kind: string,
  date: Date,
  suffix?: string | null,
): string {
  const base = `${kind}${suffix ? `-${suffix}` : ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${date.toISOString().slice(0, 10)}.csv`;
}
