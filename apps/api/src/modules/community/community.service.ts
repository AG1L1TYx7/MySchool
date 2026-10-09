import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import type {
  CommunityGroup,
  CommunityMember,
  CommunityPost,
  CommunityTopic,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  organizationScope,
  reachableOrganizationIds,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  canEditContent,
  canModerate,
  canPost,
  canSeeContent,
  canSeeGroup,
  classGroupName,
  classMembership,
  holdReasonText,
  isSchoolModerator,
  joinOutcome,
  muteUntil,
  postRecipients,
  queueSummary,
  rankTopics,
  REACTION_KINDS,
  resolutionEffect,
  screenText,
  statusAfterAction,
  type ModerationAction,
  type Viewer,
} from './community-rules';
import type {
  AddMemberDto,
  CreateGroupDto,
  CreatePostDto,
  CreateTopicDto,
  ListGroupsQuery,
  ListTopicsQuery,
  ModerateDto,
  ReportDto,
  ResolveReportDto,
  UpdateGroupDto,
  UpdateMemberDto,
  UpdatePostDto,
  UpdateTopicDto,
} from './dto/community.dto';

const NAME = {
  select: { id: true, firstName: true, lastName: true, role: true },
} as const;
type Named = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
} | null;
const fullName = (u: Named) =>
  u ? `${u.firstName} ${u.lastName}`.trim() : 'Former member';

const GROUP_INCLUDE = {
  _count: {
    select: {
      members: { where: { status: 'active' } },
      topics: { where: { status: 'visible' } },
    },
  },
  class: { select: { id: true, name: true } },
} as const;
type GroupRow = Prisma.CommunityGroupGetPayload<{
  include: typeof GROUP_INCLUDE;
}>;
type TopicRow = CommunityTopic & { author: Named };
type PostRow = CommunityPost & {
  author: Named;
  reactions: Array<{ userId: string; kind: string }>;
};

interface Loaded {
  group: GroupRow;
  member: CommunityMember | null;
  viewer: Viewer;
  moderator: boolean;
}

const POST_REASONS: Record<string, string> = {
  archived: 'This group is archived.',
  not_member: 'Join the group to post in it.',
  muted: 'You cannot post in this group for now.',
  students_read_only: 'Only staff post in this group.',
  locked: 'This topic is locked.',
  parent: 'Family accounts read the community but do not post.',
};

/**
 * Community (docs/02 section 31, slice 25): groups (clubs, school-wide and one per class), topics and
 * replies, reactions, subscriptions, a rule-based check that holds a student's words for a teacher,
 * reports, a moderation queue and an audit line for every moderator action.
 */
