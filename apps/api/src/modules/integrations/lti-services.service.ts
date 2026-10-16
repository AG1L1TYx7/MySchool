import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TtlCache } from '../../common/ttl-cache';
import {
  assertPublicHttpUrl,
  readBoundedText,
} from '../../common/outbound-url';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import type { LtiPlatform } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  autoPostForm,
  clientAssertionClaims,
  deepLinkContentItem,
  deepLinkingResponseClaims,
  DEEP_LINK_TTL_MS,
  LTI_SCOPE,
  membersToRoster,
  nextPageFrom,
  scorePayload,
  scoreUrl,
  type LaunchCheck,
  type LaunchClaims,
  type NrpsMember,
} from './integration-rules';
import { LtiService } from './lti.service';

const TOKEN_CACHE_MS = 50 * 60_000;
const MAX_PAGES = 20;
const MAX_BODY = 4 * 1024 * 1024;

/** What a deep-linking launch leaves behind while the teacher picks content (ten minutes). */
export interface DeepLinkTicket {
  platformId: string;
  organizationId: string;
  deploymentId: string;
  returnUrl: string;
  data: string | null;
  userId: string;
  contextLinkId: string | null;
  contextTitle: string | null;
  platformName: string;
}

/**
 * LTI 1.3 services when SmartSchool is the tool (slice 30): the platform's course is linked to a class
 * (`LtiContextLinks`), Names and Roles fills the class from the platform's roster, Assignment and Grade
 * Services pushes every posted grade to the platform's line item, and Deep Linking lets a teacher pick
 * SmartSchool assignments from inside the platform. Tokens come from the platform's token endpoint with
 * a client assertion signed by our LTI key.
 */
@Injectable()
export class LtiServicesService {
  private readonly log = new Logger(LtiServicesService.name);
  private readonly tokens = new TtlCache<string>(TOKEN_CACHE_MS);
  private readonly deepLinks = new TtlCache<DeepLinkTicket>(DEEP_LINK_TTL_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly lti: LtiService,
  ) {}

  // ---------------------------------------------------------------------------
  // Launch bookkeeping
  // ---------------------------------------------------------------------------

