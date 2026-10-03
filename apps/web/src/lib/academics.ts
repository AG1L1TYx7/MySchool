export interface RubricCriterion {
  id: string;
  title: string;
  description?: string;
  maxPoints: number;
  levels?: Array<{ label: string; points: number; description?: string }>;
}

export interface Rubric {
  id: string;
  title: string;
  description: string | null;
  criteria: RubricCriterion[];
  totalPoints: number;
  isTemplate: boolean;
  canEdit: boolean;
}

export interface Assignment {
  id: string;
  classId: string;
  className: string;
  courseTitle: string;
  title: string;
  description: string | null;
  instructions: string | null;
  type: string;
  submissionType: string;
  category: string | null;
  categoryId: string | null;
  isExtraCredit: boolean;
  gradingPeriodId: string | null;
  standards: Array<{ id: string; setId: string; setCode?: string; code: string; description: string; gradeLevels: string[] }>;
  maxPoints: number;
  weight: number;
  availableFrom: string | null;
  dueAt: string | null;
  allowLateUntil: string | null;
  latePenaltyPercent: number | null;
  maxAttempts: number | null;
  rubricId: string | null;
  rubric: { id: string; title: string; criteria: RubricCriterion[] } | null;
  h5pContentId?: string | null;
  h5pContent?: { id: string; title: string; library: string; maxScore: number; status: string } | null;
  status: string;
  publishedAt: string | null;
  canManage: boolean;
  submissionCount: number;
  gradedCount: number;
  mySubmission?: { status: string; attemptNumber: number; submittedAt: string } | null;
  myGrade?: { score: number; maxPoints: number; percentage: number } | null;
  mySubmissions?: Submission[];
  myMark?: import('./gradebook').Mark;
}

export interface FileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface Grade {
  id: string;
  assignmentId: string;
  studentId: string;
  score: number;
  maxPoints: number;
  percentage: number;
  letterGrade: string | null;
  feedback: string | null;
  rubricScores: Array<{ criterionId: string; points: number; comment?: string }> | null;
  latePenaltyApplied: number | null;
  standardScores: Array<{ standardId: string; level: number; label: string }>;
  gradedAt: string;
  assignment?: { id: string; title: string; classId: string; className: string; dueAt: string | null; category: string | null };
  student?: { id: string; studentNumber: string; firstName: string; lastName: string };
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  student: { id: string; studentNumber: string; firstName: string; lastName: string };
  attemptNumber: number;
  status: string;
  textContent: string | null;
  isLate: boolean;
  submittedAt: string;
  files: FileMeta[];
  grade: Grade | null;
}

export interface SubmissionRow {
  student: { id: string; studentNumber: string; firstName: string; lastName: string };
  submission: Submission | null;
  grade: Grade | null;
  mark: import('./gradebook').Mark;
  markNote: string | null;
}

export interface Gradebook {
  classId: string;
  className: string;
  assignments: Array<{ id: string; title: string; category: string | null; maxPoints: number; weight: number; dueAt: string | null; status: string }>;
  rows: Array<{ student: { id: string; studentNumber: string; firstName: string; lastName: string }; cells: Record<string, { score: number; percentage: number } | null>; weightedScore: number; weightedMax: number; percentage: number | null; letter: string | null }>;
  classAverage: number | null;
  perAssignmentAverage: Record<string, number | null>;
}

export interface AttendanceRecord {
  id: string;
  classId: string;
  studentId: string;
  student?: { id: string; studentNumber: string; firstName: string; lastName: string };
  date: string;
  status: string;
  code: { id: string; code: string; label: string; category: string; countsAsPresent: boolean } | null;
  period: { id: string; name: string } | null;
  notes: string | null;
}

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  tardy: number;
  leftEarly: number;
  total: number;
  attendanceRate: number | null;
}

export const ASSIGNMENT_TYPES = ['homework', 'quiz', 'test', 'project', 'essay', 'presentation', 'lab', 'discussion', 'practice'] as const;
export const SUBMISSION_TYPES = ['online', 'paper', 'in_person', 'external', 'no_submission'] as const;
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused', 'tardy', 'left_early'] as const;

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
export const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);
