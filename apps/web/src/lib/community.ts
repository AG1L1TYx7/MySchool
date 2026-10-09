/** Community (docs/02 section 31, slice 25): groups, class discussions, topics, replies, reports and moderation. */

export type GroupKind = 'class' | 'club' | 'school';
export type GroupVisibility = 'members' | 'school';
export type JoinPolicy = 'open' | 'approval' | 'invite';
export type ContentStatus = 'visible' | 'held' | 'hidden' | 'removed';
export type ReactionKind = 'like' | 'helpful' | 'celebrate';
export type ReportReason = 'bullying' | 'inappropriate' | 'personal_info' | 'spam' | 'other';
export type Resolution = 'dismiss' | 'hide' | 'remove' | 'warn';
export type ModerationAction = 'approve' | 'hide' | 'remove' | 'restore';

export interface Group {
  id: string;
  organizationId: string;
  classId: string | null;
  className: string | null;
  name: string;
  description: string | null;
  kind: GroupKind;
  visibility: GroupVisibility;
  joinPolicy: JoinPolicy;
  studentsCanPost: boolean;
  status: 'active' | 'archived';
  memberCount: number;
  topicCount: number;
  membership: { role: 'member' | 'moderator'; status: 'active' | 'pending'; mutedUntil: string | null } | null;
  canSee: boolean;
  canPost: boolean;
  postBlockedReason: string | null;
  canModerate: boolean;
  joinOutcome: 'active' | 'pending' | 'already' | 'not_allowed';
  createdAt: string;
}

export interface Member {
  userId: string;
  name: string;
  role: string;
  memberRole: 'member' | 'moderator';
  status: 'active' | 'pending';
  mutedUntil: string | null;
  joinedAt: string;
}

export interface Topic {
  id: string;
  groupId: string;
  authorId: string | null;
  author: string;
  authorRole: string | null;
  title: string;
  body: string;
  pinned: boolean;
  locked: boolean;
  status: ContentStatus;
  holdReason: string | null;
  postCount: number;
  lastPostAt: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canModerate: boolean;
  own: boolean;
}

export interface Post {
  id: string;
  topicId: string;
  authorId: string | null;
  author: string;
  authorRole: string | null;
  body: string;
  status: ContentStatus;
  holdReason: string | null;
  editedAt: string | null;
  createdAt: string;
  reactions: Record<ReactionKind, number>;
  myReaction: ReactionKind | null;
  canEdit: boolean;
  own: boolean;
}

export interface TopicDetail extends Topic {
  group: Group;
  posts: Post[];
  subscribed: boolean;
  canReply: boolean;
  replyBlockedReason: string | null;
}

export interface FeedItem {
  id: string;
  groupId: string;
  groupName: string;
  groupKind: GroupKind;
  title: string;
  author: string;
  pinned: boolean;
  locked: boolean;
  postCount: number;
  lastPostAt: string | null;
  createdAt: string;
}

export interface HeldItem {
  type: 'topic' | 'post';
  id: string;
  topicId: string;
  groupId: string;
  groupName: string;
  title: string;
  excerpt: string;
  author: string;
  authorId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  targetType: 'topic' | 'post';
  targetId: string;
  topicId: string;
  groupId: string;
  groupName: string;
  title: string;
  excerpt: string;
  targetStatus: ContentStatus;
  authorId: string | null;
  reason: ReportReason;
  details: string | null;
  reporter: string;
  createdAt: string;
}

export interface Queue {
  held: HeldItem[];
  reports: ReportItem[];
  summary: { held: number; reports: number; total: number };
}

export const KIND_LABELS: Record<GroupKind, string> = { class: 'Class discussion', club: 'Club', school: 'School-wide' };
export const VISIBILITY_LABELS: Record<GroupVisibility, string> = { members: 'Members only', school: 'Anyone at the school can read' };
export const JOIN_LABELS: Record<JoinPolicy, string> = { open: 'Anyone can join', approval: 'Ask to join', invite: 'Moderators add people' };
export const REACTION_LABELS: Record<ReactionKind, string> = { like: 'Like', helpful: 'Helpful', celebrate: 'Celebrate' };
export const REACTION_ICONS: Record<ReactionKind, string> = { like: '👍', helpful: '💡', celebrate: '🎉' };
export const REASON_LABELS: Record<ReportReason, string> = {
  bullying: 'Bullying or unkind',
  inappropriate: 'Not appropriate for school',
  personal_info: 'Shares personal details',
  spam: 'Spam or off topic',
  other: 'Something else',
};
export const RESOLUTION_LABELS: Record<Resolution, string> = {
  dismiss: 'No change needed',
  warn: 'Keep it, remind the author',
  hide: 'Hide it (author still sees it)',
  remove: 'Remove it for everyone',
};
export const STATUS_LABELS: Record<ContentStatus, string> = { visible: 'Visible', held: 'Waiting for a teacher', hidden: 'Hidden by a moderator', removed: 'Removed' };

export function statusClass(status: ContentStatus): string {
  switch (status) {
    case 'held':
      return 'bg-amber-50 text-amber-800';
    case 'hidden':
      return 'bg-slate-200 text-slate-700';
    case 'removed':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-green-50 text-green-700';
  }
}