  /** Remembers the course and the service URLs a launch carried; links a line item to our assignment when it names one. */
  async recordLaunch(
    platform: LtiPlatform,
    check: LaunchCheck,
    claims: LaunchClaims,
  ): Promise<{ contextLinkId: string | null }> {
    if (!check.context.id) return { contextLinkId: null };
    const services = check.services;
    const existing = await this.prisma.ltiContextLink.findUnique({
      where: {
        platformId_contextId: {
          platformId: platform.id,
          contextId: check.context.id,
        },
      },
    });
    const data = {
      contextTitle: check.context.title ?? existing?.contextTitle ?? null,
      membershipsUrl:
        services.membershipsUrl ?? existing?.membershipsUrl ?? null,
      lineItemsUrl: services.lineItemsUrl ?? existing?.lineItemsUrl ?? null,
      scopes: services.scopes.length
        ? JSON.stringify(services.scopes)
        : (existing?.scopes ?? null),
    };
    const link = existing
      ? await this.prisma.ltiContextLink.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.ltiContextLink.create({
          data: {
            id: newId(),
            platformId: platform.id,
            contextId: check.context.id,
            ...data,
          },
        });
    const custom = (claims[
      'https://purl.imsglobal.org/spec/lti/claim/custom'
    ] ?? {}) as Record<string, unknown>;
    const assignmentId = custom.smartschool_assignment_id;
    if (
      check.messageType === 'LtiResourceLinkRequest' &&
      services.lineItemUrl &&
      typeof assignmentId === 'string'
    ) {
      const assignment = await this.prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          organizationId: platform.organizationId,
          deletedAt: null,
        },
        select: { id: true, classId: true },
      });
      if (assignment) {
        await this.prisma.ltiLineItemLink.upsert({
          where: {
            contextLinkId_assignmentId: {
              contextLinkId: link.id,
              assignmentId: assignment.id,
            },
          },
          create: {
            id: newId(),
            contextLinkId: link.id,
            assignmentId: assignment.id,
            lineItemUrl: services.lineItemUrl,
            resourceLinkId: check.resourceLinkId,
          },
          update: {
            lineItemUrl: services.lineItemUrl,
            resourceLinkId: check.resourceLinkId,
          },
        });
        // The first launch of a deep-linked assignment tells us which class the course is.
        if (!link.classId)
          await this.prisma.ltiContextLink.update({
            where: { id: link.id },
            data: { classId: assignment.classId },
          });
      }
    }
    return { contextLinkId: link.id };
  }

  // ---------------------------------------------------------------------------
  // Deep linking (the platform asks the teacher to pick content)
  // ---------------------------------------------------------------------------

  startDeepLink(
    platform: LtiPlatform,
    check: LaunchCheck,
    userId: string,
    contextLinkId: string | null,
  ): string {
    if (!check.deepLinking)
      throw new BadRequestException({
        code: 'lti.deep_linking',
        detail: 'The platform sent no deep linking settings.',
      });
    const id = randomBytes(24).toString('base64url');
    this.deepLinks.set(id, {
      platformId: platform.id,
      organizationId: platform.organizationId,
      deploymentId: check.deploymentId ?? platform.deploymentId ?? '',
      returnUrl: check.deepLinking.returnUrl,
      data: check.deepLinking.data,
      userId,
      contextLinkId,
      contextTitle: check.context.title,
      platformName: platform.name,
    });
    return id;
  }

  /** What the picker shows: the platform, the course, and the classes (with assignments) the person may offer. */
  async deepLinkContext(ticketId: string, actor: AuthenticatedUser) {
    const ticket = this.ticketFor(ticketId, actor);
    const teacherOnly = !isDistrictRole(actor) && actor.role !== 'PRINCIPAL';
    const classes = await this.prisma.class.findMany({
      where: {
        organizationId: ticket.organizationId,
        deletedAt: null,
        ...(teacherOnly ? { teachers: { some: { teacherId: actor.id } } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        name: true,
        section: true,
        assignments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true, title: true, maxPoints: true, status: true },
        },
      },
    });
    return {
      platform: ticket.platformName,
      context: ticket.contextTitle,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.section ? `${c.name} (${c.section})` : c.name,
        assignments: c.assignments.map((a) => ({
          id: a.id,
          title: a.title,
          maxPoints: Number(a.maxPoints),
          status: a.status.toLowerCase(),
        })),
      })),
    };
  }

  /** The signed deep-linking response the browser posts back to the platform; the ticket is spent. */
  async respondDeepLink(
    ticketId: string,
    assignmentIds: string[],
  ): Promise<string> {
    const ticket = this.deepLinks.get(ticketId);
    if (!ticket)
      throw new NotFoundException({
        code: 'lti.deep_link_expired',
        detail: 'This picker has expired. Open it again from your LMS.',
      });
    const ids = [...new Set(assignmentIds)].slice(0, 50);
    const assignments = ids.length
      ? await this.prisma.assignment.findMany({
          where: {
            id: { in: ids },
            organizationId: ticket.organizationId,
            deletedAt: null,
          },
          select: { id: true, title: true, maxPoints: true, classId: true },
        })
      : [];
    const platform = await this.prisma.ltiPlatform.findUnique({
      where: { id: ticket.platformId },
    });
    if (!platform)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Platform not found.',
      });
    const base = this.apiBase();
    const items = assignments.map((a) =>
      deepLinkContentItem({
        id: a.id,
        title: a.title,
        maxPoints: Number(a.maxPoints),
        launchUrl: `${base}/api/v1/lti/launch`,
        path: `/assignments/${a.id}`,
      }),
    );
    const jwt = await this.lti.signIdToken(
      deepLinkingResponseClaims({
        clientId: platform.clientId,
        issuer: platform.issuer,
        deploymentId: ticket.deploymentId,
        data: ticket.data,
        items,
        now: new Date(),
      }),
    );
    this.deepLinks.delete(ticketId);
    if (ticket.contextLinkId && assignments.length) {
      // The course is the class the picked assignments belong to, when they agree.
      const classIds = new Set(assignments.map((a) => a.classId));
      if (classIds.size === 1)
        await this.prisma.ltiContextLink.updateMany({
          where: { id: ticket.contextLinkId, classId: null },
          data: { classId: assignments[0].classId },
        });
    }
    await this.audit.record({
      userId: ticket.userId,
      organizationId: ticket.organizationId,
      action: 'lti.deep_link.respond',
      entityType: 'LtiPlatform',
      entityId: platform.id,
      details: { assignmentIds: assignments.map((a) => a.id) },
    });
    return autoPostForm(ticket.returnUrl, { JWT: jwt });
  }

  private ticketFor(id: string, actor: AuthenticatedUser): DeepLinkTicket {
    const ticket = this.deepLinks.get(id);
    if (!ticket)
      throw new NotFoundException({
        code: 'lti.deep_link_expired',
        detail: 'This picker has expired. Open it again from your LMS.',
      });
    if (ticket.userId !== actor.id)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'This picker belongs to another sign-in.',
      });
    return ticket;
  }

  // ---------------------------------------------------------------------------
  // Contexts (platform courses) and their class link
  // ---------------------------------------------------------------------------

  async listContexts(
    organizationId: string,
    platformId: string,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.ownPlatform(organizationId, platformId);
    const rows = await this.prisma.ltiContextLink.findMany({
      where: { platformId },
      orderBy: { createdAt: 'desc' },
      include: {
        class: { select: { id: true, name: true, section: true } },
        lineItems: {
          select: {
            assignmentId: true,
            lineItemUrl: true,
            lastPushAt: true,
            lastError: true,
            assignment: { select: { title: true } },
          },
        },
      },
    });
    return rows.map((r) => this.toPublicContext(r));
  }

  async linkContext(
    organizationId: string,
    platformId: string,
    id: string,
    classId: string | null,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.ownPlatform(organizationId, platformId);
    const link = await this.ownContext(platformId, id);
    if (classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: classId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!klass)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Class not found.',
        });
    }
    const updated = await this.prisma.ltiContextLink.update({
      where: { id: link.id },
      data: { classId },
      include: {
        class: { select: { id: true, name: true, section: true } },
        lineItems: {
          select: {
            assignmentId: true,
            lineItemUrl: true,
            lastPushAt: true,
            lastError: true,
            assignment: { select: { title: true } },
          },
        },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.context.link',
      entityType: 'LtiContextLink',
      entityId: link.id,
      details: { classId },
    });
    return this.toPublicContext(updated);
  }

  // ---------------------------------------------------------------------------
  // Names and Roles: fill the class from the platform's roster
  // ---------------------------------------------------------------------------

  async syncRoster(
    organizationId: string,
    platformId: string,
    id: string,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const platform = await this.ownPlatform(organizationId, platformId);
    const link = await this.ownContext(platformId, id);
    if (!link.classId)
      throw new BadRequestException({
        code: 'lti.context_unlinked',
        detail: 'Link this course to a class first.',
      });
    if (!link.membershipsUrl)
      throw new BadRequestException({
        code: 'lti.no_memberships',
        detail:
          'The platform did not offer Names and Roles for this course. Launch SmartSchool from the course once with the service enabled.',
      });
    const members = await this.fetchMembers(platform, link.membershipsUrl);
    const roster = membersToRoster(members);
    const counts = {
      members: members.length,
      users: 0,
      students: 0,
      teachers: 0,
      skipped: 0,
    };
    for (const m of roster) {
      if (!m.enrollable) {
        counts.skipped += 1;
        continue;
      }
      const user = await this.lti.ensureUser(
        platform.id,
        organizationId,
        m.subject,
        {
          email: m.email,
          name: m.name,
          roles: m.roles,
        },
      );
      counts.users += 1;
      if (m.isTeacher) {
        await this.prisma.classTeacher.upsert({
          where: {
            classId_teacherId: { classId: link.classId, teacherId: user.id },
          },
          create: { id: newId(), classId: link.classId, teacherId: user.id },
          update: {},
        });
        counts.teachers += 1;
        continue;
      }
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!student) {
        counts.skipped += 1;
        continue;
      }
      await this.prisma.classEnrollment.upsert({
        where: {
          classId_studentId: { classId: link.classId, studentId: student.id },
        },
        create: {
          id: newId(),
          classId: link.classId,
          studentId: student.id,
          status: 'ENROLLED',
          source: 'LTI',
          externalId: m.subject.slice(0, 128),
        },
        update: { status: 'ENROLLED', droppedAt: null },
      });
      counts.students += 1;
    }
    await this.prisma.ltiContextLink.update({
      where: { id: link.id },
      data: { lastSyncAt: new Date() },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.context.sync',
      entityType: 'LtiContextLink',
      entityId: link.id,
      details: counts,
    });
    return counts;
  }

  private async fetchMembers(
    platform: LtiPlatform,
    url: string,
  ): Promise<NrpsMember[]> {
    const token = await this.accessToken(platform, [LTI_SCOPE.memberships]);
    const members: NrpsMember[] = [];
    let next: string | null = url;
    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      await assertPublicHttpUrl(next, {
        allowLoopback: !this.config.isProduction,
      });
      const res = await fetch(next, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'manual',
      });
      if (!res.ok)
        throw new BadRequestException({
          code: 'lti.service_error',
          detail: `The platform's roster service answered HTTP ${res.status}.`,
        });
      const body = JSON.parse(await readBoundedText(res, MAX_BODY)) as {
        members?: NrpsMember[];
      };
      members.push(...(body.members ?? []));
      next = nextPageFrom(res.headers.get('link'));
    }
    return members;
  }

  // ---------------------------------------------------------------------------
  // Assignment and Grade Services: push grades to the platform
  // ---------------------------------------------------------------------------

  /** Called after a grade is posted: every platform line item linked to the assignment receives the score. */
  async pushScore(assignmentId: string, studentId: string): Promise<number> {
    const links = await this.prisma.ltiLineItemLink.findMany({
      where: { assignmentId },
      include: { contextLink: { include: { platform: true } } },
    });
    if (links.length === 0) return 0;
    const grade = await this.prisma.grade.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
    });
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { userId: true },
    });
    if (!grade || !student?.userId) return 0;
    let pushed = 0;
    for (const link of links) {
      const subject = await this.prisma.ltiUserLink.findFirst({
        where: {
          platformId: link.contextLink.platformId,
          userId: student.userId,
        },
        select: { subject: true },
      });
      if (!subject) continue;
      try {
        await this.postScore(link.contextLink.platform, link.lineItemUrl, {
          subject: subject.subject,
          score: Number(grade.score),
          max: Number(grade.maxPoints),
        });
        await this.prisma.ltiLineItemLink.update({
          where: { id: link.id },
          data: { lastPushAt: new Date(), lastError: null },
        });
        pushed += 1;
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);
        this.log.warn(`score push failed for ${link.lineItemUrl}: ${message}`);
        await this.prisma.ltiLineItemLink.update({
          where: { id: link.id },
          data: { lastError: message },
        });
      }
    }
    return pushed;
  }

  /** Re-sends every grade of every linked assignment of a course (after an outage, or a late link). */
  async pushAll(
    organizationId: string,
    platformId: string,
    id: string,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.ownPlatform(organizationId, platformId);
    const link = await this.ownContext(platformId, id);
    const items = await this.prisma.ltiLineItemLink.findMany({
      where: { contextLinkId: link.id },
      select: { assignmentId: true },
    });
    let pushed = 0;
    let grades = 0;
    for (const item of items) {
      const rows = await this.prisma.grade.findMany({
        where: { assignmentId: item.assignmentId },
        select: { studentId: true },
      });
      for (const g of rows) {
        grades += 1;
        pushed += await this.pushScore(item.assignmentId, g.studentId);
      }
    }
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.context.push_scores',
      entityType: 'LtiContextLink',
      entityId: link.id,
      details: { grades, pushed },
    });
    return { lineItems: items.length, grades, pushed };
  }

  private async postScore(
    platform: LtiPlatform,
    lineItemUrl: string,
    score: { subject: string; score: number; max: number },
  ): Promise<void> {
    const token = await this.accessToken(platform, [LTI_SCOPE.score]);
    const url = scoreUrl(lineItemUrl);
    await assertPublicHttpUrl(url, {
      allowLoopback: !this.config.isProduction,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/vnd.ims.lis.v1.score+json',
      },
      body: JSON.stringify(
        scorePayload(score.subject, score.score, score.max, new Date()),
      ),
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // ---------------------------------------------------------------------------
  // OAuth 2 client credentials with a signed client assertion (IMS Security Framework 4.1)
  // ---------------------------------------------------------------------------

  private async accessToken(
    platform: LtiPlatform,
    scopes: string[],
  ): Promise<string> {
    const key = `${platform.id}|${scopes.join(' ')}`;
    const cached = this.tokens.get(key);
    if (cached) return cached;
    if (!platform.tokenUrl)
      throw new BadRequestException({
        code: 'lti.no_token_url',
        detail:
          "The platform's token URL is not set; add it on the Integrations page.",
      });
    await assertPublicHttpUrl(platform.tokenUrl, {
      allowLoopback: !this.config.isProduction,
    });
    const assertion = await this.lti.signIdToken(
      clientAssertionClaims(
        platform.clientId,
        platform.tokenUrl,
        new Date(),
        newId(),
      ),
    );
    const res = await fetch(platform.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type:
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: scopes.join(' '),
      }).toString(),
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
    });
    if (!res.ok)
      throw new BadRequestException({
        code: 'lti.token_refused',
        detail: `The platform refused the service token (HTTP ${res.status}).`,
      });
    const body = JSON.parse(await readBoundedText(res, 64 * 1024)) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token)
      throw new BadRequestException({
        code: 'lti.token_refused',
        detail: 'The platform answered without an access token.',
      });
    this.tokens.set(key, body.access_token);
    return body.access_token;
  }

  // ---------------------------------------------------------------------------

  private async ownPlatform(organizationId: string, id: string) {
    const row = await this.prisma.ltiPlatform.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Platform not found.',
      });
    return row;
  }

  private async ownContext(platformId: string, id: string) {
    const row = await this.prisma.ltiContextLink.findFirst({
      where: { id, platformId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Course link not found.',
      });
    return row;
  }

  private toPublicContext(r: {
    id: string;
    contextId: string;
    contextTitle: string | null;
    classId: string | null;
    membershipsUrl: string | null;
    lineItemsUrl: string | null;
    lastSyncAt: Date | null;
    createdAt: Date;
    class: { id: string; name: string; section: string | null } | null;
    lineItems: Array<{
      assignmentId: string;
      lineItemUrl: string;
      lastPushAt: Date | null;
      lastError: string | null;
      assignment: { title: string };
    }>;
  }) {
    return {
      id: r.id,
      contextId: r.contextId,
      title: r.contextTitle,
      class: r.class
        ? {
            id: r.class.id,
            name: r.class.section
              ? `${r.class.name} (${r.class.section})`
              : r.class.name,
          }
        : null,
      services: {
        memberships: !!r.membershipsUrl,
        lineItems: !!r.lineItemsUrl,
      },
      lastSyncAt: r.lastSyncAt,
      lineItems: r.lineItems.map((l) => ({
        assignmentId: l.assignmentId,
        title: l.assignment.title,
        lastPushAt: l.lastPushAt,
        lastError: l.lastError,
      })),
      createdAt: r.createdAt,
    };
  }

  private apiBase(): string {
    return this.config.get('API_PUBLIC_URL').replace(/\/$/, '');
  }
}
