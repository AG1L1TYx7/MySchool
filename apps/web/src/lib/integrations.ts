/** Integrations (docs/02 section 33, slice 21): webhooks, API keys, LTI platforms and tools, exports. */

export interface Webhook {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  retryLimit: number;
  failureCount: number;
  lastDeliveredAt: string | null;
  createdAt: string;
  secret?: string;
}

export interface Delivery {
  id: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  createdBy: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  key?: string;
}

export interface LtiPlatform {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  deploymentId: string | null;
  authorizationUrl: string;
  jwksUrl: string;
  tokenUrl: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface LtiTool {
  id: string;
  name: string;
  loginUrl: string;
  launchUrl: string;
  jwksUrl: string | null;
  customParams: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  platform: { issuer: string; authorizationUrl: string; jwksUrl: string; clientId: string; deploymentId: string };
}

export const SCOPE_LABELS: Record<string, string> = {
  'students.view': 'Read students',
  'students.export': 'Export students',
  'classes.view': 'Read classes and rosters',
  'courses.view': 'Read courses',
  'assignments.view': 'Read assignments',
  'grades.view.all': 'Read grades',
  'grades.export': 'Export gradebooks',
  'attendance.view': 'Read attendance',
  'calendar.view': 'Read the calendar',
  'standards.view': 'Read standards',
  'reports.view': 'Read insight reports',
  'audit.logs.view': 'Read the audit log',
  'organizations.view': 'Read the school record',
  'district.view': 'Read the district overview',
};

export const EVENT_LABELS: Record<string, string> = {
  'student.enrolled': 'Student enrolled',
  'student.updated': 'Student updated',
  'enrollment.changed': 'Class enrollment changed',
  'course.created': 'Course created',
  'assignment.created': 'Assignment created',
  'assignment.published': 'Assignment published',
  'assignment.submitted': 'Assignment submitted',
  'grade.posted': 'Grade posted',
  'attendance.marked': 'Attendance marked',
  'report_card.published': 'Report card published',
  'announcement.published': 'Announcement published',
  'message.sent': 'Message sent',
  'lesson.completed': 'Lesson completed',
};

export const statusClass = (s: Delivery['status']) => (s === 'delivered' ? 'bg-emerald-100 text-emerald-800' : s === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800');
