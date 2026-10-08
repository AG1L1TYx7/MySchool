/**
 * Learning paths and the integrated learning profile (slice 23, docs/02 sections 22 and 29): a learning
 * health score with its parts in the open, mastery gaps, ranked next steps, and how a path is built,
 * advanced and finished. Pure functions; the service reads and writes.
 */

export const STEP_KINDS = [
  'lesson',
  'h5p',
  'library',
  'practice',
  'assignment',
  'tutor',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'skipped',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const PATH_STATUSES = ['active', 'completed', 'archived'] as const;

/** A standard is a gap below this level; the path works on the weakest first. */
export const GAP_LEVEL = 0.6;
export const MAX_GAPS = 4;
export const MAX_STEPS = 12;

// ---------------------------------------------------------------------------
// Learning health
// ---------------------------------------------------------------------------

export interface HealthInput {
  /** Mean mastery level across standards with evidence, 0..1, or null without evidence. */
  mastery: number | null;
  /** Attendance rate over the last 90 days, 0..100, or null. */
  attendanceRate: number | null;
  /** Past-due published work with nothing handed in. */
  missing: number;
  /** Practice cards due today and not yet reviewed. */
  practiceDue: number;
  /** Practice cards reviewed in the last 30 days. */
  practiceReviews30: number;
  /** Lessons completed in the last 8 weeks. */
  lessonsCompleted8w: number;
  /** Classes the student is failing (current grade below 60). */
  failingClasses: number;
}

export interface HealthPart {
  key: 'mastery' | 'attendance' | 'work' | 'practice' | 'engagement';
  label: string;
  /** 0..100 */
  score: number;
  weight: number;
  note: string;
}

export interface Health {
  score: number;
  band: 'thriving' | 'steady' | 'watch' | 'support';
  parts: HealthPart[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * Five parts, weighted, every number explained. Missing evidence scores the part at a neutral 60 and says so,
 * so a student with no data is "steady", never "thriving" or "support" by accident.
 */
export function learningHealth(i: HealthInput): Health {
  const parts: HealthPart[] = [];
  parts.push(
    i.mastery === null
      ? {
          key: 'mastery',
          label: 'Mastery',
          score: 60,
          weight: 0.35,
          note: 'No standards with evidence yet.',
        }
      : {
          key: 'mastery',
          label: 'Mastery',
          score: clamp(Math.round(i.mastery * 100)),
          weight: 0.35,
          note: `Average level ${Math.round(i.mastery * 100)}% across standards with evidence.`,
        },
  );
  parts.push(
    i.attendanceRate === null
      ? {
          key: 'attendance',
          label: 'Attendance',
          score: 60,
          weight: 0.2,
          note: 'No attendance taken yet.',
        }
      : {
          key: 'attendance',
          label: 'Attendance',
          score: clamp(Math.round(i.attendanceRate)),
          weight: 0.2,
          note: `${Math.round(i.attendanceRate)}% present over 90 days.`,
        },
  );
  const workScore = clamp(100 - i.missing * 15 - i.failingClasses * 20);
  parts.push({
    key: 'work',
    label: 'Work',
    score: workScore,
    weight: 0.25,
    note:
      i.missing === 0 && i.failingClasses === 0
        ? 'Nothing missing and no class below 60.'
        : `${i.missing} missing item${i.missing === 1 ? '' : 's'}, ${i.failingClasses} class${i.failingClasses === 1 ? '' : 'es'} below 60.`,
  });
  const practiceScore =
    i.practiceReviews30 === 0 && i.practiceDue === 0
      ? 60
      : clamp(
          Math.round(
            Math.min(100, i.practiceReviews30 * 4) -
              Math.min(40, i.practiceDue * 4),
          ),
        );
  parts.push({
    key: 'practice',
    label: 'Practice',
    score: practiceScore,
    weight: 0.1,
    note:
      i.practiceReviews30 === 0 && i.practiceDue === 0
        ? 'No practice cards yet.'
        : `${i.practiceReviews30} reviews in 30 days, ${i.practiceDue} due now.`,
  });
  const engagementScore = clamp(40 + i.lessonsCompleted8w * 10);
  parts.push({
    key: 'engagement',
    label: 'Engagement',
    score: engagementScore,
    weight: 0.1,
    note: `${i.lessonsCompleted8w} lesson${i.lessonsCompleted8w === 1 ? '' : 's'} completed in 8 weeks.`,
  });
  const score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0));
  return {
    score,
    band:
      score >= 80
        ? 'thriving'
        : score >= 65
          ? 'steady'
          : score >= 50
            ? 'watch'
            : 'support',
    parts,
  };
}

// ---------------------------------------------------------------------------
// Gaps and recommendations
// ---------------------------------------------------------------------------

export interface MasteryRow {
  standardId: string;
  code: string;
  description: string;
  level: number;
  trend: string;
  evidenceCount: number;
}

/** The weakest standards with real evidence, lowest first, at most MAX_GAPS. */
export function masteryGaps(rows: MasteryRow[], max = MAX_GAPS): MasteryRow[] {
  return rows
    .filter((r) => r.evidenceCount > 0 && r.level < GAP_LEVEL)
    .sort((a, b) => a.level - b.level || b.evidenceCount - a.evidenceCount)
    .slice(0, max);
}

export interface Recommendation {
  kind: StepKind;
  refId: string | null;
  title: string;
  reason: string;
  /** Higher first. */
  priority: number;
  href: string | null;
  standardCode?: string | null;
}

export interface RecommendationInput {
  gaps: MasteryRow[];
  /** Content that teaches a standard, by standard id. */
  contentFor: (standardId: string) => Array<{
    kind: 'lesson' | 'h5p' | 'library';
    id: string;
    title: string;
    href: string;
  }>;
  missing: Array<{ assignmentId: string; title: string; href: string }>;
  practiceDue: number;
  nextLessons: Array<{
    lessonId: string;
    title: string;
    courseTitle: string;
    href: string;
  }>;
  tutorAllowed: boolean;
}

/** Next best actions for a student, ranked: missing work, then the weakest gaps, practice, the next lesson, the tutor. */
export function recommend(
  input: RecommendationInput,
  limit = 8,
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const m of input.missing.slice(0, 3))
    out.push({
      kind: 'assignment',
      refId: m.assignmentId,
      title: m.title,
      reason: 'This is past due and nothing has been handed in.',
      priority: 100,
      href: m.href,
    });
  input.gaps.forEach((g, gi) => {
    const content = input.contentFor(g.standardId);
    const pick = content[0];
    if (pick)
      out.push({
        kind: pick.kind,
        refId: pick.id,
        title: pick.title,
        reason: `Works on ${g.code} (${g.description.slice(0, 80)}${g.description.length > 80 ? '…' : ''}), where mastery is ${Math.round(g.level * 100)}%.`,
        priority: 90 - gi * 5,
        href: pick.href,
        standardCode: g.code,
      });
    else if (input.tutorAllowed)
      out.push({
        kind: 'tutor',
        refId: null,
        title: `Ask the tutor about ${g.code}`,
        reason: `Mastery of ${g.code} is ${Math.round(g.level * 100)}% and there is no matching content yet.`,
        priority: 70 - gi * 5,
        href: `/tutor?topic=${encodeURIComponent(g.description.slice(0, 60))}`,
        standardCode: g.code,
      });
  });
  if (input.practiceDue > 0)
    out.push({
      kind: 'practice',
      refId: null,
      title: `Review ${input.practiceDue} practice card${input.practiceDue === 1 ? '' : 's'}`,
      reason: 'Cards due today keep what you learned from fading.',
      priority: 60,
      href: '/practice',
    });
  for (const l of input.nextLessons.slice(0, 2))
    out.push({
      kind: 'lesson',
      refId: l.lessonId,
      title: l.title,
      reason: `The next lesson in ${l.courseTitle}.`,
      priority: 50,
      href: l.href,
    });
  return out.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface StepDraft {
  kind: StepKind;
  refId: string | null;
  title: string;
  reason: string | null;
  standardCode: string | null;
}

/** A generated path: for each gap, up to two pieces of content then a practice step; at most MAX_STEPS. */
export function buildPathSteps(
  gaps: MasteryRow[],
  contentFor: RecommendationInput['contentFor'],
): StepDraft[] {
  const steps: StepDraft[] = [];
  const seen = new Set<string>();
  for (const g of gaps) {
    const content = contentFor(g.standardId)
      .filter((c) => !seen.has(`${c.kind}:${c.id}`))
      .slice(0, 2);
    for (const c of content) {
      seen.add(`${c.kind}:${c.id}`);
      steps.push({
        kind: c.kind,
        refId: c.id,
        title: c.title,
        reason: `Builds ${g.code}: ${g.description.slice(0, 120)}`,
        standardCode: g.code,
      });
    }
    if (content.length)
      steps.push({
        kind: 'practice',
        refId: null,
        title: `Practice ${g.code}`,
        reason: 'Review the cards for this standard until they stick.',
        standardCode: g.code,
      });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps.slice(0, MAX_STEPS);
}

export function pathTitle(gaps: MasteryRow[], subject: string | null): string {
  if (gaps.length === 0) return 'Keep going';
  const codes = gaps
    .slice(0, 2)
    .map((g) => g.code)
    .join(' and ');
  return subject ? `${subject}: strengthen ${codes}` : `Strengthen ${codes}`;
}

export interface StepLike {
  status: string;
}

/** Done and skipped both count as finished; the path completes when nothing is left. */
export function pathProgress(steps: StepLike[]): {
  total: number;
  done: number;
  percent: number;
  complete: boolean;
} {
  const total = steps.length;
  const done = steps.filter(
    (s) => s.status === 'done' || s.status === 'skipped',
  ).length;
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    complete: total > 0 && done === total,
  };
}

export interface StepEvent {
  kind: 'lesson' | 'h5p' | 'assignment' | 'practice';
  refId: string | null;
  /** Score as a fraction when the event carries one. */
  fraction?: number | null;
}

/**
 * Which pending steps an event finishes: a lesson completion finishes a lesson step with that id, a passing
 * interactive result finishes an h5p step, a submission or grade finishes an assignment step, and a practice
 * review session finishes the first pending practice step.
 */
export function stepsFinishedBy(
  event: StepEvent,
  steps: Array<{
    id: string;
    kind: string;
    refId: string | null;
    status: string;
    sortOrder: number;
  }>,
  passMark = 0.6,
): string[] {
  const pending = steps
    .filter((s) => s.status === 'pending' || s.status === 'in_progress')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (event.kind === 'practice') {
    const first = pending.find((s) => s.kind === 'practice');
    return first ? [first.id] : [];
  }
  if (event.kind === 'h5p' && (event.fraction ?? 0) < passMark) return [];
  return pending
    .filter((s) => s.kind === event.kind && s.refId === event.refId)
    .map((s) => s.id);
}

export const stepHref = (
  kind: string,
  refId: string | null,
  classId?: string | null,
): string | null => {
  switch (kind) {
    case 'lesson':
      return refId ? `/courses/lessons/${refId}` : null;
    case 'h5p':
      return refId ? `/content/${refId}` : null;
    case 'library':
      return refId ? `/library/${refId}` : null;
    case 'assignment':
      return refId ? `/assignments/${refId}` : null;
    case 'practice':
      return '/practice';
    case 'tutor':
      return '/tutor';
    default:
      return classId ? `/classes/${classId}` : null;
  }
};
