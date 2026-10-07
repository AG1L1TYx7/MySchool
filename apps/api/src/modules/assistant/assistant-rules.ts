/**
 * Pure rules of the teacher assistant (docs/13 section 8): how a rubric becomes the grader's RUBRIC block, how a
 * suggestion is scaled and summarised, how an email draft becomes message text, how the week's numbers become the
 * DATA block the insight prompt may narrate, and when a substitute's co-teacher row may be removed.
 */

export interface RubricCriterionDef {
  id: string;
  title: string;
  description?: string;
  maxPoints: number;
}

/** One line per criterion, `id | max | title: description`; no rubric means one overall criterion. */
export function rubricBlock(
  criteria: RubricCriterionDef[],
  assignmentMaxPoints: number,
): string {
  if (criteria.length === 0)
    return `overall | ${assignmentMaxPoints} | Overall quality: completeness, accuracy and clarity`;
  return criteria
    .map(
      (c) =>
        `${c.id} | ${c.maxPoints} | ${c.title}${c.description ? `: ${c.description}` : ''}`,
    )
    .join('\n');
}

/** A rubric total rescaled to the assignment's points, to two decimals; nothing when the rubric has no points. */
export function scaledScore(
  score: number,
  rubricMax: number,
  assignmentMax: number,
): number {
  if (!rubricMax) return 0;
  return Math.round((score / rubricMax) * assignmentMax * 100) / 100;
}

export interface CriterionSuggestion {
  criterionId: string;
  score: number;
  maxPoints: number;
  evidence?: string;
  feedback?: string;
  confidence: number;
}

/** The suggestion's lowest confidence; human review whenever the model says so or any criterion is under 0.6. */
export function summariseSuggestion(draft: {
  criteria?: CriterionSuggestion[];
  overall?: { score?: number; maxPoints?: number };
  needsHumanReview?: boolean;
  flag?: string | null;
}): {
  score: number;
  maxPoints: number;
  confidence: number;
  needsHumanReview: boolean;
  flag: string | null;
} {
  const criteria = draft.criteria ?? [];
  const confidence = criteria.length
    ? Math.min(...criteria.map((c) => Number(c.confidence ?? 0)))
    : 0;
  return {
    score: Number(draft.overall?.score ?? 0),
    maxPoints: Number(draft.overall?.maxPoints ?? 0),
    confidence: Math.round(confidence * 100) / 100,
    needsHumanReview:
      draft.needsHumanReview !== false || confidence < 0.6 || !!draft.flag,
    flag: typeof draft.flag === 'string' && draft.flag ? draft.flag : null,
  };
}

/** The feedback a student sees when a suggestion is approved unchanged: the summary, then each criterion's note. */
export function feedbackFromSuggestion(draft: {
  criteria?: Array<{ feedback?: string }>;
  summary?: string;
}): string {
  return [
    draft.summary ?? '',
    ...(draft.criteria ?? []).map((c) => c.feedback ?? ''),
  ]
    .map((x) => x.trim())
    .filter(Boolean)
    .join('\n');
}

export interface EmailDraft {
  subject?: string;
  greeting?: string;
  body?: string[];
  closing?: string;
  signature?: string;
}

/** Plain text for the message to the family: subject, greeting, paragraphs, closing, signature; no triple blank lines. */
export function composeEmail(
  draft: EmailDraft,
  fallbackSubject: string,
): string {
  return [
    draft.subject?.trim() || fallbackSubject,
    '',
    draft.greeting ?? '',
    '',
    ...(draft.body ?? []).flatMap((p) => [p, '']),
    draft.closing ?? '',
    draft.signature ?? '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface InsightData {
  students: number;
  tutor: {
    studentsWhoUsedIt: number;
    conversationsThisWeek: number;
    conversationsLastWeek: number;
    refusals: number;
    topTopics: Array<{ topic: string; conversations: number }>;
  };
  work: {
    assignmentsDueLast14Days: number;
    missingItems: number;
    submissionsThisWeek: number;
    averageScoreRecent: number | null;
    lowScoringAssignments: Array<{ title: string; average: number | null }>;
  };
  attendance: { recordsThisWeek: number; presentRate: number | null };
  classAverage: number | null;
  lessonsCompletedThisWeek: number;
}

/** The DATA block: every number the narration may use, one fact per line, and nothing else. */
export function insightDataLines(d: InsightData): string[] {
  return [
    `students enrolled: ${d.students}`,
    `tutor: ${d.tutor.studentsWhoUsedIt} students used the tutor this week; ${d.tutor.conversationsThisWeek} conversations (last week ${d.tutor.conversationsLastWeek}); ${d.tutor.refusals} refused messages`,
    ...d.tutor.topTopics.map(
      (t) => `tutor topic: ${t.topic} (${t.conversations} conversations)`,
    ),
    `missing work: ${d.work.missingItems} items across ${d.work.assignmentsDueLast14Days} assignments due in the last 14 days`,
    `submissions this week: ${d.work.submissionsThisWeek}`,
    `average score on recent assignments: ${d.work.averageScoreRecent === null ? 'none graded' : `${d.work.averageScoreRecent}%`}`,
    ...d.work.lowScoringAssignments.map(
      (a) => `low-scoring assignment: ${a.title} average ${a.average}%`,
    ),
    `attendance this week: ${d.attendance.presentRate === null ? 'no records' : `${d.attendance.presentRate}% present over ${d.attendance.recordsThisWeek} records`}`,
    `class average grade: ${d.classAverage === null ? 'not available' : `${d.classAverage}%`}`,
    `lessons finished this week: ${d.lessonsCompletedThisWeek}`,
  ];
}

/** Topics the class asked the tutor about most, by conversation count, at most three. */
export function topTopics(
  conversations: Array<{ topic: string }>,
): Array<{ topic: string; conversations: number }> {
  const counts = new Map<string, number>();
  for (const c of conversations)
    counts.set(c.topic, (counts.get(c.topic) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([topic, n]) => ({ topic, conversations: n }));
}

/**
 * A substitute's co-teacher row goes only when no access is still active, the row is not the primary teacher,
 * and the row was assigned after the first substitute grant for the class (a real co-teacher assigned earlier stays).
 */
/** How far before the first recorded grant a teacher row may have been written by that same grant. */
export const GRANT_SLACK_MS = 60_000;

export function shouldRevokeTeacherRow(input: {
  stillActiveAccess: number;
  row: { isPrimary: boolean; assignedAt: Date } | null;
  earliestGrantAt: Date | null;
}): boolean {
  if (input.stillActiveAccess > 0 || !input.row || input.row.isPrimary)
    return false;
  // The grant creates the access row and the teacher row in the same request, so a row assigned within
  // a minute before the earliest grant still belongs to a substitute, never to a real co-teacher.
  if (
    input.earliestGrantAt &&
    input.row.assignedAt.getTime() <
      input.earliestGrantAt.getTime() - GRANT_SLACK_MS
  )
    return false;
  return true;
}

/** Substitute access must end after it starts and not already be over. */
export function validSubstituteWindow(
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
): boolean {
  return (
    endsAt.getTime() > startsAt.getTime() && endsAt.getTime() >= now.getTime()
  );
}
