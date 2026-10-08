/** Learning profile, recommendations and learning paths (docs/02 sections 22 and 29, slice 23). */

import type { MasteryBand, Trend } from '@/lib/learning';

export type StepKind = 'lesson' | 'h5p' | 'library' | 'practice' | 'assignment' | 'tutor';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';
export type PathStatus = 'active' | 'completed' | 'archived';

export interface HealthPart {
  key: 'mastery' | 'attendance' | 'work' | 'practice' | 'engagement';
  label: string;
  score: number;
  weight: number;
  note: string;
}
export interface Health {
  score: number;
  band: 'thriving' | 'steady' | 'watch' | 'support';
  parts: HealthPart[];
}

export interface Gap {
  standardId: string;
  code: string;
  description: string;
  level: number;
  trend: Trend | string;
  evidenceCount: number;
}

export interface Recommendation {
  kind: StepKind;
  refId: string | null;
  title: string;
  reason: string;
  priority: number;
  href: string | null;
  standardCode?: string | null;
}

export interface Step {
  id: string;
  sortOrder: number;
  kind: StepKind;
  refId: string | null;
  title: string;
  reason: string | null;
  standardCode: string | null;
  status: StepStatus;
  evidence: string | null;
  completedAt: string | null;
  href: string | null;
}

export interface Progress {
  total: number;
  done: number;
  percent: number;
  complete: boolean;
}

export interface LearningPath {
  id: string;
  studentId: string;
  title: string;
  goal: string | null;
  source: 'generated' | 'teacher';
  status: PathStatus;
  rationale: string | null;
  createdBy: string | null;
  progress: Progress;
  steps: Step[];
  canManage: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  student: { id: string; firstName: string; lastName: string; gradeLevel: string | null };
  health: Health;
  mastery: { average: number | null; counts: Record<MasteryBand, number>; strongest: Array<{ code: string; level: number }>; weakest: Array<{ code: string; level: number }>; measured: number };
  attendance: { days: number; rate: number | null; absences: number; tardies: number; windowDays: number };
  work: { missing: number; lateSubmissions: number; failingClasses: string[] };
  practice: { due: number; reviews30Days: number };
  ai: { conversations30Days: number };
  flags: string[];
  gaps: Gap[];
  recommendations: Recommendation[];
  paths: Array<{ id: string; title: string; status: PathStatus; source: string; progress: Progress }>;
}

export interface ClassPathRow {
  id: string;
  title: string;
  status: PathStatus;
  source: string;
  student: { id: string; firstName: string; lastName: string };
  progress: Progress;
  updatedAt: string;
}

export const KIND_LABELS: Record<StepKind, string> = { lesson: 'Lesson', h5p: 'Activity', library: 'Library', practice: 'Practice', assignment: 'Assignment', tutor: 'Tutor' };
export const BAND_LABELS: Record<Health['band'], string> = { thriving: 'Thriving', steady: 'Steady', watch: 'Worth a look', support: 'Needs support' };
export const bandClass = (b: Health['band']) => (b === 'thriving' ? 'bg-emerald-100 text-emerald-800' : b === 'steady' ? 'bg-brand-50 text-brand-700' : b === 'watch' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800');
export const stepClass = (s: StepStatus) => (s === 'done' ? 'bg-emerald-100 text-emerald-800' : s === 'skipped' ? 'bg-slate-100 text-slate-600' : s === 'in_progress' ? 'bg-brand-50 text-brand-700' : 'bg-white text-slate-700 ring-1 ring-slate-300');
