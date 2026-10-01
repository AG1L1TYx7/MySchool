/**
 * Pure grading rules (docs/02 sections 7 and 8): percentages, letters, lateness, penalties and
 * the gradebook matrix. No database access, so every branch is unit-tested.
 */

export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function percentageOf(score: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  return round2((score / maxPoints) * 100);
}

export function letterGrade(percentage: number): Letter {
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
}

export function isLate(submittedAt: Date, dueAt: Date | null): boolean {
  return dueAt !== null && submittedAt.getTime() > dueAt.getTime();
}

/** Whether an online submission is accepted now, and why not when it is refused. */
export function submissionWindow(input: {
  now: Date;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  availableFrom: Date | null;
  dueAt: Date | null;
  allowLateUntil: Date | null;
}): { accepted: boolean; late: boolean; reason?: string } {
  if (input.status !== 'PUBLISHED')
    return {
      accepted: false,
      late: false,
      reason:
        input.status === 'CLOSED'
          ? 'This assignment is closed.'
          : 'This assignment is not published.',
    };
  if (input.availableFrom && input.now < input.availableFrom)
    return {
      accepted: false,
      late: false,
      reason: 'This assignment is not open yet.',
    };
  const late = isLate(input.now, input.dueAt);
  if (late && input.allowLateUntil && input.now > input.allowLateUntil)
    return {
      accepted: false,
      late,
      reason: 'The late submission window has closed.',
    };
  return { accepted: true, late };
}

/** Deducts a flat percentage of the maximum points from a late submission, never below zero. */
export function applyLatePenalty(
  score: number,
  maxPoints: number,
  late: boolean,
  penaltyPercent: number | null,
): { score: number; penaltyApplied: number | null } {
  if (!late || !penaltyPercent || penaltyPercent <= 0)
    return { score, penaltyApplied: null };
  const deduction = (maxPoints * Math.min(penaltyPercent, 100)) / 100;
  return {
    score: round2(Math.max(0, score - deduction)),
    penaltyApplied: penaltyPercent,
  };
}

export interface GradebookStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
}
export interface GradebookAssignment {
  id: string;
  title: string;
  category: string | null;
  maxPoints: number;
  weight: number;
  dueAt: Date | null;
  status: string;
}
export interface GradebookGrade {
  assignmentId: string;
  studentId: string;
  score: number;
  maxPoints: number;
}
export interface GradebookRow {
  student: GradebookStudent;
  cells: Record<string, { score: number; percentage: number } | null>;
  weightedScore: number;
  weightedMax: number;
  percentage: number | null;
  letter: Letter | null;
}
export interface Gradebook {
  assignments: GradebookAssignment[];
  rows: GradebookRow[];
  classAverage: number | null;
  perAssignmentAverage: Record<string, number | null>;
}

/**
 * Points-based gradebook with per-assignment weights. Only graded cells count, so a missing
 * grade neither helps nor hurts until it is entered (teachers enter 0 for missing work).
 */
export function buildGradebook(
  students: GradebookStudent[],
  assignments: GradebookAssignment[],
  grades: GradebookGrade[],
): Gradebook {
  const byKey = new Map(
    grades.map((g) => [`${g.assignmentId}:${g.studentId}`, g]),
  );
  const weights = new Map(
    assignments.map((a) => [a.id, a.weight > 0 ? a.weight : 1]),
  );
  const rows: GradebookRow[] = students.map((student) => {
    const cells: GradebookRow['cells'] = {};
    let weightedScore = 0;
    let weightedMax = 0;
    for (const a of assignments) {
      const g = byKey.get(`${a.id}:${student.id}`);
      if (!g) {
        cells[a.id] = null;
        continue;
      }
      cells[a.id] = {
        score: g.score,
        percentage: percentageOf(g.score, g.maxPoints),
      };
      const w = weights.get(a.id) ?? 1;
      weightedScore += g.score * w;
      weightedMax += g.maxPoints * w;
    }
    const percentage =
      weightedMax > 0 ? percentageOf(weightedScore, weightedMax) : null;
    return {
      student,
      cells,
      weightedScore: round2(weightedScore),
      weightedMax: round2(weightedMax),
      percentage,
      letter: percentage === null ? null : letterGrade(percentage),
    };
  });
  const graded = rows.filter((r) => r.percentage !== null);
  const classAverage = graded.length
    ? round2(
        graded.reduce((s, r) => s + (r.percentage ?? 0), 0) / graded.length,
      )
    : null;
  const perAssignmentAverage: Record<string, number | null> = {};
  for (const a of assignments) {
    const cells = rows
      .map((r) => r.cells[a.id])
      .filter((c): c is { score: number; percentage: number } => c !== null);
    perAssignmentAverage[a.id] = cells.length
      ? round2(cells.reduce((s, c) => s + c.percentage, 0) / cells.length)
      : null;
  }
  return { assignments, rows, classAverage, perAssignmentAverage };
}
