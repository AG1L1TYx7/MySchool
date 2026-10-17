import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import type { LtiTool } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  checkDeepLinkingResponse,
  lineItemView,
  LTI_SCOPE,
  ltiRolesFor,
  membershipsView,
  resultView,
  scoreToPercentage,
  signServiceToken,
  verifyServiceToken,
  type LineItemInput,
  type ScoreInput,
} from './integration-rules';
import { LtiError, LtiService } from './lti.service';

const TOKEN_TTL_SECONDS = 3600;
const ALL_SCOPES: readonly string[] = Object.values(LTI_SCOPE);

/**
 * LTI 1.3 services with SmartSchool as the platform (slice 30): tools SmartSchool launches get an OAuth 2
 * token from `/lti/token` with a client assertion signed by their own key, then read a class roster
 * (Names and Roles), own line items in a class and post scores that land in the gradebook (Assignment and
 * Grade Services), and place content in a class through Deep Linking.
 */
@Injectable()
export class LtiPlatformService {
  private readonly log = new Logger(LtiPlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly lti: LtiService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Token endpoint
  // ---------------------------------------------------------------------------

  async issueToken(params: Record<string, string | undefined>) {
    if (params.grant_type !== 'client_credentials')
      throw new BadRequestException({
        code: 'lti.grant',
        detail: 'Only client_credentials is supported.',
      });
    if (
      params.client_assertion_type !==
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' ||
      !params.client_assertion
    )
      throw new BadRequestException({
        code: 'lti.assertion',
        detail: 'A signed client assertion is required.',
      });
    const unverified = this.peek(params.client_assertion);
    const clientId = typeof unverified.iss === 'string' ? unverified.iss : '';
    const tool = clientId
      ? await this.prisma.ltiTool.findFirst({
          where: { clientId, isActive: true },
        })
      : null;
    if (!tool || !tool.jwksUrl)
      throw new UnauthorizedException({
        code: 'lti.unknown_client',
        detail: 'Unknown client, or the tool has no key set URL registered.',
      });
    let claims: Record<string, unknown>;
    try {
      claims = await this.lti.verifyToolJwt(
        params.client_assertion,
        tool.jwksUrl,
      );
    } catch (err) {
      throw new UnauthorizedException({
        code: 'lti.assertion',
        detail:
          err instanceof LtiError ? err.message : 'The assertion is not valid.',
      });
    }
    const sec = Math.floor(Date.now() / 1000);
    const tokenUrl = `${this.apiBase()}/api/v1/lti/token`;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== tool.clientId ||
      claims.sub !== tool.clientId ||
      !aud.includes(tokenUrl) ||
      typeof claims.exp !== 'number' ||
      claims.exp < sec - 60
    )
      throw new UnauthorizedException({
        code: 'lti.assertion',
        detail:
          'The assertion names the wrong client, audience or has expired.',
      });
    const asked = (params.scope ?? '').split(/\s+/).filter(Boolean);
    const scopes = asked.length
      ? asked.filter((s) => ALL_SCOPES.includes(s))
      : [...ALL_SCOPES];
    if (scopes.length === 0)
      throw new BadRequestException({
        code: 'lti.scope',
        detail: 'None of the requested scopes is offered.',
      });
    const token = signServiceToken(this.config.get('JWT_SECRET'), {
      tool: tool.id,
      scopes,
      exp: Date.now() + TOKEN_TTL_SECONDS * 1000,
    });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: scopes.join(' '),
    };
  }

  /** The tool behind a service call, or 401; the scope must be among the token's. */
  async authorize(
    authorization: string | undefined,
    scope: string | string[],
  ): Promise<LtiTool> {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : '';
    const payload = token
      ? verifyServiceToken(this.config.get('JWT_SECRET'), token, Date.now())
      : null;
    if (!payload)
      throw new UnauthorizedException({
        code: 'lti.token',
        detail: 'A valid service token is required.',
      });
    const wanted = Array.isArray(scope) ? scope : [scope];
    if (!wanted.some((s) => payload.scopes.includes(s)))
      throw new ForbiddenException({
        code: 'lti.scope',
        detail: `This token does not carry ${wanted.join(' or ')}.`,
      });
    const tool = await this.prisma.ltiTool.findFirst({
      where: { id: payload.tool, isActive: true },
    });
    if (!tool)
      throw new UnauthorizedException({
        code: 'lti.token',
        detail: 'The tool behind this token is gone.',
      });
    return tool;
  }

  // ---------------------------------------------------------------------------
  // Names and Roles
  // ---------------------------------------------------------------------------

  async memberships(tool: LtiTool, classId: string) {
    const klass = await this.toolClass(tool, classId);
    const [teachers, enrollments] = await Promise.all([
      this.prisma.classTeacher.findMany({
        where: { classId },
        include: { teacher: true },
      }),
      this.prisma.classEnrollment.findMany({
        where: { classId, status: 'ENROLLED' },
        include: { student: { include: { user: true } } },
      }),
    ]);
    return membershipsView(
      `${this.apiBase()}/api/v1/lti/nrps/classes/${classId}/memberships`,
      { id: klass.id, title: klass.name, label: klass.section ?? klass.name },
      [
        ...teachers
          .filter((t) => t.teacher.deletedAt === null)
          .map((t) => ({
            userId: t.teacher.id,
            email: t.teacher.email,
            firstName: t.teacher.firstName,
            lastName: t.teacher.lastName,
            roles: ltiRolesFor(t.teacher.role),
          })),
        ...enrollments
          .filter((e) => e.student.user && e.student.deletedAt === null)
          .map((e) => ({
            userId: e.student.user!.id,
            email: e.student.user!.email,
            firstName: e.student.firstName,
            lastName: e.student.lastName,
            roles: ltiRolesFor('STUDENT'),
          })),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Assignment and Grade Services
  // ---------------------------------------------------------------------------

  async lineItems(tool: LtiTool, classId: string) {
    await this.toolClass(tool, classId);
    const rows = await this.prisma.ltiLineItem.findMany({
      where: { toolId: tool.id, classId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => lineItemView(this.lineItemsBase(), r));
  }

  async createLineItem(tool: LtiTool, classId: string, input: LineItemInput) {
    const klass = await this.toolClass(tool, classId);
    this.assertLineItem(input);
    // A line item is an assignment in the class, so its scores reach the gradebook and the family home.
    const assignment = await this.prisma.assignment.create({
      data: {
        id: newId(),
        organizationId: klass.organizationId,
        classId,
        title: input.label.slice(0, 200),
        type: 'HOMEWORK',
        submissionType: 'EXTERNAL',
        maxPoints: input.scoreMaximum,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        description: `Graded in ${tool.name}.`,
      },
    });
    const row = await this.prisma.ltiLineItem.create({
      data: {
        id: newId(),
        toolId: tool.id,
        classId,
        assignmentId: assignment.id,
        label: input.label.slice(0, 200),
        scoreMaximum: input.scoreMaximum,
        resourceId: input.resourceId?.slice(0, 255) ?? null,
        resourceLinkId: input.resourceLinkId?.slice(0, 255) ?? null,
        tag: input.tag?.slice(0, 100) ?? null,
      },
    });
    await this.audit.record({
      userId: null,
      organizationId: klass.organizationId,
      action: 'lti.lineitem.create',
      entityType: 'LtiLineItem',
      entityId: row.id,
      details: { toolId: tool.id, classId, assignmentId: assignment.id },
    });
    return lineItemView(this.lineItemsBase(), row);
  }

  async getLineItem(tool: LtiTool, id: string) {
    const row = await this.ownLineItem(tool, id);
    return lineItemView(this.lineItemsBase(), row);
  }

  async updateLineItem(tool: LtiTool, id: string, input: LineItemInput) {
    const row = await this.ownLineItem(tool, id);
    this.assertLineItem(input);
    const updated = await this.prisma.ltiLineItem.update({
      where: { id: row.id },
      data: {
        label: input.label.slice(0, 200),
        scoreMaximum: input.scoreMaximum,
        resourceId: input.resourceId?.slice(0, 255) ?? row.resourceId,
        resourceLinkId:
          input.resourceLinkId?.slice(0, 255) ?? row.resourceLinkId,
        tag: input.tag?.slice(0, 100) ?? row.tag,
      },
    });
    if (row.assignmentId)
      await this.prisma.assignment.updateMany({
        where: { id: row.assignmentId, deletedAt: null },
        data: {
          title: input.label.slice(0, 200),
          maxPoints: input.scoreMaximum,
        },
      });
    return lineItemView(this.lineItemsBase(), updated);
  }

  async deleteLineItem(tool: LtiTool, id: string): Promise<void> {
    const row = await this.ownLineItem(tool, id);
    await this.prisma.ltiLineItem.delete({ where: { id: row.id } });
    if (row.assignmentId) {
      // The assignment stays when grades exist; an empty one goes with its line item.
      const graded = await this.prisma.grade.count({
        where: { assignmentId: row.assignmentId },
      });
      if (graded === 0)
        await this.prisma.assignment.updateMany({
          where: { id: row.assignmentId },
          data: { deletedAt: new Date() },
        });
    }
  }

  async postScore(tool: LtiTool, id: string, input: ScoreInput) {
    const row = await this.ownLineItem(tool, id);
    if (typeof input.userId !== 'string' || !input.userId)
      throw new BadRequestException({
        code: 'lti.score',
        detail: 'userId is required.',
      });
    const max =
      typeof input.scoreMaximum === 'number' && input.scoreMaximum > 0
        ? input.scoreMaximum
        : Number(row.scoreMaximum);
    const given =
      typeof input.scoreGiven === 'number' && Number.isFinite(input.scoreGiven)
        ? input.scoreGiven
        : null;
    const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
    if (Number.isNaN(timestamp.getTime()))
      throw new BadRequestException({
        code: 'lti.score',
        detail: 'timestamp must be an ISO date.',
      });
    const existing = await this.prisma.ltiScore.findUnique({
      where: {
        lineItemId_userId: { lineItemId: row.id, userId: input.userId },
      },
    });
    // Out-of-order updates lose (AGS 2.0 section 3.3.3): a score older than the one held is ignored.
    if (existing && existing.timestamp > timestamp) return { accepted: false };
    const data = {
      scoreGiven: given,
      scoreMaximum: max,
      activityProgress: String(input.activityProgress ?? 'Completed').slice(
        0,
        32,
      ),
      gradingProgress: String(input.gradingProgress ?? 'FullyGraded').slice(
        0,
        32,
      ),
      comment:
        typeof input.comment === 'string' ? input.comment.slice(0, 2000) : null,
      timestamp,
    };
    await this.prisma.ltiScore.upsert({
      where: {
        lineItemId_userId: { lineItemId: row.id, userId: input.userId },
      },
      create: {
        id: newId(),
        lineItemId: row.id,
        userId: input.userId,
        ...data,
      },
      update: data,
    });
    // A fully graded score with a value becomes a grade for the learner's student record.
    if (
      row.assignmentId &&
      given !== null &&
      data.gradingProgress === 'FullyGraded'
    ) {
      const student = await this.prisma.student.findFirst({
        where: { userId: input.userId, deletedAt: null },
        select: { id: true, organizationId: true },
      });
      if (student) {
        const gradeData = {
          score: given,
          maxPoints: max,
          percentage: scoreToPercentage(given, max),
          feedback: data.comment,
          gradedAt: timestamp,
        };
        const grade = await this.prisma.grade.upsert({
          where: {
            assignmentId_studentId: {
              assignmentId: row.assignmentId,
              studentId: student.id,
            },
          },
          create: {
            id: newId(),
            assignmentId: row.assignmentId,
            studentId: student.id,
            ...gradeData,
          },
          update: gradeData,
        });
        this.events.emit(
          'grade.posted',
          domainEvent({
            eventType: 'grade.posted',
            entityType: 'Grade',
            entityId: grade.id,
            organizationId: student.organizationId,
            actorId: null,
            data: {
              assignmentId: row.assignmentId,
              studentId: student.id,
              score: given,
              source: 'lti',
              toolId: tool.id,
            },
          }),
        );
      }
    }
    return { accepted: true };
  }

  async results(tool: LtiTool, id: string, userId?: string) {
    const row = await this.ownLineItem(tool, id);
    const scores = await this.prisma.ltiScore.findMany({
      where: { lineItemId: row.id, ...(userId ? { userId } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const base = `${this.lineItemsBase()}/${row.id}`;
    return scores.map((s) => resultView(base, s));
  }

  // ---------------------------------------------------------------------------
  // Deep Linking: a teacher picks content from the tool
  // ---------------------------------------------------------------------------

  /** The login initiation page for a deep-linking launch (the tool will answer with content items). */
  async deepLinkRequest(
    organizationId: string,
    toolId: string,
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<string> {
    assertOrganizationAccess(actor, organizationId);
    await this.assertTeaches(classId, actor);
    return this.lti.launchTool(organizationId, toolId, classId, actor, {
      deepLinking: true,
    });
  }

  /** The tool posted its signed response here: the content items become links (and line items) in the class. */
  async deepLinkReturn(
    jwt: string | undefined,
  ): Promise<{ classId: string; created: number }> {
    if (!jwt) throw new LtiError('params', 'JWT is required.');
    const unverified = this.peek(jwt);
    const clientId = typeof unverified.iss === 'string' ? unverified.iss : '';
    const tool = clientId
      ? await this.prisma.ltiTool.findFirst({
          where: { clientId, isActive: true },
        })
      : null;
    if (!tool || !tool.jwksUrl)
      throw new LtiError('unknown_client', 'Unknown tool, or no key set URL.');
    const claims = await this.lti.verifyToolJwt(jwt, tool.jwksUrl);
    const check = checkDeepLinkingResponse(claims, {
      clientId: tool.clientId,
      issuer: this.apiBase(),
      deploymentId: tool.deploymentId,
      now: new Date(),
    });
    if (!check.ok)
      throw new LtiError(
        `deep_link_${check.reason}`,
        'The response was refused.',
      );
    const state = check.data ? this.lti.readState(check.data) : null;
    if (
      !state ||
      state.tool !== tool.id ||
      typeof state.c !== 'string' ||
      typeof state.u !== 'string'
    )
      throw new LtiError(
        'deep_link_state',
        'The response does not match a request from SmartSchool.',
      );
    const klass = await this.prisma.class.findFirst({
      where: {
        id: state.c,
        organizationId: tool.organizationId,
        deletedAt: null,
      },
    });
    if (!klass) throw new LtiError('deep_link_class', 'The class is gone.');
    let created = 0;
    for (const item of check.items) {
      let lineItemId: string | null = null;
      if (item.lineItem) {
        const assignment = await this.prisma.assignment.create({
          data: {
            id: newId(),
            organizationId: klass.organizationId,
            classId: klass.id,
            createdById: state.u,
            title: (item.lineItem.label ?? item.title).slice(0, 200),
            type: 'HOMEWORK',
            submissionType: 'EXTERNAL',
            maxPoints: item.lineItem.scoreMaximum,
            status: 'PUBLISHED',
            publishedAt: new Date(),
            description: `Opens in ${tool.name}.`,
          },
        });
        const li = await this.prisma.ltiLineItem.create({
          data: {
            id: newId(),
            toolId: tool.id,
            classId: klass.id,
            assignmentId: assignment.id,
            label: (item.lineItem.label ?? item.title).slice(0, 200),
            scoreMaximum: item.lineItem.scoreMaximum,
            resourceId: item.lineItem.resourceId?.slice(0, 255) ?? null,
            tag: item.lineItem.tag?.slice(0, 100) ?? null,
          },
        });
        lineItemId = li.id;
      }
      await this.prisma.ltiToolLink.create({
        data: {
          id: newId(),
          toolId: tool.id,
          classId: klass.id,
          title: item.title.slice(0, 200),
          url: item.url,
          custom: item.custom ? JSON.stringify(item.custom) : null,
          lineItemId,
          createdById: state.u,
        },
      });
      created += 1;
    }
    await this.audit.record({
      userId: state.u,
      organizationId: klass.organizationId,
      action: 'lti.deep_link.return',
      entityType: 'LtiTool',
      entityId: tool.id,
      details: { classId: klass.id, created },
    });
    return { classId: klass.id, created };
  }

  /** The line items of a class with their tool and assignment, for the people of the class. */
  async classLineItems(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: { organizationId: true },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    const rows = await this.prisma.ltiLineItem.findMany({
      where: { classId },
      orderBy: { createdAt: 'asc' },
      include: {
        tool: { select: { id: true, name: true } },
        assignment: { select: { id: true, title: true, deletedAt: true } },
        _count: { select: { scores: true } },
      },
    });
    return rows
      .filter((r) => !r.assignment || r.assignment.deletedAt === null)
      .map((r) => ({
        id: r.id,
        label: r.label,
        scoreMaximum: Number(r.scoreMaximum),
        tool: r.tool,
        assignment: r.assignment
          ? { id: r.assignment.id, title: r.assignment.title }
          : null,
        scores: r._count.scores,
        createdAt: r.createdAt,
      }));
  }

  /**
   * An assignment made in SmartSchool gets a line item owned by a tool (slice 34): the tool sees it in its
   * line items for the class and posts scores to it, which become grades like any other.
   */
  async lineItemForAssignment(
    classId: string,
    assignmentId: string,
    toolId: string,
    actor: AuthenticatedUser,
  ) {
    await this.assertTeaches(classId, actor);
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, classId, deletedAt: null },
      select: { id: true, title: true, maxPoints: true, organizationId: true },
    });
    if (!assignment)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Assignment not found in this class.',
      });
    const tool = await this.prisma.ltiTool.findFirst({
      where: {
        id: toolId,
        organizationId: assignment.organizationId,
        isActive: true,
      },
    });
    if (!tool)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Tool not found.',
      });
    const row = await this.prisma.ltiLineItem.upsert({
      where: { assignmentId: assignment.id },
      create: {
        id: newId(),
        toolId: tool.id,
        classId,
        assignmentId: assignment.id,
        label: assignment.title.slice(0, 200),
        scoreMaximum: assignment.maxPoints,
        resourceId: assignment.id,
      },
      update: {
        toolId: tool.id,
        label: assignment.title.slice(0, 200),
        scoreMaximum: assignment.maxPoints,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: assignment.organizationId,
      action: 'lti.lineitem.assign',
      entityType: 'LtiLineItem',
      entityId: row.id,
      details: { toolId: tool.id, assignmentId: assignment.id },
    });
    return lineItemView(this.lineItemsBase(), row);
  }

  async linksForClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: { organizationId: true },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    const rows = await this.prisma.ltiToolLink.findMany({
      where: { classId, tool: { isActive: true } },
      orderBy: { createdAt: 'asc' },
      include: { tool: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      tool: r.tool,
      graded: r.lineItemId !== null,
      createdAt: r.createdAt,
    }));
  }

  async removeLink(classId: string, id: string, actor: AuthenticatedUser) {
    await this.assertTeaches(classId, actor);
    const row = await this.prisma.ltiToolLink.findFirst({
      where: { id, classId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Link not found.',
      });
    await this.prisma.ltiToolLink.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------

  private async assertTeaches(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        organizationId: true,
        teachers: { select: { teacherId: true } },
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    const staff =
      isDistrictRole(actor) ||
      actor.role === 'PRINCIPAL' ||
      klass.teachers.some((t) => t.teacherId === actor.id);
    if (!staff)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the teachers of this class place tool content in it.',
      });
  }

  private async toolClass(tool: LtiTool, classId: string) {
    const klass = await this.prisma.class.findFirst({
      where: {
        id: classId,
        organizationId: tool.organizationId,
        deletedAt: null,
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    return klass;
  }

  private async ownLineItem(tool: LtiTool, id: string) {
    const row = await this.prisma.ltiLineItem.findFirst({
      where: { id, toolId: tool.id },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Line item not found.',
      });
    return row;
  }

  private assertLineItem(input: LineItemInput) {
    if (
      typeof input.label !== 'string' ||
      !input.label.trim() ||
      typeof input.scoreMaximum !== 'number' ||
      !(input.scoreMaximum > 0) ||
      input.scoreMaximum > 100000
    )
      throw new BadRequestException({
        code: 'lti.lineitem',
        detail: 'label and a positive scoreMaximum are required.',
      });
  }

  private peek(jwt: string): Record<string, unknown> {
    const parts = jwt.split('.');
    if (parts.length !== 3) return {};
    try {
      return JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private lineItemsBase(): string {
    return `${this.apiBase()}/api/v1/lti/ags/lineitems`;
  }

  private apiBase(): string {
    return this.config.get('API_PUBLIC_URL').replace(/\/$/, '');
  }

  private get debug(): Logger {
    return this.log;
  }
}
