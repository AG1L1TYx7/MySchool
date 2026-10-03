/**
 * Pure gradebook rules for docs/13 section 4: weighted categories with drop-lowest and extra credit,
 * Google Classroom style marks, organisation letter and GPA scales, standards-based summaries and
 * the 1EdTech CASE import. No database access; everything here is unit-tested.
 */

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export interface LetterCutoff {
  letter: string;
  min: number;
}
export interface GpaPoints {
  letter: string;
  points: number;
}
export interface ProficiencyLevel {
  level: number;
  label: string;
  /** Lowest percentage that maps to this level when a points grade is translated. */
  minPercent: number;
}

export const DEFAULT_GRADING_SCALE: LetterCutoff[] = [
  { letter: 'A', min: 90 },
  { letter: 'B', min: 80 },
  { letter: 'C', min: 70 },
  { letter: 'D', min: 60 },
  { letter: 'F', min: 0 },
];
export const DEFAULT_GPA_SCALE: GpaPoints[] = [
  { letter: 'A', points: 4 },
  { letter: 'B', points: 3 },
  { letter: 'C', points: 2 },
  { letter: 'D', points: 1 },
  { letter: 'F', points: 0 },
];
export const DEFAULT_PROFICIENCY_LEVELS: ProficiencyLevel[] = [
  { level: 1, label: 'Beginning', minPercent: 0 },
  { level: 2, label: 'Developing', minPercent: 60 },
  { level: 3, label: 'Proficient', minPercent: 80 },
  { level: 4, label: 'Advanced', minPercent: 95 },
];

/** Parses a JSON scale stored on the organisation; falls back to the default on anything odd. */
export function parseGradingScale(
  json: string | null | undefined,
): LetterCutoff[] {
  const parsed = safeJson<LetterCutoff[]>(json);
  if (!Array.isArray(parsed) || parsed.length === 0)
    return DEFAULT_GRADING_SCALE;
  const ok = parsed.filter(
    (c) => c && typeof c.letter === 'string' && typeof c.min === 'number',
  );
  return ok.length
    ? [...ok].sort((a, b) => b.min - a.min)
    : DEFAULT_GRADING_SCALE;
}
export function parseGpaScale(json: string | null | undefined): GpaPoints[] {
  const parsed = safeJson<GpaPoints[]>(json);
  if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_GPA_SCALE;
  const ok = parsed.filter(
    (c) => c && typeof c.letter === 'string' && typeof c.points === 'number',
  );
  return ok.length ? ok : DEFAULT_GPA_SCALE;
}
export function parseLevels(
  json: string | null | undefined,
): ProficiencyLevel[] {
  const parsed = safeJson<ProficiencyLevel[]>(json);
  if (!Array.isArray(parsed) || parsed.length === 0)
    return DEFAULT_PROFICIENCY_LEVELS;
  const ok = parsed.filter(
    (l) => l && typeof l.level === 'number' && typeof l.label === 'string',
  );
  return ok.length
    ? [...ok].sort((a, b) => a.level - b.level)
    : DEFAULT_PROFICIENCY_LEVELS;
}

/** A scale is valid when letters are unique, cutoffs descend and the lowest is 0. */
export function validateGradingScale(scale: LetterCutoff[]): string | null {
  if (scale.length < 2) return 'A grading scale needs at least two letters.';
  const letters = new Set(scale.map((s) => s.letter.trim().toUpperCase()));
  if (letters.size !== scale.length) return 'Each letter may appear once.';
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  if (sorted[sorted.length - 1].min !== 0)
    return 'The lowest letter must start at 0.';
  if (sorted.some((s) => s.min < 0 || s.min > 100))
    return 'Cutoffs are percentages between 0 and 100.';
  return null;
}

