/**
 * Compliance rules (docs/13 section 10): the data map, retention arithmetic, deletion scheduling, the breach
 * clock and the records-export manifest. Pure; the service reads and deletes.
 */

export type Subject = 'student' | 'guardian' | 'staff' | 'everyone';

export interface DataMapEntry {
  /** Prisma model name, for the live count. */
  model: string;
  table: string;
  holds: string;
  subject: Subject;
  purpose: string;
  basis: string;
  /** Which retention switch applies; null keeps the row for the life of the record it belongs to. */
  retention: RetentionKey | null;
  location:
    'database' | 'database and file store' | 'database and AI service logs';
}

export const RETENTION_KEYS = [
  'aiConversations',
  'notifications',
  'auditLogs',
  'learningRecords',
  'pushLogs',
  'withdrawnStudents',
] as const;
export type RetentionKey = (typeof RETENTION_KEYS)[number];

/** Days. 0 means "keep until deleted by hand". Bounds keep a typo from erasing a school. */
export const RETENTION_DEFAULTS: Record<RetentionKey, number> = {
  aiConversations: 365,
  notifications: 180,
  auditLogs: 1095,
  learningRecords: 1095,
  pushLogs: 60,
  withdrawnStudents: 0,
};
export const RETENTION_BOUNDS: Record<
  RetentionKey,
  { min: number; max: number }
> = {
  aiConversations: { min: 30, max: 1825 },
  notifications: { min: 30, max: 730 },
  auditLogs: { min: 365, max: 3650 },
  learningRecords: { min: 365, max: 3650 },
  pushLogs: { min: 7, max: 365 },
  withdrawnStudents: { min: 0, max: 3650 },
};

