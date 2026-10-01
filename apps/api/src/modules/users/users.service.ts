import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role, UserStatus } from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import { addMinutes, randomToken, sha256 } from '../../common/utils/tokens';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PermissionService } from '../access/permission.service';
import { canAssignRole, roleFromApi } from '../access/roles';
import { AuditService } from '../audit/audit.service';
import { AuthService, type PublicUser } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/users.dto';

const SORTABLE = [
  'lastName',
  'firstName',
  'email',
  'createdAt',
  'lastLoginAt',
] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly permissions: PermissionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(
    q: ListUsersQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...this.scope(actor, q.organizationId),
      ...(q.role ? { role: roleFromApi(q.role) } : {}),
      ...(q.status ? { status: q.status.toUpperCase() as UserStatus } : {}),
      ...(q.search
        ? {
            OR: [
              { email: { contains: q.search } },
              { firstName: { contains: q.search } },
              { lastName: { contains: q.search } },
            ],
          }
        : {}),
    };
    const orderBy = q.orderBy(SORTABLE).map((o) => ({
      [o.field]: o.direction,
    })) as Prisma.UserOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: orderBy.length
          ? orderBy
          : [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return PagedResponse.of(
      rows.map((u) => this.auth.toPublic(u)),
      q,
      total,
    );
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scope(actor) },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'User not found.',
      });
    return this.auth.toPublic(user);
  }

  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
  ): Promise<{
    user: PublicUser;
    invitationSent: boolean;
    devInviteToken?: string;
  }> {
    const role = roleFromApi(dto.role) as Role;
    if (!canAssignRole(actor.role, role))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: `Your role cannot create a '${dto.role}'.`,
      });
    const organizationId =
      actor.role === 'SUPER_ADMIN'
        ? (dto.organizationId ?? null)
        : actor.organizationId;
    if (
      await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      })
    ) {
      throw new ConflictException({
        code: 'auth.email_exists',
        detail: 'An account with this email already exists.',
      });
    }
    const password = dto.password ?? randomToken(24);
    const user = await this.prisma.user.create({
      data: {
        id: newId(),
        email: dto.email,
        passwordHash: await this.passwords.hash(password),
        passwordChangedAt: dto.password ? new Date() : null,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        role,
        organizationId,
        emailVerifiedAt: new Date(),
      },
    });

    let invitationSent = false;
    let devInviteToken: string | undefined;
    if (!dto.password) {
      const token = randomToken(32);
      await this.prisma.passwordResetToken.create({
        data: {
          id: newId(),
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: addMinutes(new Date(), 72 * 60),
        },
      });
      invitationSent = await this.mail.send({
        to: user.email,
        subject: 'Your SmartSchool account',
        text: `Hello ${user.firstName},\n\nAn account has been created for you. Set your password within 72 hours using this code:\n\n${token}`,
      });
      if (process.env.NODE_ENV === 'development') devInviteToken = token;
    }
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'users.create',
      entityType: 'User',
      entityId: user.id,
      details: { role: dto.role },
    });
    return {
      user: this.auth.toPublic(user),
      invitationSent,
      ...(devInviteToken ? { devInviteToken } : {}),
    };
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
  ): Promise<PublicUser> {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scope(actor) },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'User not found.',
      });
    if (existing.id === actor.id && (dto.role || dto.status)) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You cannot change your own role or status.',
      });
    }
    const role = dto.role ? (roleFromApi(dto.role) as Role) : undefined;
    if (
      role &&
      (!canAssignRole(actor.role, role) ||
        !canAssignRole(actor.role, existing.role))
    ) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your role cannot make this role change.',
      });
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        phone: dto.phone,
        role,
        status: dto.status
          ? (dto.status.toUpperCase() as UserStatus)
          : undefined,
        organizationId:
          actor.role === 'SUPER_ADMIN' ? dto.organizationId : undefined,
      },
    });
    if (dto.status === 'inactive') {
      await this.prisma.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.permissions.invalidateUser(id);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'users.update',
      entityType: 'User',
      entityId: id,
      details: { ...dto },
    });
    return this.auth.toPublic(user);
  }

  async triggerPasswordReset(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ delivered: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scope(actor) },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'User not found.',
      });
    const token = randomToken(32);
    await this.prisma.passwordResetToken.create({
      data: {
        id: newId(),
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: addMinutes(new Date(), 60),
      },
    });
    const delivered = await this.mail.send({
      to: user.email,
      subject: 'Reset your SmartSchool password',
      text: `Hello ${user.firstName},\n\nAn administrator started a password reset. Use this code within 60 minutes:\n\n${token}`,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'users.password_reset_triggered',
      entityType: 'User',
      entityId: id,
    });
    return { delivered };
  }

  /** SuperAdmin sees everyone; everyone else only their own organisation. */
  private scope(
    actor: AuthenticatedUser,
    organizationId?: string,
  ): Prisma.UserWhereInput {
    if (actor.role === 'SUPER_ADMIN')
      return organizationId ? { organizationId } : {};
    return { organizationId: actor.organizationId ?? '__none__' };
  }
}