export function letterFor(
  percentage: number,
  scale: LetterCutoff[] = DEFAULT_GRADING_SCALE,
): string {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  return (sorted.find((c) => percentage >= c.min) ?? sorted[sorted.length - 1])
    .letter;
}
export function gpaPointsFor(
  letter: string | null,
  scale: GpaPoints[] = DEFAULT_GPA_SCALE,
): number | null {
  if (!letter) return null;
  const hit = scale.find(
    (g) => g.letter.toUpperCase() === letter.toUpperCase(),
  );
  return hit ? hit.points : null;
}
export function levelFor(
  percentage: number,
  levels: ProficiencyLevel[] = DEFAULT_PROFICIENCY_LEVELS,
): ProficiencyLevel {
  const sorted = [...levels].sort((a, b) => b.minPercent - a.minPercent);
  return (
    sorted.find((l) => percentage >= l.minPercent) ?? sorted[sorted.length - 1]
  );
}

// ---------------------------------------------------------------------------
// Marks (Google Classroom vocabulary)
// ---------------------------------------------------------------------------

export type Mark =
  | 'assigned'
  | 'missing'
  | 'turned_in'
  | 'returned'
  | 'excused'
  | 'late'
  | 'incomplete';
export const MARKS: readonly Mark[] = [
  'assigned',
  'missing',
  'turned_in',
  'returned',
  'excused',
  'late',
  'incomplete',
];
export const TEACHER_MARKS = ['missing', 'excused', 'incomplete'] as const;

/**
 * The mark a student sees for an assignment. A teacher-set mark wins; otherwise it follows the work:
 * graded work is Returned, a late submission is Late, any submission is Turned in, no submission after the
 * due date is Missing, and before that it is simply Assigned.
 */
export function deriveMark(input: {
  override: 'MISSING' | 'EXCUSED' | 'INCOMPLETE' | null | undefined;
  hasGrade: boolean;
  submitted: boolean;
  late: boolean;
  dueAt: Date | null;
  now?: Date;
}): Mark {
  if (input.override) return input.override.toLowerCase() as Mark;
  if (input.hasGrade) return 'returned';
  if (input.submitted) return input.late ? 'late' : 'turned_in';
  const now = input.now ?? new Date();
  if (input.dueAt && now.getTime() > input.dueAt.getTime()) return 'missing';
  return 'assigned';
}

// ---------------------------------------------------------------------------
// Weighted gradebook
// ---------------------------------------------------------------------------

export interface BookStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
}
export interface BookCategory {
  id: string;
  name: string;
  weight: number;
  dropLowest: number;
  sortOrder: number;
}
export interface BookAssignment {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  maxPoints: number;
  weight: number;
  isExtraCredit: boolean;
  dueAt: Date | null;
  status: string;
}
export interface BookGrade {
  assignmentId: string;
  studentId: string;
  score: number;
  maxPoints: number;
}
export interface BookMark {
  assignmentId: string;
  studentId: string;
  mark: 'MISSING' | 'EXCUSED' | 'INCOMPLETE';
}
export interface BookCell {
  score: number | null;
  maxPoints: number;
  percentage: number | null;
  mark: 'graded' | 'missing' | 'excused' | 'incomplete' | 'none';
  dropped: boolean;
  extraCredit: boolean;
}
export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  weight: number;
  earned: number;
  possible: number;
  percentage: number | null;
  dropped: string[];
}
export interface BookRow {
  student: BookStudent;
  cells: Record<string, BookCell>;
  categories: CategoryTotal[];
  percentage: number | null;
  letter: string | null;
  missing: number;
}
export interface WeightedGradebook {
  mode: 'categories' | 'points';
  categories: BookCategory[];
  assignments: BookAssignment[];
  rows: BookRow[];
  classAverage: number | null;
  perAssignmentAverage: Record<string, number | null>;
}

/**
 * Builds the matrix. With categories the final grade is the weighted mean of category percentages
 * (weights renormalised over categories that have graded work); without categories it is total points
 * with per-assignment weights, as before. Missing marks count as zero, Excused cells are left out,
 * extra credit adds to the score but never to the possible points, and each category drops its N lowest
 * percentages before totalling.
 */
