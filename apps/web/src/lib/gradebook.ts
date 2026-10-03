/** Weighted gradebook, marks, standards and report cards (docs/13 section 4). */

export interface GradeCategory {
  id: string;
  name: string;
  weight: number;
  dropLowest: number;
  sortOrder: number;
}
export interface ProficiencyLevel {
  level: number;
  label: string;
  minPercent: number;
}
export interface ProficiencyScale {
  id: string;
  name: string;
  levels: ProficiencyLevel[];
  isDefault: boolean;
}
export interface ClassGrading {
  classId: string;
  gradingMode: 'points' | 'standards';
  proficiencyScaleId: string | null;
  scale: ProficiencyScale | null;
  latePolicy: string | null;
  syllabus: string | null;
  categories: GradeCategory[];
  weightWarning: string | null;
  canManage: boolean;
}

export interface BookCell {
  score: number | null;
  maxPoints: number;
  percentage: number | null;
  mark: 'graded' | 'missing' | 'excused' | 'incomplete' | 'none';
  dropped: boolean;
  extraCredit: boolean;
}
export interface Gradebook {
  classId: string;
  className: string;
  mode: 'categories' | 'points';
  gradingMode: 'points' | 'standards';
  categories: GradeCategory[];
  assignments: Array<{ id: string; title: string; categoryId: string | null; categoryName: string | null; maxPoints: number; weight: number; isExtraCredit: boolean; dueAt: string | null; status: string }>;
  rows: Array<{
    student: { id: string; studentNumber: string; firstName: string; lastName: string };
    cells: Record<string, BookCell>;
    categories: Array<{ categoryId: string | null; name: string; weight: number; earned: number; possible: number; percentage: number | null; dropped: string[] }>;
    percentage: number | null;
    letter: string | null;
    missing: number;
  }>;
  classAverage: number | null;
  perAssignmentAverage: Record<string, number | null>;
  standards: {
    levels: ProficiencyLevel[];
    standards: Array<{ id: string; code: string; description: string }>;
    rows: Array<{ studentId: string; levels: Record<string, { latest: number | null; best: number | null; average: number | null; attempts: number; label: string | null } | null> }>;
  } | null;
}

export type Mark = 'assigned' | 'missing' | 'turned_in' | 'returned' | 'excused' | 'late' | 'incomplete';
export const MARK_LABELS: Record<Mark, string> = { assigned: 'Assigned', missing: 'Missing', turned_in: 'Turned in', returned: 'Returned', excused: 'Excused', late: 'Late', incomplete: 'Incomplete' };
export const MARK_TONES: Record<Mark, string> = {
  assigned: 'bg-slate-100 text-slate-700',
  missing: 'bg-red-100 text-red-800',
  turned_in: 'bg-brand-100 text-brand-800',
  returned: 'bg-green-100 text-green-800',
  excused: 'bg-slate-200 text-slate-700',
  late: 'bg-amber-100 text-amber-900',
  incomplete: 'bg-amber-100 text-amber-900',
};
export const TEACHER_MARKS = ['missing', 'excused', 'incomplete'] as const;

export interface StandardSet {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  subject: string | null;
  jurisdiction: string | null;
  sourceUri: string | null;
  version: string | null;
  standardCount: number;
  shared: boolean;
}
export interface Standard {
  id: string;
  setId: string;
  setCode?: string;
  parentId: string | null;
  code: string;
  description: string;
  gradeLevels: string[];
  sortOrder: number;
}

export interface ReportCardLine {
  id: string;
  classId: string;
  className: string;
  courseTitle: string;
  teacherName: string | null;
  percentage: number | null;
  letter: string | null;
  gpaPoints: number | null;
  categories: Array<{ name: string; weight: number; percentage: number | null }>;
  standards: Array<{ code: string; description: string; level: number | null; label: string | null }>;
  comment: string | null;
  canComment: boolean;
}
export interface ReportCard {
  id: string;
  organizationId: string;
  student: { id: string; studentNumber: string; firstName: string; lastName: string; gradeLevel: string | null };
  gradingPeriod: { id: string; name: string; startDate: string; endDate: string; termName: string; yearName: string };
  kind: 'report_card' | 'progress';
  status: 'draft' | 'published';
  gpa: number | null;
  attendance: { daysPresent: number; daysAbsent: number; tardies: number; rate: number | null } | null;
  publishedAt: string | null;
  createdAt: string;
  lines: ReportCardLine[];
  canPublish: boolean;
}

export const kindLabel = (k: ReportCard['kind']) => (k === 'progress' ? 'Progress report' : 'Report card');
export const cellText = (c: BookCell | undefined): string => {
  if (!c) return '';
  if (c.mark === 'excused') return 'EX';
  if (c.mark === 'missing') return 'M';
  if (c.mark === 'incomplete') return 'I';
  return c.score === null ? '' : String(c.score);
};
