import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Organization, Prisma, Role } from '@prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PermissionService } from '../access/permission.service';
import { canAssignRole, ROLE_API_NAME, roleFromApi } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  organizationScope,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { AuthService, type PublicUser } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AddMemberDto,
  CreateOrganizationDto,
  ListMembersQuery,
  ListOrganizationsQuery,
  UpdateOrganizationDto,
} from './dto/organizations.dto';

export interface PublicOrganization {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationDetail extends PublicOrganization {
  counts: { users: number; students: number; byRole: Record<string, number> };
}

const SORTABLE = ['name', 'createdAt'] as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(
    q: ListOrganizationsQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicOrganization>> {
    const scope = organizationScope(actor);
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(scope.organizationId ? { id: scope.organizationId } : {}),
      ...(q.includeInactive ? {} : { isActive: true }),
      ...(q.search ? { name: { contains: q.search } } : {}),
    };
    const orderBy = q.orderBy(SORTABLE).map((o) => ({
      [o.field]: o.direction,
    })) as Prisma.OrganizationOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        orderBy: orderBy.length ? orderBy : { name: 'asc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.organization.count({ where }),
    ]);
    return PagedResponse.of(rows.map(toPublic), q, total);
  }

  async get(id: string, actor: AuthenticatedUser): Promise<OrganizationDetail> {
    assertOrganizationAccess(actor, id);
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    const [users, students, grouped] = await Promise.all([
      this.prisma.user.count({
        where: { organizationId: id, deletedAt: null },
      }),
      this.prisma.student.count({
        where: { organizationId: id, deletedAt: null },
      }),
      this.prisma.user.groupBy({
        by: ['role'],
        where: { organizationId: id, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const byRole: Record<string, number> = {};
    for (const g of grouped) byRole[ROLE_API_NAME[g.role]] = g._count._all;
    return { ...toPublic(org), counts: { users, students, byRole } };
  }

  async create(
    dto: CreateOrganizationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicOrganization> {
    const duplicate = await this.prisma.organization.findFirst({
      where: { name: dto.name.trim(), deletedAt: null },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException({
        code: 'resource.conflict',
        detail: 'An organisation with this name already exists.',
      });
    const org = await this.prisma.organization.create({
      data: { id: newId(), ...dto, name: dto.name.trim() },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: org.id,
      action: 'organizations.create',
      entityType: 'Organization',
      entityId: org.id,
    });
    return toPublic(org);
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicOrganization> {
    assertOrganizationAccess(actor, id);
    const existing = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    const org = await this.prisma.organization.update({
      where: { id },
      data: { ...dto, name: dto.name?.trim() },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: id,
      action: 'organizations.update',
      entityType: 'Organization',
      entityId: id,
      details: { ...dto },
    });
    return toPublic(org);
  }

  /** Soft delete. Users keep their rows (with the organisation link) so the audit trail stays intact. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    if (!isDistrictRole(actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only district administrators can delete an organisation.',
      });
    const result = await this.prisma.organization.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    await this.audit.record({
      userId: actor.id,
      organizationId: id,
      action: 'organizations.delete',
      entityType: 'Organization',
      entityId: id,
    });
  }

  async members(
    id: string,
    q: ListMembersQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicUser>> {
    assertOrganizationAccess(actor, id);
    const where: Prisma.UserWhereInput = {
      organizationId: id,
      deletedAt: null,
      ...(q.role ? { role: roleFromApi(q.role) } : {}),
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
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
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

  async addMember(
    id: string,
    dto: AddMemberDto,
    actor: AuthenticatedUser,
  ): Promise<PublicUser> {
    assertOrganizationAccess(actor, id);
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    const user = await this.prisma.user.findFirst({
      where: dto.userId
        ? { id: dto.userId, deletedAt: null }
        : { email: dto.email, deletedAt: null },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'User not found. Create the account first.',
      });
    if (
      user.organizationId &&
      user.organizationId !== id &&
      !isDistrictRole(actor)
    ) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'This user belongs to another organisation.',
      });
    }
    const role: Role | undefined = dto.role ? roleFromApi(dto.role) : undefined;
    if (
      role &&
      (!canAssignRole(actor.role, role) ||
        !canAssignRole(actor.role, user.role))
    ) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your role cannot make this role change.',
      });
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { organizationId: id, role },
    });
    this.permissions.invalidateUser(user.id);
    await this.audit.record({
      userId: actor.id,
      organizationId: id,
      action: 'organizations.member_added',
      entityType: 'User',
      entityId: user.id,
      details: { role: dto.role ?? null },
    });
    return this.auth.toPublic(updated);
  }
}

function toPublic(o: Organization): PublicOrganization {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    email: o.email,
    phone: o.phone,
    address: o.address,
    timezone: o.timezone,
    isActive: o.isActive,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