export function buildWeightedGradebook(input: {
  students: BookStudent[];
  categories: BookCategory[];
  assignments: BookAssignment[];
  grades: BookGrade[];
  marks: BookMark[];
  scale?: LetterCutoff[];
}): WeightedGradebook {
  const scale = input.scale ?? DEFAULT_GRADING_SCALE;
  const useCategories = input.categories.length > 0;
  const gradeByKey = new Map(
    input.grades.map((g) => [`${g.assignmentId}:${g.studentId}`, g]),
  );
  const markByKey = new Map(
    input.marks.map((m) => [`${m.assignmentId}:${m.studentId}`, m.mark]),
  );
  const categories = [...input.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const uncategorised: BookCategory = {
    id: '',
    name: 'Other',
    weight: 0,
    dropLowest: 0,
    sortOrder: 999,
  };

  const rows: BookRow[] = input.students.map((student) => {
    const cells: Record<string, BookCell> = {};
    let missing = 0;
    for (const a of input.assignments) {
      const g = gradeByKey.get(`${a.id}:${student.id}`);
      const mark = markByKey.get(`${a.id}:${student.id}`);
      if (mark === 'EXCUSED') {
        cells[a.id] = {
          score: null,
          maxPoints: a.maxPoints,
          percentage: null,
          mark: 'excused',
          dropped: false,
          extraCredit: a.isExtraCredit,
        };
        continue;
      }
      if (g) {
        cells[a.id] = {
          score: g.score,
          maxPoints: g.maxPoints,
          percentage:
            g.maxPoints > 0 ? round2((g.score / g.maxPoints) * 100) : null,
          mark: 'graded',
          dropped: false,
          extraCredit: a.isExtraCredit,
        };
        continue;
      }
      if (mark === 'MISSING' || mark === 'INCOMPLETE') {
        missing += 1;
        cells[a.id] = {
          score: 0,
          maxPoints: a.maxPoints,
          percentage: 0,
          mark: mark.toLowerCase() as 'missing' | 'incomplete',
          dropped: false,
          extraCredit: a.isExtraCredit,
        };
        continue;
      }
      cells[a.id] = {
        score: null,
        maxPoints: a.maxPoints,
        percentage: null,
        mark: 'none',
        dropped: false,
        extraCredit: a.isExtraCredit,
      };
    }

    const buckets = useCategories
      ? [...categories, uncategorised]
      : [uncategorised];
    const totals: CategoryTotal[] = [];
    for (const c of buckets) {
      const inBucket = input.assignments.filter((a) =>
        useCategories ? (a.categoryId ?? '') === c.id : true,
      );
      const counted = inBucket.filter((a) => cells[a.id].score !== null);
      // Drop the lowest N percentages among regular (non extra credit) counted work.
      const droppable = counted
        .filter((a) => !a.isExtraCredit && cells[a.id].percentage !== null)
        .sort(
          (x, y) =>
            (cells[x.id].percentage ?? 0) - (cells[y.id].percentage ?? 0),
        );
      const dropped = droppable
        .slice(0, Math.min(c.dropLowest, Math.max(0, droppable.length - 1)))
        .map((a) => a.id);
      for (const id of dropped) cells[id].dropped = true;
      let earned = 0;
      let possible = 0;
      for (const a of counted) {
        if (dropped.includes(a.id)) continue;
        const cell = cells[a.id];
        const w = useCategories ? 1 : a.weight > 0 ? a.weight : 1;
        earned += (cell.score ?? 0) * w;
        if (!a.isExtraCredit) possible += cell.maxPoints * w;
      }
      if (inBucket.length === 0 && c.id === '') continue;
      totals.push({
        categoryId: c.id || null,
        name: c.name,
        weight: c.weight,
        earned: round2(earned),
        possible: round2(possible),
        percentage: possible > 0 ? round2((earned / possible) * 100) : null,
        dropped,
      });
    }

    let percentage: number | null;
    if (useCategories) {
      const graded = totals.filter(
        (t) => t.percentage !== null && t.weight > 0,
      );
      const weightSum = graded.reduce((s, t) => s + t.weight, 0);
      percentage =
        weightSum > 0
          ? round2(
              graded.reduce((s, t) => s + (t.percentage ?? 0) * t.weight, 0) /
                weightSum,
            )
          : null;
      // Extra credit in an unweighted "Other" bucket still helps: add its earned points as a bonus percentage of the class.
      const other = totals.find((t) => t.categoryId === null);
      if (
        percentage !== null &&
        other &&
        other.possible === 0 &&
        other.earned > 0
      )
        percentage = round2(Math.min(100, percentage + other.earned));
    } else {
      const t = totals[0];
      percentage =
        t && t.possible > 0
          ? round2(Math.min(100, (t.earned / t.possible) * 100))
          : null;
    }
    return {
      student,
      cells,
      categories: totals,
      percentage,
      letter: percentage === null ? null : letterFor(percentage, scale),
      missing,
    };
  });

  const graded = rows.filter((r) => r.percentage !== null);
  const classAverage = graded.length
    ? round2(
        graded.reduce((s, r) => s + (r.percentage ?? 0), 0) / graded.length,
      )
    : null;
  const perAssignmentAverage: Record<string, number | null> = {};
  for (const a of input.assignments) {
    const ps = rows
      .map((r) => r.cells[a.id].percentage)
      .filter((p): p is number => p !== null);
    perAssignmentAverage[a.id] = ps.length
      ? round2(ps.reduce((s, p) => s + p, 0) / ps.length)
      : null;
  }
  return {
    mode: useCategories ? 'categories' : 'points',
    categories,
    assignments: input.assignments,
    rows,
    classAverage,
    perAssignmentAverage,
  };
}

/** Category weights should add up to 100; anything else is reported, not refused, so teachers can work in steps. */
export function weightWarning(
  categories: Array<{ weight: number }>,
): string | null {
  if (categories.length === 0) return null;
  const sum = round2(categories.reduce((s, c) => s + c.weight, 0));
  return sum === 100 ? null : `Category weights add up to ${sum}, not 100.`;
}

// ---------------------------------------------------------------------------
// Standards-based summaries
// ---------------------------------------------------------------------------

export interface StandardScoreInput {
  studentId: string;
  standardId: string;
  level: number;
  gradedAt: Date;
}
export interface StandardSummary {
  standardId: string;
  latest: number | null;
  best: number | null;
  average: number | null;
  attempts: number;
}

/** Per student and standard: the most recent level (what report cards show), the best, and the mean. */
export function summariseStandards(
  scores: StandardScoreInput[],
): Map<string, Map<string, StandardSummary>> {
  const out = new Map<string, Map<string, StandardSummary>>();
  const grouped = new Map<string, StandardScoreInput[]>();
  for (const s of scores) {
    const key = `${s.studentId}:${s.standardId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), s]);
  }
  for (const list of grouped.values()) {
    const sorted = [...list].sort(
      (a, b) => a.gradedAt.getTime() - b.gradedAt.getTime(),
    );
    const levels = sorted.map((s) => s.level);
    const summary: StandardSummary = {
      standardId: sorted[0].standardId,
      latest: levels[levels.length - 1],
      best: Math.max(...levels),
      average: round2(levels.reduce((a, b) => a + b, 0) / levels.length),
      attempts: levels.length,
    };
    const byStandard =
      out.get(sorted[0].studentId) ?? new Map<string, StandardSummary>();
    byStandard.set(summary.standardId, summary);
    out.set(sorted[0].studentId, byStandard);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GPA
// ---------------------------------------------------------------------------

/** Unweighted GPA: the mean of the GPA points of every line that has a letter. */
export function gpaOf(
  lines: Array<{ gpaPoints: number | null }>,
): number | null {
  const pts = lines
    .map((l) => l.gpaPoints)
    .filter((p): p is number => p !== null);
  return pts.length
    ? round2(pts.reduce((a, b) => a + b, 0) / pts.length)
    : null;
}

// ---------------------------------------------------------------------------
// 1EdTech CASE import
// ---------------------------------------------------------------------------

export interface CaseStandard {
  identifier: string;
  code: string;
  description: string;
  gradeLevels: string | null;
  parentIdentifier: string | null;
  sortOrder: number;
}
export interface CaseDocument {
  identifier: string | null;
  code: string;
  name: string;
  subject: string | null;
  jurisdiction: string | null;
  version: string | null;
  sourceUri: string | null;
  standards: CaseStandard[];
}

interface CaseItem {
  identifier?: string;
  humanCodingScheme?: string;
  fullStatement?: string;
  abbreviatedStatement?: string;
  educationLevel?: string[];
  listEnumeration?: string;
  CFItemType?: string;
}
interface CaseAssociation {
  associationType?: string;
  originNodeURI?: { identifier?: string };
  destinationNodeURI?: { identifier?: string };
}
interface CasePackage {
  CFDocument?: {
    identifier?: string;
    title?: string;
    subjectTitle?: string[];
    creator?: string;
    adoptionStatus?: string;
    version?: string;
    uri?: string;
    officialSourceURL?: string;
    notes?: string;
  };
  CFItems?: CaseItem[];
  CFAssociations?: CaseAssociation[];
}

/**
 * Reads a CASE package (CFDocument + CFItems + CFAssociations, the format Common Core, NGSS and the state
 * frameworks publish). Only items with a statement become standards; isChildOf associations give the tree.
 */
export function parseCase(json: unknown, fallbackCode?: string): CaseDocument {
  const pkg =
    (typeof json === 'string'
      ? safeJson<CasePackage>(json)
      : (json as CasePackage | null)) ?? {};
  const doc = pkg.CFDocument ?? {};
  const items = Array.isArray(pkg.CFItems) ? pkg.CFItems : [];
  if (!doc.title && items.length === 0)
    throw new Error('Not a CASE package: no CFDocument or CFItems.');
  const parentOf = new Map<string, string>();
  for (const a of Array.isArray(pkg.CFAssociations) ? pkg.CFAssociations : []) {
    if (
      a.associationType === 'isChildOf' &&
      a.originNodeURI?.identifier &&
      a.destinationNodeURI?.identifier &&
      a.destinationNodeURI.identifier !== doc.identifier
    ) {
      parentOf.set(a.originNodeURI.identifier, a.destinationNodeURI.identifier);
    }
  }
  const standards: CaseStandard[] = [];
  const seen = new Set<string>();
  items.forEach((it, i) => {
    const statement = (
      it.fullStatement ??
      it.abbreviatedStatement ??
      ''
    ).trim();
    if (!it.identifier || !statement) return;
    const code = (it.humanCodingScheme ?? it.listEnumeration ?? it.identifier)
      .trim()
      .slice(0, 80);
    if (seen.has(code)) return;
    seen.add(code);
    standards.push({
      identifier: it.identifier,
      code,
      description: statement.slice(0, 4000),
      gradeLevels: it.educationLevel?.length
        ? it.educationLevel.map(normaliseLevel).join(',').slice(0, 100)
        : null,
      parentIdentifier: parentOf.get(it.identifier) ?? null,
      sortOrder: i,
    });
  });
  const name = (doc.title ?? fallbackCode ?? 'Imported standards')
    .trim()
    .slice(0, 200);
  const code =
    (fallbackCode ?? doc.title ?? 'IMPORTED')
      .replace(/[^A-Za-z0-9.-]+/g, '-')
      .replace(/^-|-$/g, '')
      .toUpperCase()
      .slice(0, 40) || 'IMPORTED';
  return {
    identifier: doc.identifier ?? null,
    code,
    name,
    subject: doc.subjectTitle?.[0] ?? null,
    jurisdiction: doc.creator ?? null,
    version: doc.version ?? null,
    sourceUri: doc.officialSourceURL ?? doc.uri ?? null,
    standards,
  };
}

function normaliseLevel(v: string): string {
  const t = v.trim().toUpperCase();
  if (t === 'KG' || t === 'K') return 'K';
  if (t === 'PK' || t === 'PRE-K') return 'PK';
  const n = t.replace(/^0+/, '');
  return n || t;
}

function safeJson<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
