/**
 * Pure rules for learning records and learning science (docs/02 sections 24 and 25, docs/07 row 16):
 * xAPI statements built from what the school already knows, SM-2 spaced repetition, mastery per standard
 * from recency-weighted evidence, and weekly learning curves. No ranking of students anywhere.
 */

// ---------------------------------------------------------------------------
// xAPI 1.0.3 statements
// ---------------------------------------------------------------------------

export type XapiVerb =
  | 'experienced'
  | 'attempted'
  | 'answered'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'interacted'
  | 'progressed';

export const VERB_IRI: Record<XapiVerb, string> = {
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  attempted: 'http://adlnet.gov/expapi/verbs/attempted',
  answered: 'http://adlnet.gov/expapi/verbs/answered',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
  interacted: 'http://adlnet.gov/expapi/verbs/interacted',
  progressed: 'http://adlnet.gov/expapi/verbs/progressed',
};

/** Scores at or above this share of the maximum count as passed (docs/02 section 24 keeps H5P's convention). */
export const PASS_MARK = 0.6;

export interface StatementInput {
  verb: XapiVerb;
  actor: { userId: string; name: string };
  object: {
    type: 'h5p-content' | 'lesson' | 'assignment' | 'srs-card';
    id: string;
    name: string;
  };
  result?: {
    raw?: number;
    max?: number;
    success?: boolean;
    completion?: boolean;
    durationSeconds?: number;
    response?: string;
  };
  context?: {
    classId?: string | null;
    parentId?: string | null;
    registration?: string | null;
  };
  timestamp?: Date;
  homePage?: string;
}

export interface BuiltStatement {
  verb: XapiVerb;
  resultScaled: number | null;
  resultRaw: number | null;
  resultMax: number | null;
  resultSuccess: boolean | null;
  resultCompletion: boolean | null;
  durationSeconds: number | null;
  timestamp: Date;
  statement: Record<string, unknown>;
}

const OBJECT_TYPE_IRI: Record<StatementInput['object']['type'], string> = {
  'h5p-content': 'http://adlnet.gov/expapi/activities/interaction',
  lesson: 'http://adlnet.gov/expapi/activities/lesson',
  assignment: 'http://adlnet.gov/expapi/activities/assessment',
  'srs-card': 'http://adlnet.gov/expapi/activities/question',
};

