import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeatureFlagService } from './feature-flag.service';
import { PermissionService } from './permission.service';
import { ROLE_API_NAME, ROLE_LEVEL } from './roles';

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly flags: FeatureFlagService,
  ) {}

  roles() {
    return (Object.keys(ROLE_LEVEL) as Role[]).map((role) => ({
      role: ROLE_API_NAME[role],
      level: ROLE_LEVEL[role],
    }));
  }

  async catalog() {
    const features = await this.prisma.feature.findMany({
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
    const byCategory = new Map<string, typeof features>();
    for (const f of features) {
      const list = byCategory.get(f.category) ?? [];
      list.push(f);
      byCategory.set(f.category, list);
    }
    return [...byCategory.entries()].map(([category, items]) => ({
      category,
      features: items.map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        description: f.description,
        isActive: f.isActive,
      })),
    }));
  }

  async roleFeatures(role: Role): Promise<string[]> {
    const rows = await this.prisma.roleFeature.findMany({
      where: { role },
      select: { feature: { select: { code: true } } },
    });
    return rows.map((r) => r.feature.code).sort();
  }

  /** Replaces the role's feature set. Unknown codes are rejected as a whole. */
  async setRoleFeatures(
    role: Role,
    codes: string[],
    actorId: string,
  ): Promise<string[]> {
    const features = await this.prisma.feature.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const unknown = codes.filter((c) => !features.some((f) => f.code === c));
    if (unknown.length) {
      throw new NotFoundException({
        code: 'feature.unknown',
        detail: `Unknown feature codes: ${unknown.join(', ')}`,
      });
    }
    await this.prisma.$transaction([
      this.prisma.roleFeature.deleteMany({ where: { role } }),
      this.prisma.roleFeature.createMany({
        data: features.map((f) => ({
          id: newId(),
          role,
          featureId: f.id,
          assignedBy: actorId,
        })),
      }),
    ]);
    this.permissions.invalidateAll();
    return this.roleFeatures(role);
  }

  async userOverrides(userId: string) {
    const rows = await this.prisma.userFeatureOverride.findMany({
      where: { userId },
      select: {
        isGranted: true,
        reason: true,
        expiresAt: true,
        createdAt: true,
        feature: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      code: r.feature.code,
      isGranted: r.isGranted,
      reason: r.reason,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  async setUserOverride(
    userId: string,
    code: string,
    input: { isGranted: boolean; reason?: string; expiresAt?: Date },
    actorId: string,
  ) {
    const feature = await this.prisma.feature.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!feature)
      throw new NotFoundException({
        code: 'feature.unknown',
        detail: `Unknown feature code '${code}'.`,
      });
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'User not found.',
      });
    await this.prisma.userFeatureOverride.upsert({
      where: { userId_featureId: { userId, featureId: feature.id } },
      create: {
        id: newId(),
        userId,
        featureId: feature.id,
        isGranted: input.isGranted,
        reason: input.reason,
        expiresAt: input.expiresAt,
        assignedBy: actorId,
      },
      update: {
        isGranted: input.isGranted,
        reason: input.reason,
        expiresAt: input.expiresAt ?? null,
        assignedBy: actorId,
      },
    });
    this.permissions.invalidateUser(userId);
    return this.userOverrides(userId);
  }

  async removeUserOverride(userId: string, code: string): Promise<void> {
    const feature = await this.prisma.feature.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!feature)
      throw new NotFoundException({
        code: 'feature.unknown',
        detail: `Unknown feature code '${code}'.`,
      });
    await this.prisma.userFeatureOverride.deleteMany({
      where: { userId, featureId: feature.id },
    });
    this.permissions.invalidateUser(userId);
  }

  async featureFlags() {
    return this.prisma.featureFlag.findMany({
      orderBy: { name: 'asc' },
      select: {
        name: true,
        isEnabled: true,
        description: true,
        updatedAt: true,
      },
    });
  }

  async setFeatureFlag(name: string, isEnabled: boolean) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { name } });
    if (!flag)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: `Feature flag '${name}' not found.`,
      });
    const updated = await this.prisma.featureFlag.update({
      where: { name },
      data: { isEnabled },
      select: {
        name: true,
        isEnabled: true,
        description: true,
        updatedAt: true,
      },
    });
    this.flags.invalidate();
    return updated;
  }
}