/** The data map (docs/17): every table that holds personal data, whose it is, why, and for how long. */
export const DATA_MAP: DataMapEntry[] = [
  {
    model: 'user',
    table: 'Users',
    holds: 'Name, email, role, sign-in and MFA details, locale',
    subject: 'everyone',
    purpose: 'Accounts and sign-in',
    basis:
      'School official with a legitimate educational interest (FERPA); contract',
    retention: null,
    location: 'database',
  },
  {
    model: 'student',
    table: 'Students',
    holds:
      'Name, student number, grade level, date of birth, learning preferences, status',
    subject: 'student',
    purpose: 'The education record',
    basis: 'FERPA education record',
    retention: 'withdrawnStudents',
    location: 'database',
  },
  {
    model: 'studentGuardian',
    table: 'StudentGuardians',
    holds: 'Which adult is responsible for which student',
    subject: 'guardian',
    purpose: 'Family access and notices',
    basis: 'FERPA parent rights',
    retention: null,
    location: 'database',
  },
  {
    model: 'classEnrollment',
    table: 'ClassEnrollments',
    holds: 'Class membership and current grade',
    subject: 'student',
    purpose: 'Teaching and grading',
    basis: 'FERPA education record',
    retention: null,
    location: 'database',
  },
  {
    model: 'assignmentSubmission',
    table: 'AssignmentSubmissions',
    holds: 'Submitted text and attached files',
    subject: 'student',
    purpose: 'Grading',
    basis: 'FERPA education record',
    retention: null,
    location: 'database and file store',
  },
  {
    model: 'grade',
    table: 'Grades',
    holds: 'Scores, letters, feedback',
    subject: 'student',
    purpose: 'Grading and report cards',
    basis: 'FERPA education record',
    retention: null,
    location: 'database',
  },
  {
    model: 'attendance',
    table: 'Attendance',
    holds: 'Daily and period attendance',
    subject: 'student',
    purpose: 'Attendance and state reporting',
    basis: 'FERPA education record; state law',
    retention: null,
    location: 'database',
  },
  {
    model: 'reportCard',
    table: 'ReportCards',
    holds: 'Term grades, GPA, comments',
    subject: 'student',
    purpose: 'Report cards and transcripts',
    basis: 'FERPA education record',
    retention: null,
    location: 'database',
  },
  {
    model: 'accommodation',
    table: 'Accommodations',
    holds: 'Support plans and accommodations',
    subject: 'student',
    purpose: 'Delivering accommodations',
    basis: 'FERPA; IDEA and Section 504',
    retention: null,
    location: 'database',
  },
  {
    model: 'behaviorRecord',
    table: 'BehaviorRecords',
    holds: 'Behaviour notes',
    subject: 'student',
    purpose: 'Support and family communication',
    basis: 'FERPA education record',
    retention: null,
    location: 'database',
  },
  {
    model: 'counselorNote',
    table: 'CounselorNotes',
    holds: 'Counselor notes',
    subject: 'student',
    purpose: 'Counseling (sole-possession notes, not shared)',
    basis: 'FERPA sole-possession exemption',
    retention: null,
    location: 'database',
  },
  {
    model: 'aiConversation',
    table: 'AiConversations',
    holds: 'Tutor conversations and messages',
    subject: 'everyone',
    purpose: 'AI tutoring and teacher assistance',
    basis: 'COPPA consent for under-13; school policy',
    retention: 'aiConversations',
    location: 'database and AI service logs',
  },
  {
    model: 'aiConsent',
    table: 'AiConsents',
    holds: 'Consent decisions for AI features',
    subject: 'student',
    purpose: 'COPPA compliance',
    basis: 'COPPA',
    retention: null,
    location: 'database',
  },
  {
    model: 'message',
    table: 'Messages',
    holds: 'Messages between staff, families and students',
    subject: 'everyone',
    purpose: 'School communication',
    basis: 'School policy',
    retention: null,
    location: 'database',
  },
  {
    model: 'notification',
    table: 'Notifications',
    holds: 'In-app notices',
    subject: 'everyone',
    purpose: 'Notices',
    basis: 'School policy',
    retention: 'notifications',
    location: 'database',
  },
  {
    model: 'pushDevice',
    table: 'PushDevices',
    holds: 'Device push tokens',
    subject: 'everyone',
    purpose: 'Push notifications',
    basis: 'Consent by registering the device',
    retention: null,
    location: 'database',
  },
  {
    model: 'pushLog',
    table: 'PushLogs',
    holds: 'Push delivery results',
    subject: 'everyone',
    purpose: 'Troubleshooting delivery',
    basis: 'School policy',
    retention: 'pushLogs',
    location: 'database',
  },
  {
    model: 'xapiStatement',
    table: 'XapiStatements',
    holds: 'Learning records (what was attempted, scores, time)',
    subject: 'student',
    purpose: 'Learning analytics and mastery',
    basis: 'FERPA education record',
    retention: 'learningRecords',
    location: 'database',
  },
  {
    model: 'srsCard',
    table: 'SrsCards',
    holds: 'Practice cards and reviews',
    subject: 'student',
    purpose: 'Spaced practice',
    basis: 'FERPA education record',
    retention: null,
    location: 'database',
  },
  {
    model: 'masteryLevel',
    table: 'MasteryLevels',
    holds: 'Mastery per standard',
    subject: 'student',
    purpose: 'Insight for teachers and families',
    basis: 'FERPA education record',
    retention: null,
    location: 'database',
  },
  {
    model: 'rewardTransaction',
    table: 'RewardTransactions',
    holds: 'XP, badges, streaks',
    subject: 'student',
    purpose: 'Private motivation',
    basis: 'School policy',
    retention: null,
    location: 'database',
  },
  {
    model: 'auditLog',
    table: 'AuditLogs',
    holds: 'Who did what, when, from where',
    subject: 'everyone',
    purpose: 'Security and accountability',
    basis: 'Security; state privacy law',
    retention: 'auditLogs',
    location: 'database',
  },
  {
    model: 'fileUpload',
    table: 'FileUploads',
    holds: 'Uploaded files and their owners',
    subject: 'everyone',
    purpose: 'Submissions and content',
    basis: 'FERPA education record',
    retention: null,
    location: 'database and file store',
  },
];

export type RetentionPolicy = Record<RetentionKey, number>;

