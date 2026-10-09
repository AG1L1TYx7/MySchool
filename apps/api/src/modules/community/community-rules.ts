import type { Role } from '../../generated/prisma/client';

/**
 * Pure rules for the community (docs/02 section 31, slice 25): who may see, join, post in and moderate a
 * group; what a student's post must not contain before a teacher has looked at it; how topics are ranked;
 * what each moderation decision does. No database, no clock of its own.
 */

export const GROUP_KINDS = ['class', 'club', 'school'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** members: only members and moderators see it; school: anyone at the school can read it. */
export const GROUP_VISIBILITIES = ['members', 'school'] as const;
export type GroupVisibility = (typeof GROUP_VISIBILITIES)[number];

/** open: join yourself; approval: ask, a moderator approves; invite: moderators add people. */
export const JOIN_POLICIES = ['open', 'approval', 'invite'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export const MEMBER_ROLES = ['member', 'moderator'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATUSES = ['active', 'pending', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const REACTION_KINDS = ['like', 'helpful', 'celebrate'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REPORT_REASONS = [
  'bullying',
  'inappropriate',
  'personal_info',
  'spam',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** visible to all; held for a teacher; hidden by a moderator (author still sees it); removed for everyone. */
export const CONTENT_STATUSES = [
  'visible',
  'held',
  'hidden',
  'removed',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const MODERATION_ACTIONS = [
  'approve',
  'hide',
  'remove',
  'restore',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const REPORT_RESOLUTIONS = [
  'dismiss',
  'hide',
  'remove',
  'warn',
] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 4000;
/** Authors may change their own words for this long; moderators always can. */
export const EDIT_WINDOW_MINUTES = 30;
export const MAX_MUTE_DAYS = 30;
export const MAX_GROUPS_PER_PAGE = 100;

/** Roles that moderate every group of their school (or district) without being a member. */
const SCHOOL_MODERATORS: readonly Role[] = [
  'SUPER_ADMIN',
  'SUPERINTENDENT',
  'PRINCIPAL',
  'COUNSELOR',
];
const STAFF: readonly Role[] = [
  'SUPER_ADMIN',
  'SUPERINTENDENT',
  'PRINCIPAL',
  'TEACHER',
  'ASSISTANT',
  'COUNSELOR',
];

export interface Viewer {
  id: string;
  role: Role;
  organizationId: string | null;
  /** True for the platform administrator and a superintendent whose district holds the group's school. */
  reachesOrganization: boolean;
}

export interface GroupLike {
  organizationId: string;
  kind: string;
  visibility: string;
  joinPolicy: string;
  studentsCanPost: boolean;
  status: string;
}

export interface MemberLike {
  role: string;
  status: string;
  mutedUntil: Date | null;
}

export function isStaff(role: Role): boolean {
  return STAFF.includes(role);
}

export function isSchoolModerator(role: Role): boolean {
  return SCHOOL_MODERATORS.includes(role);
}

function inReach(group: GroupLike, viewer: Viewer): boolean {
  return (
    viewer.reachesOrganization || viewer.organizationId === group.organizationId
  );
}

function activeMember(member: MemberLike | null | undefined): boolean {
  return !!member && member.status === 'active';
}

/** Moderates this group: a group moderator, the school's administrators and counselors, or district roles. */
export function canModerate(
  group: GroupLike,
  viewer: Viewer,
  member: MemberLike | null | undefined,
): boolean {
  if (!inReach(group, viewer)) return false;
  if (isSchoolModerator(viewer.role)) return true;
  return activeMember(member) && member?.role === 'moderator';
}

/** Reads the group: moderators always; members; anyone at the school when the group is open to the school. */
export function canSeeGroup(
  group: GroupLike,
  viewer: Viewer,
  member: MemberLike | null | undefined,
): boolean {
  if (!inReach(group, viewer)) return false;
  if (canModerate(group, viewer, member)) return true;
  if (activeMember(member)) return true;
  if (group.status !== 'active') return false;
  return group.visibility === 'school';
}

/** Joining: open groups at once, approval groups as pending, invite-only groups never by yourself. */
export function joinOutcome(
  group: GroupLike,
  viewer: Viewer,
  member: MemberLike | null | undefined,
): 'active' | 'pending' | 'already' | 'not_allowed' {
  if (!inReach(group, viewer) || group.status !== 'active')
    return 'not_allowed';
  if (group.kind === 'class') return 'not_allowed';
  if (viewer.role === 'PARENT') return 'not_allowed';
  if (member && member.status !== 'removed') return 'already';
  if (group.joinPolicy === 'open') return 'active';
  if (group.joinPolicy === 'approval') return 'pending';
  return 'not_allowed';
}

export interface PostCheck {
  ok: boolean;
  /** Why not: the group is archived, you are not a member, you are muted, students may not post here, the topic is locked. */
  reason?:
    | 'archived'
    | 'not_member'
    | 'muted'
    | 'students_read_only'
    | 'locked'
    | 'parent';
}

/** Writes in the group: active, unmuted members (students only where allowed); moderators even in locked topics. */
export function canPost(
  group: GroupLike,
  viewer: Viewer,
  member: MemberLike | null | undefined,
  now: Date,
  topic?: { locked: boolean } | null,
): PostCheck {
  if (viewer.role === 'PARENT') return { ok: false, reason: 'parent' };
  if (!inReach(group, viewer)) return { ok: false, reason: 'not_member' };
  const moderator = canModerate(group, viewer, member);
  if (group.status !== 'active' && !moderator)
    return { ok: false, reason: 'archived' };
  if (topic?.locked && !moderator) return { ok: false, reason: 'locked' };
  if (moderator) return { ok: true };
  if (!activeMember(member)) return { ok: false, reason: 'not_member' };
  if (member?.mutedUntil && member.mutedUntil > now)
    return { ok: false, reason: 'muted' };
  if (viewer.role === 'STUDENT' && !group.studentsCanPost)
    return { ok: false, reason: 'students_read_only' };
  return { ok: true };
}

/** Authors edit within the window; moderators any time. Removed content is never edited. */
export function canEditContent(
  content: {
    authorId: string | null;
    createdAt: Date;
    status: string;
  },
  viewerId: string,
  moderator: boolean,
  now: Date,
): boolean {
  if (content.status === 'removed') return false;
  if (moderator) return true;
  if (content.authorId !== viewerId) return false;
  return (
    now.getTime() - content.createdAt.getTime() <= EDIT_WINDOW_MINUTES * 60_000
  );
}

/** Who sees a piece of content in its current state. */
export function canSeeContent(
  content: { authorId: string | null; status: string },
  viewerId: string,
  moderator: boolean,
): boolean {
  switch (content.status) {
    case 'visible':
      return true;
    case 'held':
    case 'hidden':
      return moderator || content.authorId === viewerId;
    default:
      return moderator;
  }
}

/** Patterns that hold a student's words for a teacher: ways to be reached outside school, and unkind phrases. */
/** Ten digits in phone shape, not part of a longer number (an id or a timestamp is not a phone). */
const PHONE =
  /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const STREET =
  /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way)\b\.?/;
const HANDLE =
  /(?:^|\s)@[A-Za-z0-9_.]{3,}\b|\b(?:snap|snapchat|insta|instagram|tiktok|discord|whatsapp)\b\s*[:@]?\s*[A-Za-z0-9_.]{3,}/i;
const UNKIND = [
  'kill yourself',
  'kys',
  'nobody likes you',
  'you are stupid',
  "you're stupid",
  'you are ugly',
  "you're ugly",
  'go die',
  'i hate you',
  'loser',
  'idiot',
  'retard',
  'shut up',
];

export interface ScreenResult {
  ok: boolean;
  /** personal_info: a phone, email, address or social handle; unkind: a phrase that reads as bullying; link: an outside link. */
  reason?: 'personal_info' | 'unkind' | 'link';
}

/** Students' words are checked before they appear; staff are trusted. The check is a rule list, not a model. */
export function screenText(text: string, authorRole: Role): ScreenResult {
  if (isStaff(authorRole)) return { ok: true };
  const t = text.normalize('NFKC');
  if (PHONE.test(t) || EMAIL.test(t) || STREET.test(t) || HANDLE.test(t))
    return { ok: false, reason: 'personal_info' };
  const lower = t.toLowerCase();
  if (
    UNKIND.some((p) =>
      new RegExp(
        `(?:^|\\W)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\W|$)`,
      ).test(lower),
    )
  ) {
    return { ok: false, reason: 'unkind' };
  }
  if (/https?:\/\/|www\./i.test(t)) return { ok: false, reason: 'link' };
  return { ok: true };
}

export const HOLD_MESSAGES: Record<
  NonNullable<ScreenResult['reason']>,
  string
> = {
  personal_info:
    'Looks like it shares a way to reach someone outside school. A teacher will look at it first.',
  unkind:
    'Some of these words could hurt someone. A teacher will look at it first.',
  link: 'Links to outside sites are checked by a teacher first.',
};

/** Pinned topics first, then the most recent activity. */
export function rankTopics<
  T extends { pinned: boolean; lastPostAt: Date | null; createdAt: Date },
>(topics: T[]): T[] {
  return [...topics].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = (a.lastPostAt ?? a.createdAt).getTime();
    const tb = (b.lastPostAt ?? b.createdAt).getTime();
    return tb - ta;
  });
}

/** What a moderation action does to the content's state. */
export function statusAfterAction(action: ModerationAction): ContentStatus {
  switch (action) {
    case 'approve':
    case 'restore':
      return 'visible';
    case 'hide':
      return 'hidden';
    default:
      return 'removed';
  }
}

/** What closing a report does to the reported content (null = nothing changes) and whether the author hears about it. */
export function resolutionEffect(resolution: ReportResolution): {
  status: ContentStatus | null;
  notifyAuthor: boolean;
} {
  switch (resolution) {
    case 'dismiss':
      return { status: null, notifyAuthor: false };
    case 'warn':
      return { status: null, notifyAuthor: true };
    case 'hide':
      return { status: 'hidden', notifyAuthor: true };
    default:
      return { status: 'removed', notifyAuthor: true };
  }
}

/** Mute for a whole number of days, at least one and at most the limit. */
export function muteUntil(days: number, now: Date): Date {
  const d = Math.min(MAX_MUTE_DAYS, Math.max(1, Math.floor(days)));
  return new Date(now.getTime() + d * 86_400_000);
}

/** Subscribers hear about a new post, except whoever wrote it. */
export function postRecipients(
  subscriberIds: string[],
  authorId: string,
): string[] {
  return Array.from(new Set(subscriberIds.filter((id) => id !== authorId)));
}

export function classGroupName(className: string): string {
  return `${className} discussion`;
}

/** The class discussion group: everyone enrolled plus its teachers as moderators. */
export function classMembership(
  studentUserIds: Array<string | null>,
  teacherIds: string[],
): Array<{ userId: string; role: MemberRole }> {
  const out = new Map<string, MemberRole>();
  for (const id of studentUserIds) if (id) out.set(id, 'member');
  for (const id of teacherIds) out.set(id, 'moderator');
  return Array.from(out, ([userId, role]) => ({ userId, role }));
}

/** Counts for the moderation queue card. */
export function queueSummary(
  held: number,
  reports: number,
): { held: number; reports: number; total: number } {
  return { held, reports, total: held + reports };
}

/** Plain-language reason text shown with a held or hidden post. */
export function holdReasonText(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return HOLD_MESSAGES[reason as keyof typeof HOLD_MESSAGES] ?? reason;
}

export function isReactionKind(v: string): v is ReactionKind {
  return (REACTION_KINDS as readonly string[]).includes(v);
}