/** ISO 8601 duration from whole seconds: PT1H2M3S. */
export function isoDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${r || (!h && !m) ? `${r}S` : ''}`;
}

export function scaled(
  raw: number | undefined,
  max: number | undefined,
): number | null {
  if (raw === undefined || max === undefined || max <= 0) return null;
  return Math.round(Math.min(1, Math.max(0, raw / max)) * 1000) / 1000;
}

/** A complete xAPI statement plus the columns the store indexes. */
export function buildStatement(input: StatementInput): BuiltStatement {
  const timestamp = input.timestamp ?? new Date();
  const home = input.homePage ?? 'https://smartschool.local';
  const scaledScore = scaled(input.result?.raw, input.result?.max);
  const result: Record<string, unknown> = {};
  if (input.result) {
    if (scaledScore !== null)
      result.score = {
        scaled: scaledScore,
        raw: input.result.raw,
        max: input.result.max,
        min: 0,
      };
    if (input.result.success !== undefined)
      result.success = input.result.success;
    if (input.result.completion !== undefined)
      result.completion = input.result.completion;
    if (input.result.durationSeconds !== undefined)
      result.duration = isoDuration(input.result.durationSeconds);
    if (input.result.response !== undefined)
      result.response = input.result.response;
  }
  const contextActivities: Record<string, unknown> = {};
  if (input.context?.parentId)
    contextActivities.parent = [
      { id: `${home}/xapi/activities/${input.context.parentId}` },
    ];
  if (input.context?.classId)
    contextActivities.grouping = [
      { id: `${home}/xapi/classes/${input.context.classId}` },
    ];
  const statement: Record<string, unknown> = {
    actor: {
      objectType: 'Agent',
      name: input.actor.name,
      account: { homePage: home, name: input.actor.userId },
    },
    verb: { id: VERB_IRI[input.verb], display: { 'en-US': input.verb } },
    object: {
      objectType: 'Activity',
      id: `${home}/xapi/activities/${input.object.id}`,
      definition: {
        name: { 'en-US': input.object.name },
        type: OBJECT_TYPE_IRI[input.object.type],
      },
    },
    ...(Object.keys(result).length ? { result } : {}),
    context: {
      ...(input.context?.registration
        ? { registration: input.context.registration }
        : {}),
      ...(Object.keys(contextActivities).length ? { contextActivities } : {}),
      platform: 'SmartSchool',
    },
    timestamp: timestamp.toISOString(),
    version: '1.0.3',
  };
  return {
    verb: input.verb,
    resultScaled: scaledScore,
    resultRaw: input.result?.raw ?? null,
    resultMax: input.result?.max ?? null,
    resultSuccess: input.result?.success ?? null,
    resultCompletion: input.result?.completion ?? null,
    durationSeconds: input.result?.durationSeconds ?? null,
    timestamp,
    statement,
  };
}

/** The statements one H5P result produces: completed always, then passed or failed when there was a score. */
export function verbsForResult(
  score: number,
  maxScore: number,
  completed: boolean,
): XapiVerb[] {
  const verbs: XapiVerb[] = completed ? ['completed'] : ['attempted'];
  if (maxScore > 0 && completed)
    verbs.push(score / maxScore >= PASS_MARK ? 'passed' : 'failed');
  return verbs;
}

// ---------------------------------------------------------------------------
// Spaced repetition (SM-2)
// ---------------------------------------------------------------------------

export interface CardState {
  easiness: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export interface Scheduled extends CardState {
  dueOn: string;
}

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
};

/**
 * SM-2: quality 0..5. Below 3 the card starts over (a lapse); otherwise intervals go 1, 6, then previous × easiness.
 * Easiness moves by the usual formula and never drops below 1.3.
 */
export function schedule(
  state: CardState,
  quality: number,
  today: string,
): Scheduled {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let easiness = state.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  easiness = Math.max(1.3, Math.round(easiness * 100) / 100);
  if (q < 3)
    return {
      easiness,
      intervalDays: 1,
      repetitions: 0,
      lapses: state.lapses + 1,
      dueOn: addDays(today, 1),
    };
  const repetitions = state.repetitions + 1;
  const intervalDays =
    repetitions === 1
      ? 1
      : repetitions === 2
        ? 6
        : Math.max(1, Math.round(state.intervalDays * easiness));
  return {
    easiness,
    intervalDays,
    repetitions,
    lapses: state.lapses,
    dueOn: addDays(today, intervalDays),
  };
}

export const MASTERED_INTERVAL_DAYS = 21;
export const isMastered = (c: CardState): boolean =>
  c.intervalDays >= MASTERED_INTERVAL_DAYS && c.repetitions >= 3;
export const isStruggling = (c: CardState): boolean =>
  c.lapses >= 3 || c.easiness <= 1.5;

/** Cards from an H5P Dialogcards parameter block: the text is the front, the answer the back. */
export function cardsFromDialogcards(
  params: unknown,
): Array<{ front: string; back: string; hint: string | null }> {
  const dialogs = (params as { dialogs?: unknown })?.dialogs;
  if (!Array.isArray(dialogs)) return [];
  const strip = (v: unknown) =>
    typeof v === 'string' ? v.replace(/<[^>]+>/g, '').trim() : '';
  return dialogs
    .map((d) => ({
      front: strip((d as { text?: unknown }).text),
      back: strip((d as { answer?: unknown }).answer),
      hint: strip((d as { tips?: { front?: unknown } }).tips?.front) || null,
    }))
    .filter((c) => c.front && c.back);
}

/** Retention: the share of reviews answered with quality 3 or more. */
export function retentionRate(qualities: number[]): number | null {
  if (qualities.length === 0) return null;
  return Math.round(
    (qualities.filter((q) => q >= 3).length / qualities.length) * 100,
  );
}

// ---------------------------------------------------------------------------
// Mastery per standard
// ---------------------------------------------------------------------------

export interface Evidence {
  /** 0..1 */
  score: number;
  at: Date;
  /** How much one piece of this kind counts: a graded assignment 1, a practice result 0.6, a finished lesson 0.3. */
  weight: number;
}

export const EVIDENCE_WEIGHT = {
  grade: 1,
  standardScore: 1,
  practice: 0.6,
  lesson: 0.3,
} as const;
export const HALF_LIFE_DAYS = 30;

/** Recency-weighted mean of the evidence, in 0..1, three decimals; null without evidence. */
export function masteryFrom(
  evidence: Evidence[],
  now = new Date(),
): { level: number | null; trend: 'up' | 'flat' | 'down' } {
  if (evidence.length === 0) return { level: null, trend: 'flat' };
  let num = 0;
  let den = 0;
  for (const e of evidence) {
    const ageDays = Math.max(0, (now.getTime() - e.at.getTime()) / 86_400_000);
    const w = e.weight * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    num += w * Math.min(1, Math.max(0, e.score));
    den += w;
  }
  const level = den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
  const sorted = [...evidence].sort((a, b) => a.at.getTime() - b.at.getTime());
  let trend: 'up' | 'flat' | 'down' = 'flat';
  if (sorted.length >= 4) {
    const recent = sorted.slice(-2).reduce((s, e) => s + e.score, 0) / 2;
    const earlier =
      sorted.slice(0, -2).reduce((s, e) => s + e.score, 0) /
      (sorted.length - 2);
    if (recent - earlier >= 0.1) trend = 'up';
    else if (earlier - recent >= 0.1) trend = 'down';
  }
  return { level, trend };
}

export type MasteryBand =
  'beginning' | 'developing' | 'proficient' | 'advanced';
export function masteryBand(level: number | null): MasteryBand | null {
  if (level === null) return null;
  if (level >= 0.9) return 'advanced';
  if (level >= 0.7) return 'proficient';
  if (level >= 0.5) return 'developing';
  return 'beginning';
}

// ---------------------------------------------------------------------------
// Learning curves: one point per week
// ---------------------------------------------------------------------------

export interface CurvePoint {
  weekStart: string;
  items: number;
  averageScaled: number | null;
  retention: number | null;
}

/** Monday (UTC) of the week a date falls in. */
export function weekStartOf(d: Date): string {
  const day = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return isoDay(day);
}

/** Buckets scored events and review qualities into the last `weeks` weeks, oldest first, empty weeks included. */
export function learningCurve(
  events: Array<{ at: Date; scaled: number | null }>,
  reviews: Array<{ at: Date; quality: number }>,
  weeks = 12,
  now = new Date(),
): CurvePoint[] {
  const starts: string[] = [];
  const thisWeek = weekStartOf(now);
  for (let i = weeks - 1; i >= 0; i--) starts.push(addDays(thisWeek, -7 * i));
  const byWeek = new Map<
    string,
    { items: number; scores: number[]; qualities: number[] }
  >(starts.map((w) => [w, { items: 0, scores: [], qualities: [] }]));
  for (const e of events) {
    const b = byWeek.get(weekStartOf(e.at));
    if (!b) continue;
    b.items += 1;
    if (e.scaled !== null) b.scores.push(e.scaled);
  }
  for (const r of reviews)
    byWeek.get(weekStartOf(r.at))?.qualities.push(r.quality);
  return starts.map((weekStart) => {
    const b = byWeek.get(weekStart)!;
    return {
      weekStart,
      items: b.items,
      averageScaled: b.scores.length
        ? Math.round(
            (b.scores.reduce((s, x) => s + x, 0) / b.scores.length) * 1000,
          ) / 1000
        : null,
      retention: retentionRate(b.qualities),
    };
  });
}
