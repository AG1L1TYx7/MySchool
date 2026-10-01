export type AttendanceStatusApi =
  'present' | 'absent' | 'late' | 'excused' | 'tardy' | 'left_early';
export const ATTENDANCE_STATUSES: readonly AttendanceStatusApi[] = [
  'present',
  'absent',
  'late',
  'excused',
  'tardy',
  'left_early',
];

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  tardy: number;
  leftEarly: number;
  total: number;
  /** Share of recorded days the student was in class at some point (present, late, tardy, left early). */
  attendanceRate: number | null;
}

export function emptyCounts(): AttendanceCounts {
  return {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    tardy: 0,
    leftEarly: 0,
    total: 0,
    attendanceRate: null,
  };
}

const KEY: Record<
  AttendanceStatusApi,
  keyof Omit<AttendanceCounts, 'total' | 'attendanceRate'>
> = {
  present: 'present',
  absent: 'absent',
  late: 'late',
  excused: 'excused',
  tardy: 'tardy',
  left_early: 'leftEarly',
};

export function addRecord(
  counts: AttendanceCounts,
  status: AttendanceStatusApi,
): AttendanceCounts {
  const next = { ...counts };
  next[KEY[status]] += 1;
  next.total += 1;
  const attended = next.present + next.late + next.tardy + next.leftEarly;
  next.attendanceRate = Math.round((attended / next.total) * 10000) / 100;
  return next;
}

/** Counts per student; excused absences count toward total but not toward attendance. */
export function summarize<
  T extends { studentId: string; status: AttendanceStatusApi },
>(records: T[]): Map<string, AttendanceCounts> {
  const out = new Map<string, AttendanceCounts>();
  for (const r of records)
    out.set(
      r.studentId,
      addRecord(out.get(r.studentId) ?? emptyCounts(), r.status),
    );
  return out;
}

/** YYYY-MM-DD in UTC; attendance is a calendar date, not an instant. */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
