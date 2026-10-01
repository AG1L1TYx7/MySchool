import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Rubric } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  organizationScope,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateRubricDto,
  RubricCriterionDto,
  UpdateRubricDto,
} from './dto/assignments.dto';

export interface RubricCriterion {
  id: string;
  title: string;
  description?: string;
  maxPoints: number;
  levels?: Array<{ label: string; points: number; description?: string }>;
}

export interface PublicRubric {
  id: string;
  organizationId: string;
  createdById: string | null;
  title: string;
  description: string | null;
  criteria: RubricCriterion[];
  totalPoints: number;
  isTemplate: boolean;
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RubricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    search?: string,
  ): Promise<PublicRubric[]> {
    const rows = await this.prisma.rubric.findMany({
      where: {
        deletedAt: null,
        ...organizationScope(actor),
        ...(search ? { title: { contains: search } } : {}),
      },
      orderBy: { title: 'asc' },
      take: 200,
    });
    return rows.map((r) => toPublic(r, actor));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicRubric> {
    return toPublic(await this.find(id, actor), actor);
  }

  async create(
    dto: CreateRubricDto,
    actor: AuthenticatedUser,
  ): Promise<PublicRubric> {
    const organizationId = resolveOrganizationId(actor);
    const row = await this.prisma.rubric.create({
      data: {
        id: newId(),
        organizationId,
        createdById: actor.id,
        title: dto.title.trim(),
        description: dto.description,
        criteria: JSON.stringify(normaliseCriteria(dto.criteria)),
        isTemplate: dto.isTemplate ?? false,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'rubrics.create',
      entityType: 'Rubric',
      entityId: row.id,
    });
    return toPublic(row, actor);
  }

  async update(
    id: string,
    dto: UpdateRubricDto,
    actor: AuthenticatedUser,
  ): Promise<PublicRubric> {
    const existing = await this.find(id, actor);
    if (!canEdit(existing, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the rubric author or an administrator can change it.',
      });
    const row = await this.prisma.rubric.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        criteria: dto.criteria
          ? JSON.stringify(normaliseCriteria(dto.criteria))
          : undefined,
        isTemplate: dto.isTemplate,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'rubrics.update',
      entityType: 'Rubric',
      entityId: id,
    });
    return toPublic(row, actor);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.find(id, actor);
    if (!canEdit(existing, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the rubric author or an administrator can delete it.',
      });
    await this.prisma.rubric.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'rubrics.delete',
      entityType: 'Rubric',
      entityId: id,
    });
  }

  async find(id: string, actor: AuthenticatedUser): Promise<Rubric> {
    const row = await this.prisma.rubric.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Rubric not found.',
      });
    assertOrganizationAccess(actor, row.organizationId);
    return row;
  }
}

export function parseCriteria(json: string): RubricCriterion[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RubricCriterion[]) : [];
  } catch {
    return [];
  }
}

function normaliseCriteria(criteria: RubricCriterionDto[]): RubricCriterion[] {
  return criteria.map((c, i) => ({
    id: c.id?.trim() || `c${i + 1}`,
    title: c.title.trim(),
    description: c.description,
    maxPoints: c.maxPoints,
    levels: c.levels,
  }));
}

function canEdit(rubric: Rubric, actor: AuthenticatedUser): boolean {
  return (
    isDistrictRole(actor) ||
    ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL ||
    rubric.createdById === actor.id
  );
}

function toPublic(r: Rubric, actor: AuthenticatedUser): PublicRubric {
  const criteria = parseCriteria(r.criteria);
  return {
    id: r.id,
    organizationId: r.organizationId,
    createdById: r.createdById,
    title: r.title,
    description: r.description,
    criteria,
    totalPoints: criteria.reduce((s, c) => s + c.maxPoints, 0),
    isTemplate: r.isTemplate,
    canEdit: canEdit(r, actor),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
