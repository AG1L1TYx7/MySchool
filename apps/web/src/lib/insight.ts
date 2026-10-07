/** Insight (docs/07 row 17): the principal overview, class and student analytics, scheduled reports, transcripts. */

export interface Overview {
  date: string;
  attendance: {
    deadline: string | null;
    classesMeeting: number;
    classesTaken: number;
    classesMissing: Array<{ classId: string; name: string; period: string | null; teachers: string[] }>;
    rateToday: number | null;
    marked: number;
  };
  missingWork: { windowDays: number; items: number; students: number; byGradeLevel: Array<{ gradeLevel: string; items: number; students: number }> };
  failing: {
    threshold: number;
    students: number;
    byClass: Array<{ classId: string; className: string; count: number; students: Array<{ id: string; name: string; grade: number }> }>;
  };
  gradebook: {
    classes: Array<{ classId: string; className: string; teachers: string[]; assignmentsDue: number; enrolled: number; graded: number; ungradedSubmissions: number; completeness: number | null }>;
    average: number | null;
  };
  ai: {
    windowDays: number;
    conversations: number;
    messages: number;
    refusals: number;
    refusalRate: number | null;
    conversationsLastWeek: number;
    byRole: Array<{ role: string; conversations: number; messages: number }>;
    byCapability: Array<{ capability: string; conversations: number }>;
  };
  engagement: {
    windowDays: number;
    loginsByRole: Array<{ role: string; active: number; total: number }>;
    submissions: number;
    lessonCompletions: number;
    practiceReviews: number;
  };
}

export type RiskFlag = 'failing' | 'missing_work' | 'attendance';

export interface ClassInsight {
  class: { id: string; name: string };
  students: number;
  distribution: Array<{ label: string; min: number; max: number; count: number }>;
  average: number | null;
  attendanceRate30Days: number | null;
  missingItems: number;
  atRisk: RosterRow[];
  roster: RosterRow[];
  assignments: Array<{ id: string; title: string; dueAt: string | null; submitted: number; graded: number; average: number | null }>;
}

export interface RosterRow {
  studentId: string;
  name: string;
  gradeLevel: string | null;
  grade: number | null;
  attendanceRate: number | null;
  missing: number;
  flags: RiskFlag[];
}

export interface StudentInsight {
  student: { id: string; firstName: string; lastName: string; gradeLevel: string | null; studentNumber: string };
  classes: Array<{ classId: string; name: string; courseTitle: string; teacher: string | null; status: string; grade: number | null; failing: boolean }>;
  attendance: { days: number; rate: number | null; absences: number; tardies: number; windowDays: number };
  missing: Array<{ assignmentId: string; title: string; className: string; dueAt: string }>;
  weekly: { submissions: Array<{ weekStart: string; count: number }>; lessonCompletions: Array<{ weekStart: string; count: number }> };
  lateSubmissions: number;
  ai: { conversations30Days: number };
  practice: { reviews30Days: number; masteryAverage: number | null; standardsMeasured: number };
  flags: RiskFlag[];
}

export interface ReportSchedule {
  id: string;
  organizationId: string;
  name: string;
  kind: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  classId: string | null;
  recipients: string[];
  active: boolean;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
}

export interface ReportRun {
  id: string;
  kind: string;
  status: string;
  delivered: boolean;
  recipients: string[];
  rowCount: number;
  fileName: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export const REPORT_KINDS = ['school_overview', 'attendance_today', 'missing_work', 'failing_students', 'gradebook_completeness', 'ai_usage', 'class_summary'] as const;
export const KIND_LABELS: Record<(typeof REPORT_KINDS)[number], string> = {
  school_overview: 'School overview',
  attendance_today: 'Attendance taken today',
  missing_work: 'Missing work (14 days)',
  failing_students: 'Students failing a class',
  gradebook_completeness: 'Gradebook completeness',
  ai_usage: 'AI usage',
  class_summary: 'Class summary',
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const FLAG_LABELS: Record<RiskFlag, string> = { failing: 'Failing', missing_work: 'Missing work', attendance: 'Attendance' };
export const flagClass = (f: RiskFlag) => (f === 'failing' ? 'bg-red-50 text-red-800' : f === 'missing_work' ? 'bg-amber-50 text-amber-900' : 'bg-brand-50 text-brand-800');