@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  // Groups ------------------------------------------------------------------------------------------

  async listGroups(q: ListGroupsQuery, actor: AuthenticatedUser) {
    const reach = reachableOrganizationIds(actor);
    const schoolWide = isSchoolModerator(actor.role);
    const where: Prisma.CommunityGroupWhereInput = {
      ...organizationScope(actor),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.q ? { name: { contains: q.q } } : {}),
    };
    if (q.mine === 'true') {
      where.members = {
        some: { userId: actor.id, status: { in: ['active', 'pending'] } },
      };
    } else {
      where.status = 'active';
      if (!schoolWide) {
        where.OR = [
          { visibility: 'school' },
          { joinPolicy: { in: ['open', 'approval'] } },
          { members: { some: { userId: actor.id, status: 'active' } } },
        ];
      }
    }
    if (reach !== 'all' && reach.length === 0)
      return PagedResponse.of([], q, 0);
    const [rows, total, mine] = await Promise.all([
      this.prisma.communityGroup.findMany({
        where,
        include: GROUP_INCLUDE,
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.communityGroup.count({ where }),
      this.prisma.communityMember.findMany({ where: { userId: actor.id } }),
    ]);
    const byGroup = new Map(mine.map((m) => [m.groupId, m]));
    return PagedResponse.of(
      rows.map((g) => this.toGroup(g, byGroup.get(g.id) ?? null, actor)),
      q,
      total,
    );
  }

  async createGroup(dto: CreateGroupDto, actor: AuthenticatedUser) {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const id = newId();
    await this.prisma.communityGroup.create({
      data: {
        id,
        organizationId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        kind: dto.kind ?? 'club',
        visibility: dto.visibility ?? 'school',
        joinPolicy: dto.joinPolicy ?? 'open',
        studentsCanPost: dto.studentsCanPost ?? true,
        createdById: actor.id,
        members: {
          create: { id: newId(), userId: actor.id, role: 'moderator' },
        },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'community.group.create',
      entityType: 'CommunityGroup',
      entityId: id,
      details: { name: dto.name, kind: dto.kind ?? 'club' },
    });
    return this.getGroup(id, actor);
  }

  async getGroup(id: string, actor: AuthenticatedUser) {
    const { group, member } = await this.load(id, actor);
    return this.toGroup(group, member, actor);
  }

  async updateGroup(id: string, dto: UpdateGroupDto, actor: AuthenticatedUser) {
    const { group, moderator } = await this.load(id, actor);
    if (!moderator) throw this.forbid('Only moderators change a group.');
    await this.prisma.communityGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.visibility !== undefined && group.kind !== 'class'
          ? { visibility: dto.visibility }
          : {}),
        ...(dto.joinPolicy !== undefined && group.kind !== 'class'
          ? { joinPolicy: dto.joinPolicy }
          : {}),
        ...(dto.studentsCanPost !== undefined
          ? { studentsCanPost: dto.studentsCanPost }
          : {}),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: group.organizationId,
      action: 'community.group.update',
      entityType: 'CommunityGroup',
      entityId: id,
      details: { ...dto },
    });
    return this.getGroup(id, actor);
  }

  async archiveGroup(id: string, actor: AuthenticatedUser, restore = false) {
    const { group, moderator } = await this.load(id, actor);
    if (!moderator) throw this.forbid('Only moderators archive a group.');
    await this.prisma.communityGroup.update({
      where: { id },
      data: { status: restore ? 'active' : 'archived' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: group.organizationId,
      action: restore ? 'community.group.restore' : 'community.group.archive',
      entityType: 'CommunityGroup',
      entityId: id,
    });
    return this.getGroup(id, actor);
  }

  /** The class discussion group, created on first open; membership follows the roster each time. */
  async classDiscussion(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        teachers: { select: { teacherId: true } },
        enrollments: {
          where: { status: 'ENROLLED' },
          select: {
            student: {
              select: {
                userId: true,
                guardians: { select: { guardianUserId: true } },
              },
            },
          },
        },
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'class.not_found',
        detail: 'Class not found.',
      });
    const enrolled = klass.enrollments.some(
      (e) => e.student.userId === actor.id,
    );
    const parentOf = klass.enrollments.some((e) =>
      e.student.guardians.some((g) => g.guardianUserId === actor.id),
    );
    const staffHere =
      actor.organizationId === klass.organizationId &&
      isSchoolModerator(actor.role);
    if (!canManage(klass, actor) && !enrolled && !parentOf && !staffHere) {
      throw this.forbid('You are not part of this class.');
    }
    let group = await this.prisma.communityGroup.findUnique({
      where: { classId },
    });
    if (!group) {
      group = await this.prisma.communityGroup.create({
        data: {
          id: newId(),
          organizationId: klass.organizationId,
          classId,
          name: classGroupName(klass.name),
          description:
            'Questions, ideas and help for this class. Teachers see everything here.',
          kind: 'class',
          visibility: 'members',
          joinPolicy: 'invite',
          createdById: actor.id,
        },
      });
    }
    const wanted = classMembership(
      klass.enrollments.map((e) => e.student.userId),
      klass.teachers.map((t) => t.teacherId),
    );
    const existing = await this.prisma.communityMember.findMany({
      where: { groupId: group.id },
    });
    const have = new Map(existing.map((m) => [m.userId, m]));
    for (const w of wanted) {
      const m = have.get(w.userId);
      if (!m) {
        await this.prisma.communityMember.create({
          data: {
            id: newId(),
            groupId: group.id,
            userId: w.userId,
            role: w.role,
          },
        });
      } else if (m.role !== w.role && w.role === 'moderator') {
        await this.prisma.communityMember.update({
          where: { id: m.id },
          data: { role: 'moderator', status: 'active' },
        });
      }
    }
    if (parentOf && !enrolled && !canManage(klass, actor) && !staffHere) {
      // Family reads along: a parent of an enrolled student sees the class discussion without posting.
      await this.prisma.communityMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: actor.id } },
        create: {
          id: newId(),
          groupId: group.id,
          userId: actor.id,
          role: 'member',
        },
        update: {},
      });
    }
    return this.getGroup(group.id, actor);
  }

  async join(id: string, actor: AuthenticatedUser) {
    const group = await this.prisma.communityGroup.findUnique({
      where: { id },
      include: GROUP_INCLUDE,
    });
    if (!group) throw this.notFound();
    const member = await this.membership(id, actor.id);
    const outcome = joinOutcome(
      group,
      this.viewerOf(actor, group.organizationId),
      member,
    );
    if (outcome === 'not_allowed') {
      throw new ForbiddenException({
        code: 'community.join_not_allowed',
        detail:
          'You cannot join this group yourself. Ask a moderator to add you.',
      });
    }
    if (outcome !== 'already') {
      await this.prisma.communityMember.upsert({
        where: { groupId_userId: { groupId: id, userId: actor.id } },
        create: {
          id: newId(),
          groupId: id,
          userId: actor.id,
          role: 'member',
          status: outcome,
        },
        update: { status: outcome, role: 'member', mutedUntil: null },
      });
      if (outcome === 'pending') {
        await this.notifyModerators(
          group,
          `Someone asked to join ${group.name}`,
          'Open the members list to approve or decline.',
          `/community/groups/${id}?tab=members`,
        );
      }
    }
    return this.getGroup(id, actor);
  }

  async leave(id: string, actor: AuthenticatedUser) {
    const group = await this.prisma.communityGroup.findUnique({
      where: { id },
    });
    if (!group) throw this.notFound();
    if (group.kind === 'class')
      throw new BadRequestException({
        code: 'community.class_group',
        detail: 'Class discussions follow the class roster.',
      });
    await this.prisma.communityMember.updateMany({
      where: { groupId: id, userId: actor.id },
      data: { status: 'removed' },
    });
  }

  async listMembers(id: string, actor: AuthenticatedUser) {
    const { group, member, moderator } = await this.load(id, actor);
    if (!moderator && member?.status !== 'active')
      throw this.forbid('Members see the members list.');
    const rows = await this.prisma.communityMember.findMany({
      where: {
        groupId: group.id,
        status: moderator ? { in: ['active', 'pending'] } : 'active',
      },
      include: { user: NAME },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
    });
    return rows.map((m) => ({
      userId: m.userId,
      name: fullName(m.user),
      role: m.user.role.toLowerCase(),
      memberRole: m.role,
      status: m.status,
      mutedUntil: m.mutedUntil,
      joinedAt: m.joinedAt,
    }));
  }

  async addMember(id: string, dto: AddMemberDto, actor: AuthenticatedUser) {
    const { group, moderator } = await this.load(id, actor);
    if (!moderator) throw this.forbid('Only moderators add members.');
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!user || user.organizationId !== group.organizationId) {
      throw new BadRequestException({
        code: 'community.user_not_here',
        detail: 'That person is not at this school.',
      });
    }
    await this.prisma.communityMember.upsert({
      where: { groupId_userId: { groupId: id, userId: dto.userId } },
      create: {
        id: newId(),
        groupId: id,
        userId: dto.userId,
        role: dto.role ?? 'member',
      },
      update: { status: 'active', role: dto.role ?? 'member' },
    });
    await this.notifications.notify([dto.userId], {
      category: 'COMMUNITY',
      title: `You were added to ${group.name}`,
      link: `/community/groups/${id}`,
      entityType: 'CommunityGroup',
      entityId: id,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: group.organizationId,
      action: 'community.member.add',
      entityType: 'CommunityGroup',
      entityId: id,
      details: { userId: dto.userId, role: dto.role ?? 'member' },
    });
    return this.listMembers(id, actor);
  }

  async updateMember(
    id: string,
    userId: string,
    dto: UpdateMemberDto,
    actor: AuthenticatedUser,
  ) {
    const { group, moderator } = await this.load(id, actor);
    if (!moderator) throw this.forbid('Only moderators change members.');
    const target = await this.membership(id, userId);
    if (!target)
      throw new NotFoundException({
        code: 'community.member_not_found',
        detail: 'Not a member.',
      });
    const now = new Date();
    const data: Prisma.CommunityMemberUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.muteDays !== undefined)
      data.mutedUntil =
        dto.muteDays === 0 ? null : muteUntil(dto.muteDays, now);
    await this.prisma.communityMember.update({
      where: { id: target.id },
      data,
    });
    if (dto.status === 'active' && target.status === 'pending') {
      await this.notifications.notify([userId], {
        category: 'COMMUNITY',
        title: `You are now in ${group.name}`,
        link: `/community/groups/${id}`,
        entityType: 'CommunityGroup',
        entityId: id,
      });
    }
    if (dto.muteDays) {
      await this.notifications.notify([userId], {
        category: 'COMMUNITY',
        title: `Posting paused in ${group.name}`,
        body: `A moderator paused your posting for ${dto.muteDays} day${dto.muteDays === 1 ? '' : 's'}. You can still read.`,
        link: `/community/groups/${id}`,
        entityType: 'CommunityGroup',
        entityId: id,
      });
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: group.organizationId,
      action: 'community.member.update',
      entityType: 'CommunityGroup',
      entityId: id,
      details: { userId, ...dto },
    });
    return this.listMembers(id, actor);
  }

  async removeMember(id: string, userId: string, actor: AuthenticatedUser) {
    const { group, moderator } = await this.load(id, actor);
    if (!moderator) throw this.forbid('Only moderators remove members.');
    await this.prisma.communityMember.updateMany({
      where: { groupId: id, userId },
      data: { status: 'removed' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: group.organizationId,
      action: 'community.member.remove',
      entityType: 'CommunityGroup',
      entityId: id,
      details: { userId },
    });
  }

  // Topics and posts --------------------------------------------------------------------------------

  async listTopics(
    groupId: string,
    q: ListTopicsQuery,
    actor: AuthenticatedUser,
  ) {
    const loaded = await this.load(groupId, actor);
    const where: Prisma.CommunityTopicWhereInput = {
      groupId,
      ...(q.q
        ? { OR: [{ title: { contains: q.q } }, { body: { contains: q.q } }] }
        : {}),
      ...(loaded.moderator
        ? {}
        : {
            OR: [
              { status: 'visible' },
              { authorId: actor.id, status: { in: ['held', 'hidden'] } },
            ],
          }),
    };
    if (q.q && !loaded.moderator) {
      where.AND = [
        { OR: [{ title: { contains: q.q } }, { body: { contains: q.q } }] },
        { OR: where.OR },
      ];
      delete where.OR;
    }
    const [rows, total] = await Promise.all([
      this.prisma.communityTopic.findMany({
        where,
        include: { author: NAME },
        orderBy: [
          { pinned: 'desc' },
          { lastPostAt: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.communityTopic.count({ where }),
    ]);
    return PagedResponse.of(
      rankTopics(rows).map((t) => this.toTopic(t, loaded, actor)),
      q,
      total,
    );
  }

  async createTopic(
    groupId: string,
    dto: CreateTopicDto,
    actor: AuthenticatedUser,
  ) {
    const loaded = await this.load(groupId, actor);
    this.assertCanPost(loaded, actor);
    const screen = screenText(`${dto.title}\n${dto.body}`, actor.role);
    const now = new Date();
    const id = newId();
    await this.prisma.communityTopic.create({
      data: {
        id,
        groupId,
        authorId: actor.id,
        title: dto.title.trim(),
        body: dto.body.trim(),
        status: screen.ok ? 'visible' : 'held',
        holdReason: screen.ok ? null : screen.reason,
        lastPostAt: now,
        subscriptions: { create: { id: newId(), userId: actor.id } },
      },
    });
    if (!screen.ok) await this.notifyHeld(loaded.group, 'topic', id, dto.title);
    this.events.emit(
      'community.topic.created',
      domainEvent({
        eventType: 'community.topic.created',
        entityType: 'CommunityTopic',
        entityId: id,
        organizationId: loaded.group.organizationId,
        actorId: actor.id,
        data: { groupId, held: !screen.ok },
      }),
    );
    return this.getTopic(id, actor);
  }

  async getTopic(id: string, actor: AuthenticatedUser) {
    const topic = await this.prisma.communityTopic.findUnique({
      where: { id },
      include: { author: NAME },
    });
    if (!topic) throw this.notFound('Topic');
    const loaded = await this.load(topic.groupId, actor);
    if (!canSeeContent(topic, actor.id, loaded.moderator))
      throw this.notFound('Topic');
    const [posts, subscription] = await Promise.all([
      this.prisma.communityPost.findMany({
        where: {
          topicId: id,
          ...(loaded.moderator
            ? {}
            : {
                OR: [
                  { status: 'visible' },
                  { authorId: actor.id, status: { in: ['held', 'hidden'] } },
                ],
              }),
        },
        include: {
          author: NAME,
          reactions: { select: { userId: true, kind: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.topicSubscription.findUnique({
        where: { topicId_userId: { topicId: id, userId: actor.id } },
      }),
    ]);
    const check = canPost(
      loaded.group,
      loaded.viewer,
      loaded.member,
      new Date(),
      topic,
    );
    return {
      ...this.toTopic(topic, loaded, actor),
      group: this.toGroup(loaded.group, loaded.member, actor),
      posts: posts.map((p) => this.toPost(p, loaded, actor)),
      subscribed: !!subscription,
      canReply: check.ok,
      replyBlockedReason: check.ok
        ? null
        : (POST_REASONS[check.reason ?? ''] ?? null),
    };
  }

  async updateTopic(id: string, dto: UpdateTopicDto, actor: AuthenticatedUser) {
    const topic = await this.prisma.communityTopic.findUnique({
      where: { id },
    });
    if (!topic) throw this.notFound('Topic');
    const loaded = await this.load(topic.groupId, actor);
    const now = new Date();
    const data: Prisma.CommunityTopicUpdateInput = {};
    if (dto.title !== undefined || dto.body !== undefined) {
      if (!canEditContent(topic, actor.id, loaded.moderator, now))
        throw this.forbid('You can no longer change this.');
      const title = dto.title?.trim() ?? topic.title;
      const body = dto.body?.trim() ?? topic.body;
      const screen = screenText(`${title}\n${body}`, actor.role);
      Object.assign(data, {
        title,
        body,
        status: screen.ok
          ? topic.status === 'held'
            ? 'visible'
            : topic.status
          : 'held',
        holdReason: screen.ok ? null : screen.reason,
      });
      if (!screen.ok) await this.notifyHeld(loaded.group, 'topic', id, title);
    }
    if (dto.pinned !== undefined || dto.locked !== undefined) {
      if (!loaded.moderator)
        throw this.forbid('Only moderators pin or lock topics.');
      if (dto.pinned !== undefined) data.pinned = dto.pinned;
      if (dto.locked !== undefined) data.locked = dto.locked;
      await this.audit.record({
        userId: actor.id,
        organizationId: loaded.group.organizationId,
        action: 'community.topic.update',
        entityType: 'CommunityTopic',
        entityId: id,
        details: { pinned: dto.pinned, locked: dto.locked },
      });
    }
    await this.prisma.communityTopic.update({ where: { id }, data });
    return this.getTopic(id, actor);
  }

  async deleteTopic(id: string, actor: AuthenticatedUser) {
    const topic = await this.prisma.communityTopic.findUnique({
      where: { id },
    });
    if (!topic) throw this.notFound('Topic');
    const loaded = await this.load(topic.groupId, actor);
    if (topic.authorId !== actor.id && !loaded.moderator)
      throw this.forbid('Only the author or a moderator removes a topic.');
    await this.prisma.communityTopic.update({
      where: { id },
      data: { status: 'removed' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: loaded.group.organizationId,
      action: 'community.topic.remove',
      entityType: 'CommunityTopic',
      entityId: id,
      details: { own: topic.authorId === actor.id },
    });
  }

  async createPost(
    topicId: string,
    dto: CreatePostDto,
    actor: AuthenticatedUser,
  ) {
    const topic = await this.prisma.communityTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw this.notFound('Topic');
    const loaded = await this.load(topic.groupId, actor);
    if (!canSeeContent(topic, actor.id, loaded.moderator))
      throw this.notFound('Topic');
    if (topic.status !== 'visible' && !loaded.moderator)
      throw this.forbid('This topic is not open for replies.');
    this.assertCanPost(loaded, actor, topic);
    const screen = screenText(dto.body, actor.role);
    const now = new Date();
    const id = newId();
    await this.prisma.$transaction([
      this.prisma.communityPost.create({
        data: {
          id,
          topicId,
          authorId: actor.id,
          body: dto.body.trim(),
          status: screen.ok ? 'visible' : 'held',
          holdReason: screen.ok ? null : screen.reason,
        },
      }),
      this.prisma.topicSubscription.upsert({
        where: { topicId_userId: { topicId, userId: actor.id } },
        create: { id: newId(), topicId, userId: actor.id },
        update: {},
      }),
      ...(screen.ok
        ? [
            this.prisma.communityTopic.update({
              where: { id: topicId },
              data: { postCount: { increment: 1 }, lastPostAt: now },
            }),
          ]
        : []),
    ]);
    if (screen.ok) {
      await this.notifyReply(topic, actor);
    } else {
      await this.notifyHeld(loaded.group, 'post', id, topic.title);
    }
    this.events.emit(
      'community.post.created',
      domainEvent({
        eventType: 'community.post.created',
        entityType: 'CommunityPost',
        entityId: id,
        organizationId: loaded.group.organizationId,
        actorId: actor.id,
        data: { topicId, groupId: topic.groupId, held: !screen.ok },
      }),
    );
    const post = await this.prisma.communityPost.findUniqueOrThrow({
      where: { id },
      include: {
        author: NAME,
        reactions: { select: { userId: true, kind: true } },
      },
    });
    return this.toPost(post, loaded, actor);
  }

  async updatePost(id: string, dto: UpdatePostDto, actor: AuthenticatedUser) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id },
      include: { topic: { select: { groupId: true, title: true } } },
    });
    if (!post) throw this.notFound('Reply');
    const loaded = await this.load(post.topic.groupId, actor);
    if (!canEditContent(post, actor.id, loaded.moderator, new Date()))
      throw this.forbid('You can no longer change this.');
    const screen = screenText(dto.body, actor.role);
    const wasVisible = post.status === 'visible';
    const status = screen.ok
      ? post.status === 'held'
        ? 'visible'
        : post.status
      : 'held';
    await this.prisma.$transaction([
      this.prisma.communityPost.update({
        where: { id },
        data: {
          body: dto.body.trim(),
          editedAt: new Date(),
          status,
          holdReason: screen.ok ? null : screen.reason,
        },
      }),
      ...(wasVisible && status === 'held'
        ? [
            this.prisma.communityTopic.update({
              where: { id: post.topicId },
              data: { postCount: { decrement: 1 } },
            }),
          ]
        : !wasVisible && status === 'visible'
          ? [
              this.prisma.communityTopic.update({
                where: { id: post.topicId },
                data: { postCount: { increment: 1 } },
              }),
            ]
          : []),
    ]);
    if (!screen.ok)
      await this.notifyHeld(loaded.group, 'post', id, post.topic.title);
    const row = await this.prisma.communityPost.findUniqueOrThrow({
      where: { id },
      include: {
        author: NAME,
        reactions: { select: { userId: true, kind: true } },
      },
    });
    return this.toPost(row, loaded, actor);
  }

  async deletePost(id: string, actor: AuthenticatedUser) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id },
      include: { topic: { select: { groupId: true } } },
    });
    if (!post) throw this.notFound('Reply');
    const loaded = await this.load(post.topic.groupId, actor);
    if (post.authorId !== actor.id && !loaded.moderator)
      throw this.forbid('Only the author or a moderator removes a reply.');
    await this.setPostStatus(post, 'removed');
    await this.audit.record({
      userId: actor.id,
      organizationId: loaded.group.organizationId,
      action: 'community.post.remove',
      entityType: 'CommunityPost',
      entityId: id,
      details: { own: post.authorId === actor.id },
    });
  }

  async react(postId: string, kind: string, actor: AuthenticatedUser) {
    const post = await this.prisma.communityPost.findUnique({
      where: { id: postId },
      include: { topic: { select: { groupId: true } } },
    });
    if (!post) throw this.notFound('Reply');
    const loaded = await this.load(post.topic.groupId, actor);
    if (!canSeeContent(post, actor.id, loaded.moderator))
      throw this.notFound('Reply');
    await this.prisma.communityReaction.upsert({
      where: { postId_userId: { postId, userId: actor.id } },
      create: { id: newId(), postId, userId: actor.id, kind },
      update: { kind },
    });
    return this.reactionsOf(postId, actor.id);
  }

  async unreact(postId: string, actor: AuthenticatedUser) {
    await this.prisma.communityReaction.deleteMany({
      where: { postId, userId: actor.id },
    });
    return this.reactionsOf(postId, actor.id);
  }

  async subscribe(topicId: string, actor: AuthenticatedUser, on: boolean) {
    const topic = await this.prisma.communityTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw this.notFound('Topic');
    await this.load(topic.groupId, actor);
    if (on) {
      await this.prisma.topicSubscription.upsert({
        where: { topicId_userId: { topicId, userId: actor.id } },
        create: { id: newId(), topicId, userId: actor.id },
        update: {},
      });
    } else {
      await this.prisma.topicSubscription.deleteMany({
        where: { topicId, userId: actor.id },
      });
    }
    return { subscribed: on };
  }

  /** Recent activity across the groups you belong to or moderate. */
  async feed(actor: AuthenticatedUser) {
    const schoolWide = isSchoolModerator(actor.role);
    const rows = await this.prisma.communityTopic.findMany({
      where: {
        status: 'visible',
        group: {
          ...organizationScope(actor),
          status: 'active',
          ...(schoolWide
            ? {}
            : {
                OR: [
                  { members: { some: { userId: actor.id, status: 'active' } } },
                  { visibility: 'school' },
                ],
              }),
        },
      },
      include: {
        author: NAME,
        group: { select: { id: true, name: true, kind: true } },
      },
      orderBy: [{ lastPostAt: 'desc' }],
      take: 20,
    });
    return rows.map((t) => ({
      id: t.id,
      groupId: t.groupId,
      groupName: t.group.name,
      groupKind: t.group.kind,
      title: t.title,
      author: fullName(t.author),
      pinned: t.pinned,
      locked: t.locked,
      postCount: t.postCount,
      lastPostAt: t.lastPostAt,
      createdAt: t.createdAt,
    }));
  }

  // Reports and moderation --------------------------------------------------------------------------

  async report(dto: ReportDto, actor: AuthenticatedUser) {
    const target = await this.target(dto.targetType, dto.targetId);
    const loaded = await this.load(target.groupId, actor);
    if (!canSeeContent(target, actor.id, loaded.moderator))
      throw this.notFound();
    const id = newId();
    await this.prisma.communityReport.create({
      data: {
        id,
        organizationId: loaded.group.organizationId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reporterId: actor.id,
        reason: dto.reason,
        details: dto.details?.trim() || null,
      },
    });
    await this.notifyModerators(
      loaded.group,
      `A ${dto.targetType === 'topic' ? 'topic' : 'reply'} in ${loaded.group.name} was reported`,
      `Reason: ${dto.reason.replace('_', ' ')}. Open the moderation queue to decide.`,
      '/community?tab=moderation',
      true,
    );
    await this.audit.record({
      userId: actor.id,
      organizationId: loaded.group.organizationId,
      action: 'community.report.create',
      entityType: 'CommunityReport',
      entityId: id,
      details: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
      },
    });
    this.events.emit(
      'community.report.created',
      domainEvent({
        eventType: 'community.report.created',
        entityType: 'CommunityReport',
        entityId: id,
        organizationId: loaded.group.organizationId,
        actorId: actor.id,
        data: {
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason,
        },
      }),
    );
    return { id, status: 'open' };
  }

  /** Held words and open reports for the groups you moderate. */
  async moderationQueue(actor: AuthenticatedUser) {
    const groupWhere: Prisma.CommunityGroupWhereInput = isSchoolModerator(
      actor.role,
    )
      ? { ...organizationScope(actor) }
      : {
          ...organizationScope(actor),
          members: {
            some: { userId: actor.id, role: 'moderator', status: 'active' },
          },
        };
    const groups = await this.prisma.communityGroup.findMany({
      where: groupWhere,
      select: { id: true, name: true, organizationId: true },
    });
    const groupIds = groups.map((g) => g.id);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const [heldTopics, heldPosts, reports] = await Promise.all([
      this.prisma.communityTopic.findMany({
        where: { groupId: { in: groupIds }, status: 'held' },
        include: { author: NAME },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.communityPost.findMany({
        where: { status: 'held', topic: { groupId: { in: groupIds } } },
        include: {
          author: NAME,
          topic: { select: { id: true, title: true, groupId: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.communityReport.findMany({
        where: {
          status: 'open',
          organizationId: {
            in: Array.from(new Set(groups.map((g) => g.organizationId))),
          },
        },
        include: { reporter: NAME },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const held = [
      ...heldTopics.map((t) => ({
        type: 'topic' as const,
        id: t.id,
        topicId: t.id,
        groupId: t.groupId,
        groupName: byId.get(t.groupId)?.name ?? '',
        title: t.title,
        excerpt: t.body.slice(0, 300),
        author: fullName(t.author),
        authorId: t.authorId,
        reason: holdReasonText(t.holdReason),
        createdAt: t.createdAt,
      })),
      ...heldPosts.map((p) => ({
        type: 'post' as const,
        id: p.id,
        topicId: p.topic.id,
        groupId: p.topic.groupId,
        groupName: byId.get(p.topic.groupId)?.name ?? '',
        title: p.topic.title,
        excerpt: p.body.slice(0, 300),
        author: fullName(p.author),
        authorId: p.authorId,
        reason: holdReasonText(p.holdReason),
        createdAt: p.createdAt,
      })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const reportRows = [];
    for (const r of reports) {
      const t = await this.target(
        r.targetType as 'topic' | 'post',
        r.targetId,
      ).catch(() => null);
      if (!t || !groupIds.includes(t.groupId)) continue;
      reportRows.push({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        topicId: t.topicId,
        groupId: t.groupId,
        groupName: byId.get(t.groupId)?.name ?? '',
        title: t.title,
        excerpt: t.body.slice(0, 300),
        targetStatus: t.status,
        authorId: t.authorId,
        reason: r.reason,
        details: r.details,
        reporter: fullName(r.reporter),
        createdAt: r.createdAt,
      });
    }
    return {
      held,
      reports: reportRows,
      summary: queueSummary(held.length, reportRows.length),
    };
  }

  async moderate(
    type: 'topic' | 'post',
    id: string,
    dto: ModerateDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.target(type, id);
    const loaded = await this.load(target.groupId, actor);
    if (!loaded.moderator) throw this.forbid('Only moderators do this.');
    const status = statusAfterAction(dto.action);
    if (type === 'topic') {
      await this.prisma.communityTopic.update({
        where: { id },
        data: {
          status,
          holdReason: status === 'visible' ? null : target.holdReason,
        },
      });
    } else {
      await this.setPostStatus(
        { id, topicId: target.topicId, status: target.status },
        status,
      );
    }
    if (target.authorId && target.authorId !== actor.id) {
      const what = type === 'topic' ? 'topic' : 'reply';
      const titles: Record<ModerationAction, string> = {
        approve: `Your ${what} is now visible`,
        restore: `Your ${what} is back`,
        hide: `A moderator hid your ${what}`,
        remove: `A moderator removed your ${what}`,
      };
      await this.notifications.notify([target.authorId], {
        category: 'COMMUNITY',
        title: titles[dto.action],
        body:
          dto.note?.trim() ||
          (dto.action === 'approve'
            ? `In ${loaded.group.name}: "${target.title}".`
            : undefined),
        link:
          status === 'removed'
            ? `/community/groups/${target.groupId}`
            : `/community/topics/${target.topicId}`,
        entityType: type === 'topic' ? 'CommunityTopic' : 'CommunityPost',
        entityId: id,
      });
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: loaded.group.organizationId,
      action: `community.${type}.moderate`,
      entityType: type === 'topic' ? 'CommunityTopic' : 'CommunityPost',
      entityId: id,
      details: {
        action: dto.action,
        note: dto.note,
        from: target.status,
        to: status,
      },
    });
    return { id, type, status };
  }

  async resolveReport(
    id: string,
    dto: ResolveReportDto,
    actor: AuthenticatedUser,
  ) {
    const report = await this.prisma.communityReport.findUnique({
      where: { id },
    });
    if (!report || report.status !== 'open') throw this.notFound('Report');
    const target = await this.target(
      report.targetType as 'topic' | 'post',
      report.targetId,
    );
    const loaded = await this.load(target.groupId, actor);
    if (!loaded.moderator) throw this.forbid('Only moderators close reports.');
    const effect = resolutionEffect(dto.resolution);
    if (effect.status) {
      if (report.targetType === 'topic') {
        await this.prisma.communityTopic.update({
          where: { id: target.id },
          data: { status: effect.status },
        });
      } else {
        await this.setPostStatus(
          { id: target.id, topicId: target.topicId, status: target.status },
          effect.status,
        );
      }
    }
    await this.prisma.communityReport.update({
      where: { id },
      data: {
        status: 'closed',
        resolution: dto.resolution,
        resolvedById: actor.id,
        resolvedAt: new Date(),
        note: dto.note?.trim() || null,
      },
    });
    if (effect.notifyAuthor && target.authorId) {
      const what = report.targetType === 'topic' ? 'topic' : 'reply';
      const title =
        dto.resolution === 'warn'
          ? `A reminder about your ${what} in ${loaded.group.name}`
          : dto.resolution === 'hide'
            ? `A moderator hid your ${what}`
            : `A moderator removed your ${what}`;
      await this.notifications.notify([target.authorId], {
        category: 'COMMUNITY',
        title,
        body:
          dto.note?.trim() ||
          'Please keep the community guidelines in mind: be kind, stay on topic, and keep personal details out.',
        link:
          effect.status === 'removed'
            ? `/community/groups/${target.groupId}`
            : `/community/topics/${target.topicId}`,
        entityType: 'CommunityReport',
        entityId: id,
      });
    }
    await this.notifications.notify([report.reporterId], {
      category: 'COMMUNITY',
      title: 'Thanks for your report',
      body:
        dto.resolution === 'dismiss'
          ? 'A moderator looked at it and decided no change was needed.'
          : 'A moderator looked at it and took action.',
      link: `/community/groups/${target.groupId}`,
      entityType: 'CommunityReport',
      entityId: id,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: loaded.group.organizationId,
      action: 'community.report.resolve',
      entityType: 'CommunityReport',
      entityId: id,
      details: {
        resolution: dto.resolution,
        note: dto.note,
        targetType: report.targetType,
        targetId: report.targetId,
      },
    });
    return { id, status: 'closed', resolution: dto.resolution };
  }

  // Helpers -----------------------------------------------------------------------------------------

  private viewerOf(actor: AuthenticatedUser, organizationId: string): Viewer {
    const reaches =
      actor.role === 'SUPER_ADMIN' ||
      (actor.role === 'SUPERINTENDENT' &&
        (actor.tenantOrganizationIds ?? []).includes(organizationId));
    return {
      id: actor.id,
      role: actor.role,
      organizationId: actor.organizationId,
      reachesOrganization: reaches,
    };
  }

  private membership(groupId: string, userId: string) {
    return this.prisma.communityMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  }

  /** What the class roster says about this person: a teacher moderates, an enrolled student or their guardian reads and (students) posts. */
  private async rosterRole(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<'member' | 'moderator' | null> {
    const [teaches, enrolled, guardian] = await Promise.all([
      this.prisma.classTeacher.count({
        where: { classId, teacherId: actor.id },
      }),
      this.prisma.classEnrollment.count({
        where: { classId, status: 'ENROLLED', student: { userId: actor.id } },
      }),
      this.prisma.classEnrollment.count({
        where: {
          classId,
          status: 'ENROLLED',
          student: { guardians: { some: { guardianUserId: actor.id } } },
        },
      }),
    ]);
    if (teaches > 0) return 'moderator';
    if (enrolled > 0 || guardian > 0) return 'member';
    return null;
  }

  private async load(id: string, actor: AuthenticatedUser): Promise<Loaded> {
    const group = await this.prisma.communityGroup.findUnique({
      where: { id },
      include: GROUP_INCLUDE,
    });
    if (!group) throw this.notFound();
    let member = await this.membership(id, actor.id);
    const viewer = this.viewerOf(actor, group.organizationId);
    if (!canSeeGroup(group, viewer, member) && group.classId) {
      // A class discussion follows the roster: someone on it who has no row yet is added on first contact.
      const role = await this.rosterRole(group.classId, actor);
      if (role) {
        await this.prisma.communityMember.upsert({
          where: { groupId_userId: { groupId: id, userId: actor.id } },
          create: { id: newId(), groupId: id, userId: actor.id, role },
          update: { status: 'active', role },
        });
        member = await this.membership(id, actor.id);
      }
    }
    if (!canSeeGroup(group, viewer, member)) {
      throw new ForbiddenException({
        code: 'community.members_only',
        detail: 'This group is for its members.',
      });
    }
    return {
      group,
      member,
      viewer,
      moderator: canModerate(group, viewer, member),
    };
  }

  private assertCanPost(
    loaded: Loaded,
    actor: AuthenticatedUser,
    topic?: { locked: boolean },
  ) {
    const check = canPost(
      loaded.group,
      loaded.viewer,
      loaded.member,
      new Date(),
      topic,
    );
    if (!check.ok) {
      throw new ForbiddenException({
        code: `community.${check.reason}`,
        detail: POST_REASONS[check.reason ?? ''],
      });
    }
    void actor;
  }

  private toGroup(
    g: GroupRow,
    member: CommunityMember | null,
    actor: AuthenticatedUser,
  ) {
    const viewer = this.viewerOf(actor, g.organizationId);
    const moderator = canModerate(g, viewer, member);
    const post = canPost(g, viewer, member, new Date());
    return {
      id: g.id,
      organizationId: g.organizationId,
      classId: g.classId,
      className: g.class?.name ?? null,
      name: g.name,
      description: g.description,
      kind: g.kind,
      visibility: g.visibility,
      joinPolicy: g.joinPolicy,
      studentsCanPost: g.studentsCanPost,
      status: g.status,
      memberCount: g._count.members,
      topicCount: g._count.topics,
      membership:
        member && member.status !== 'removed'
          ? {
              role: member.role,
              status: member.status,
              mutedUntil: member.mutedUntil,
            }
          : null,
      canSee: canSeeGroup(g, viewer, member),
      canPost: post.ok,
      postBlockedReason: post.ok
        ? null
        : (POST_REASONS[post.reason ?? ''] ?? null),
      canModerate: moderator,
      joinOutcome: joinOutcome(g, viewer, member),
      createdAt: g.createdAt,
    };
  }

  private toTopic(t: TopicRow, loaded: Loaded, actor: AuthenticatedUser) {
    return {
      id: t.id,
      groupId: t.groupId,
      authorId: t.authorId,
      author: fullName(t.author),
      authorRole: t.author?.role.toLowerCase() ?? null,
      title: t.title,
      body: t.body,
      pinned: t.pinned,
      locked: t.locked,
      status: t.status,
      holdReason: holdReasonText(t.holdReason),
      postCount: t.postCount,
      lastPostAt: t.lastPostAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      canEdit: canEditContent(t, actor.id, loaded.moderator, new Date()),
      canModerate: loaded.moderator,
      own: t.authorId === actor.id,
    };
  }

  private toPost(p: PostRow, loaded: Loaded, actor: AuthenticatedUser) {
    const counts = Object.fromEntries(
      REACTION_KINDS.map((k) => [k, 0]),
    ) as Record<string, number>;
    let mine: string | null = null;
    for (const r of p.reactions) {
      counts[r.kind] = (counts[r.kind] ?? 0) + 1;
      if (r.userId === actor.id) mine = r.kind;
    }
    return {
      id: p.id,
      topicId: p.topicId,
      authorId: p.authorId,
      author: fullName(p.author),
      authorRole: p.author?.role.toLowerCase() ?? null,
      body: p.body,
      status: p.status,
      holdReason: holdReasonText(p.holdReason),
      editedAt: p.editedAt,
      createdAt: p.createdAt,
      reactions: counts,
      myReaction: mine,
      canEdit: canEditContent(p, actor.id, loaded.moderator, new Date()),
      own: p.authorId === actor.id,
    };
  }

  private async reactionsOf(postId: string, userId: string) {
    const rows = await this.prisma.communityReaction.findMany({
      where: { postId },
      select: { userId: true, kind: true },
    });
    const counts = Object.fromEntries(
      REACTION_KINDS.map((k) => [k, 0]),
    ) as Record<string, number>;
    let mine: string | null = null;
    for (const r of rows) {
      counts[r.kind] = (counts[r.kind] ?? 0) + 1;
      if (r.userId === userId) mine = r.kind;
    }
    return { reactions: counts, myReaction: mine };
  }

  /** A topic or post with the fields moderation needs, whichever it is. */
  private async target(type: 'topic' | 'post', id: string) {
    if (type === 'topic') {
      const t = await this.prisma.communityTopic.findUnique({ where: { id } });
      if (!t) throw this.notFound('Topic');
      return {
        id: t.id,
        topicId: t.id,
        groupId: t.groupId,
        title: t.title,
        body: t.body,
        status: t.status,
        authorId: t.authorId,
        holdReason: t.holdReason,
      };
    }
    const p = await this.prisma.communityPost.findUnique({
      where: { id },
      include: { topic: { select: { groupId: true, title: true } } },
    });
    if (!p) throw this.notFound('Reply');
    return {
      id: p.id,
      topicId: p.topicId,
      groupId: p.topic.groupId,
      title: p.topic.title,
      body: p.body,
      status: p.status,
      authorId: p.authorId,
      holdReason: p.holdReason,
    };
  }

  /** Changes a reply's state and keeps the topic's visible-reply count right. */
  private async setPostStatus(
    post: { id: string; topicId: string; status: string },
    status: string,
  ) {
    const delta =
      (post.status === 'visible' ? -1 : 0) + (status === 'visible' ? 1 : 0);
    await this.prisma.$transaction([
      this.prisma.communityPost.update({
        where: { id: post.id },
        data: { status, ...(status === 'visible' ? { holdReason: null } : {}) },
      }),
      ...(delta !== 0
        ? [
            this.prisma.communityTopic.update({
              where: { id: post.topicId },
              data: { postCount: { increment: delta } },
            }),
          ]
        : []),
    ]);
  }

  private async moderatorIds(
    group: { id: string; organizationId: string },
    includeSchool: boolean,
  ): Promise<string[]> {
    const members = await this.prisma.communityMember.findMany({
      where: { groupId: group.id, role: 'moderator', status: 'active' },
      select: { userId: true },
    });
    const ids = members.map((m) => m.userId);
    if (includeSchool || ids.length === 0) {
      const staff = await this.prisma.user.findMany({
        where: {
          organizationId: group.organizationId,
          role: { in: ['PRINCIPAL', 'COUNSELOR'] },
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      ids.push(...staff.map((s) => s.id));
    }
    return Array.from(new Set(ids));
  }

  private async notifyModerators(
    group: GroupRow | CommunityGroup,
    title: string,
    body: string,
    link: string,
    includeSchool = false,
  ) {
    const ids = await this.moderatorIds(group, includeSchool);
    await this.notifications.notify(ids, {
      category: 'COMMUNITY',
      title,
      body,
      link,
      entityType: 'CommunityGroup',
      entityId: group.id,
    });
  }

  private async notifyHeld(
    group: GroupRow,
    type: 'topic' | 'post',
    id: string,
    title: string,
  ) {
    await this.notifyModerators(
      group,
      `A ${type === 'topic' ? 'topic' : 'reply'} in ${group.name} is waiting for a look`,
      `"${title.slice(0, 80)}" was held by the safety check. Approve it or hide it in the moderation queue.`,
      '/community?tab=moderation',
    );
    void id;
  }

  private async notifyReply(topic: CommunityTopic, actor: AuthenticatedUser) {
    const subs = await this.prisma.topicSubscription.findMany({
      where: { topicId: topic.id },
      select: { userId: true },
    });
    const ids = postRecipients(
      subs.map((s) => s.userId),
      actor.id,
    );
    if (ids.length === 0) return;
    await this.notifications.notify(ids, {
      category: 'COMMUNITY',
      title: `New reply: ${topic.title.slice(0, 80)}`,
      link: `/community/topics/${topic.id}`,
      entityType: 'CommunityTopic',
      entityId: topic.id,
    });
  }

  private forbid(detail: string) {
    return new ForbiddenException({ code: 'authz.forbidden', detail });
  }

  private notFound(what = 'Group') {
    return new NotFoundException({
      code: 'community.not_found',
      detail: `${what} not found.`,
    });
  }
}
