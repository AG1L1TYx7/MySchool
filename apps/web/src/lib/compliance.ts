/** Compliance (docs/13 section 10): the data map, retention, deletion requests, incidents and the records export. */

export interface DataMapEntry {
  model: string;
  table: string;
  holds: string;
  subject: 'student' | 'guardian' | 'staff' | 'everyone';
  purpose: string;
  basis: string;
  retention: string | null;
  location: string;
  rows: number;
  retentionDays: number | null;
}

export type RetentionKey = 'aiConversations' | 'notifications' | 'auditLogs' | 'learningRecords' | 'pushLogs' | 'withdrawnStudents';
export const RETENTION_KEYS: RetentionKey[] = ['aiConversations', 'notifications', 'auditLogs', 'learningRecords', 'pushLogs', 'withdrawnStudents'];
export const RETENTION_LABELS: Record<RetentionKey, string> = {
  aiConversations: 'AI tutor conversations',
  notifications: 'In-app notifications',
  auditLogs: 'Audit log',
  learningRecords: 'Learning records (xAPI)',
  pushLogs: 'Push delivery logs',
  withdrawnStudents: 'Withdrawn students (days after withdrawal; 0 = only on request)',
};

export interface DataMap {
  organizationId: string;
  generatedAt: string;
  retention: Record<RetentionKey, number>;
  bounds: Record<RetentionKey, { min: number; max: number }>;
  entries: DataMapEntry[];
}

export interface DeletionRequest {
  id: string;
  organizationId: string;
  studentId: string | null;
  studentName: string;
  studentNumber: string;
  requestedById: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  scheduledFor: string | null;
  decidedAt: string | null;
  completedAt: string | null;
  summary: unknown;
  createdAt: string;
}

export interface DeletionPlan {
  graceDays: number;
  removes: Array<{ key: string; label: string }>;
}

export interface Incident {
  id: string;
  organizationId: string | null;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'contained' | 'notified' | 'closed';
  summary: string;
  affectedCount: number;
  dataCategories: string | null;
  detectedAt: string;
  containedAt: string | null;
  notifiedAt: string | null;
  closedAt: string | null;
  deadlines: { districtBy: string; notifyBy: string };
  timeline: Array<{ at: string; by: string; note: string }>;
  reportedBy: string;
  createdAt: string;
}

export const severityClass = (s: Incident['severity']) => (s === 'critical' ? 'bg-red-100 text-red-900' : s === 'high' ? 'bg-red-50 text-red-800' : s === 'medium' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700');
export const statusClass = (s: string) => (s === 'closed' || s === 'completed' ? 'bg-green-50 text-green-800' : s === 'rejected' ? 'bg-slate-100 text-slate-600' : s === 'notified' || s === 'approved' ? 'bg-brand-50 text-brand-800' : 'bg-amber-50 text-amber-900');
