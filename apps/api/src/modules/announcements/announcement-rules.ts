/** Pure rules for announcements: visibility, ordering, lifecycle. */

export const ANNOUNCEMENT_TYPES = [
  'general',
  'academic',
  'event',
  'emergency',
  'administrative',
  'social',
] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export interface AnnouncementLike {
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  classId: string | null;
  authorId: string | null;
  expiresAt: Date | null;
  publishedAt: Date | null;
  pinned: boolean;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export interface Viewer {
  id: string;
  isStaff: boolean;
  isAdmin: boolean;
  classIds: string[];
}

/** Learners see published, unexpired items for the school or their classes; staff also see their own drafts. */
export function isVisibleTo(
  a: AnnouncementLike,
  viewer: Viewer,
  now = new Date(),
): boolean {
  if (a.status === 'PUBLISHED') {
    if (a.expiresAt && a.expiresAt <= now && !viewer.isStaff) return false;
    return (
      a.classId === null ||
      viewer.classIds.includes(a.classId) ||
      viewer.isAdmin
    );
  }
  if (!viewer.isStaff) return false;
  return viewer.isAdmin || a.authorId === viewer.id;
}

export function canEdit(a: AnnouncementLike, viewer: Viewer): boolean {
  return viewer.isAdmin || (viewer.isStaff && a.authorId === viewer.id);
}

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

/** Pinned first, then urgency, then newest. */
export function compareForFeed(
  a: AnnouncementLike,
  b: AnnouncementLike,
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
}

export function isExpired(a: AnnouncementLike, now = new Date()): boolean {
  return !!a.expiresAt && a.expiresAt <= now;
}
