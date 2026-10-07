/** Learning records and science (docs/02 sections 24 and 25): practice cards, mastery per standard, learning curves. */

export type CardStatus = 'new' | 'learning' | 'mastered' | 'struggling';

export interface PracticeCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  sourceType: string;
  sourceId: string | null;
  easiness: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueOn: string;
  lastReviewedAt: string | null;
  suspended: boolean;
  status: CardStatus;
}

export interface PracticeQueue {
  data: PracticeCard[];
  due: number;
  newCards: number;
  reviewedToday: number;
}

export interface ReviewOutcome {
  card: PracticeCard;
  reviewedToday: number;
  sessionGoal: number;
  reward: { granted: number; badges: string[]; streakDays: number } | null;
}

export interface PracticeStats {
  total: number;
  dueToday: number;
  mastered: number;
  struggling: number;
  reviewedToday: number;
  reviewsLast30Days: number;
  retentionLast30Days: number | null;
  practiceDaysLast60: number;
  sessionGoal: number;
}

export type MasteryBand = 'advanced' | 'proficient' | 'developing' | 'beginning';
export type Trend = 'up' | 'down' | 'flat';

export interface MasteryStandard {
  standardId: string;
  code: string;
  description: string;
  subject?: string | null;
  setName?: string;
  level: number;
  band: MasteryBand;
  trend: Trend;
  evidenceCount: number;
  lastEvidenceAt: string | null;
}

export interface MasterySummary {
  student: { id: string; firstName: string; lastName: string };
  standards: MasteryStandard[];
  average: number | null;
  counts: Record<MasteryBand, number>;
  strongest: MasteryStandard[];
  weakest: MasteryStandard[];
}

export interface CourseMastery {
  course: { id: string; title: string };
  student: { id: string; firstName: string; lastName: string };
  level: number | null;
  modules: Array<{ id: string; title: string; standards: number; measured: number; level: number | null; band: MasteryBand | null }>;
  standards: Array<{ standardId: string; code: string; description: string; level: number; band: MasteryBand; trend: Trend }>;
}

export interface CurvePoint {
  weekStart: string;
  items: number;
  averageScaled: number | null;
  retention: number | null;
}

export interface LearningCurve {
  weeks: CurvePoint[];
  students: number;
}

export interface ClassMastery {
  class: { id: string; name: string };
  students: number;
  standards: Array<{
    standardId: string;
    code: string;
    description: string;
    measured: number;
    average: number;
    band: MasteryBand;
    counts: Record<MasteryBand, number>;
    needsHelp: Array<{ studentId: string; name: string; level: number }>;
  }>;
}

export interface LearningRecord {
  id: string;
  verb: string;
  objectType: string;
  objectId: string;
  objectName: string;
  scaled: number | null;
  raw: number | null;
  max: number | null;
  success: boolean | null;
  completion: boolean | null;
  durationSeconds: number | null;
  classId: string | null;
  timestamp: string;
}

export interface ContentAnalytics {
  content: { id: string; title: string };
  attempts: number;
  completed: number;
  completionRate: number | null;
  passRate: number | null;
  averageScaled: number | null;
  averageSeconds: number | null;
  students: number;
  lastAt: string | null;
}

export const BANDS: readonly MasteryBand[] = ['advanced', 'proficient', 'developing', 'beginning'];
export const QUALITIES = [0, 1, 2, 3, 4, 5] as const;

export const bandTone = (band: MasteryBand | null): 'brand' | 'green' | 'amber' => (band === 'advanced' || band === 'proficient' ? 'green' : band === 'developing' ? 'brand' : 'amber');
export const bandClass = (band: MasteryBand | null): string =>
  band === 'advanced' ? 'bg-green-100 text-green-900' : band === 'proficient' ? 'bg-green-50 text-green-800' : band === 'developing' ? 'bg-brand-50 text-brand-800' : band === 'beginning' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600';
export const percent = (level: number | null): number => (level === null ? 0 : Math.round(level * 100));