/** Stored JSON with defaults filled in and every value clamped to its bounds. */
export function parseRetention(
  json: string | null | undefined,
): RetentionPolicy {
  let parsed: Partial<Record<string, unknown>> = {};
  try {
    parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  const out = { ...RETENTION_DEFAULTS };
  for (const key of RETENTION_KEYS) {
    const raw = parsed[key];
    if (typeof raw === 'number' && Number.isFinite(raw))
      out[key] = clampRetention(key, Math.round(raw));
  }
  return out;
}

export function clampRetention(key: RetentionKey, days: number): number {
  const { min, max } = RETENTION_BOUNDS[key];
  if (days === 0 && min === 0) return 0;
  return Math.max(min, Math.min(max, days));
}

/** Rows older than this moment are removed; null when the switch is "keep". */
export function cutoffFor(days: number, now = new Date()): Date | null {
  if (!days || days <= 0) return null;
  return new Date(now.getTime() - days * 86_400_000);
}

/** Days between a request's approval and the erasure, so a mistaken request can still be stopped. */
export const DELETION_GRACE_DAYS = 30;

export function scheduleFor(
  approvedAt: Date,
  graceDays = DELETION_GRACE_DAYS,
): Date {
  return new Date(approvedAt.getTime() + graceDays * 86_400_000);
}

export type DeletionStatus = 'pending' | 'approved' | 'completed' | 'rejected';

export function canExecuteDeletion(
  input: { status: string; scheduledFor: Date | null; legalHold: boolean },
  now = new Date(),
): boolean {
  if (input.status !== 'approved' || input.legalHold) return false;
  if (!input.scheduledFor) return false;
  return input.scheduledFor.getTime() <= now.getTime();
}

/** What a hard delete removes with the student, in the words a family will read. */
export const DELETION_PLAN: Array<{ key: string; label: string }> = [
  { key: 'profile', label: 'Profile, student number and sign-in account' },
  { key: 'enrollments', label: 'Class memberships' },
  { key: 'submissions', label: 'Submitted work and attached files' },
  { key: 'grades', label: 'Grades, marks and report cards' },
  { key: 'attendance', label: 'Attendance' },
  {
    key: 'support',
    label: 'Support plans, behaviour notes, counselor notes, consent records',
  },
  { key: 'ai', label: 'AI tutor conversations' },
  { key: 'learning', label: 'Learning records, practice cards and mastery' },
  { key: 'motivation', label: 'XP, badges and quests' },
  {
    key: 'family',
    label: 'Family links (the guardians keep their own accounts)',
  },
];

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'contained' | 'notified' | 'closed';
export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = [
  'low',
  'medium',
  'high',
  'critical',
];
export const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'open',
  'contained',
  'notified',
  'closed',
];

/**
 * The breach clock (docs/18): families and the state are told within 72 hours of confirming that personal data
 * left the boundary; high and critical incidents also tell the district the same day they are detected.
 */
export function incidentDeadlines(
  detectedAt: Date,
  severity: IncidentSeverity,
): { districtBy: Date; notifyBy: Date } {
  const hours = severity === 'high' || severity === 'critical' ? 24 : 72;
  return {
    districtBy: new Date(detectedAt.getTime() + hours * 3_600_000),
    notifyBy: new Date(detectedAt.getTime() + 72 * 3_600_000),
  };
}

export interface TimelineEntry {
  at: string;
  by: string;
  note: string;
}

export function appendTimeline(
  json: string | null | undefined,
  entry: TimelineEntry,
): string {
  let list: TimelineEntry[] = [];
  try {
    list = json ? (JSON.parse(json) as TimelineEntry[]) : [];
  } catch {
    list = [];
  }
  return JSON.stringify([...list, entry].slice(-200));
}

/** Allowed status moves: forward only, and closing is always allowed. */
export function canMoveIncident(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  const order: IncidentStatus[] = ['open', 'contained', 'notified', 'closed'];
  return to === 'closed' || order.indexOf(to) > order.indexOf(from);
}

/** The sections of a FERPA records export, in the order they appear in the bundle. */
export const EXPORT_SECTIONS = [
  'profile',
  'guardians',
  'enrollments',
  'assignments',
  'grades',
  'attendance',
  'report-cards',
  'support',
  'ai-conversations',
  'learning',
  'motivation',
] as const;

export function exportManifest(input: {
  studentNumber: string;
  generatedAt: Date;
  counts: Record<string, number>;
  requestedBy: string;
}): Record<string, unknown> {
  return {
    format: 'SmartSchool records export 1.0',
    student: input.studentNumber,
    generatedAt: input.generatedAt.toISOString(),
    requestedBy: input.requestedBy,
    sections: EXPORT_SECTIONS.map((s) => ({
      name: s,
      file: `${s}.json`,
      rows: input.counts[s] ?? 0,
    })),
    note: "Education records under FERPA. Counselor sole-possession notes and other families' data are not included.",
  };
}
