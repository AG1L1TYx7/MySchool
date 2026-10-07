/** Types for announcements, notifications and messaging (docs/09). */

export interface Announcement {
  id: string;
  organizationId: string;
  classId: string | null;
  className: string | null;
  author: { id: string; firstName: string; lastName: string } | null;
  title: string;
  content: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'draft' | 'published' | 'archived';
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  canEdit: boolean;
  createdAt: string;
}

export const ANNOUNCEMENT_TYPES = ['general', 'academic', 'event', 'emergency', 'administrative', 'social'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export interface Notification {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationSummary {
  unread: number;
  byCategory: Record<string, number>;
  latest: Notification[];
}

export interface NotificationPreference {
  category: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

export interface PushDevice {
  id: string;
  platform: string;
  name: string | null;
  appVersion: string | null;
  locale: string | null;
  lastSeenAt: string;
  active: boolean;
  createdAt: string;
}

export const CATEGORY_LABELS: Record<string, string> = { announcement: 'Announcements', assignment: 'Assignments', grade: 'Grades', message: 'Messages', attendance: 'Attendance', system: 'Account and security', ai: 'AI tutor and content', digest: 'Weekly family summary', motivation: 'XP, streaks and badges' };

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group' | 'class';
  title: string;
  classId: string | null;
  participants: Array<Person & { lastReadAt: string | null }>;
  lastMessage: { id: string; content: string; senderId: string | null; createdAt: string } | null;
  unreadCount: number;
  muted: boolean;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: Person | null;
  content: string;
  replyTo: { id: string; content: string; senderName: string | null } | null;
  files: Array<{ id: string; originalName: string; sizeBytes: number; downloadUrl: string }>;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d ago` : new Date(iso).toLocaleDateString();
}
