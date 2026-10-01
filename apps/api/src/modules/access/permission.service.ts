import { Injectable } from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

interface CacheEntry {
  features: Set<string>;
  expiresAt: number;
}

/**
 * Effective feature set for a user = role features + granted overrides - revoked overrides,
 * ignoring expired overrides and inactive features. Cached five minutes per user and
 * invalidated whenever an administrator changes assignments (docs/01 section 8).
 */
@Injectable()
export class PermissionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 5 * 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async effectiveFeatures(userId: string, role: Role): Promise<Set<string>> {
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.features;

    const [roleFeatures, overrides] = await Promise.all([
      this.prisma.roleFeature.findMany({
        where: { role, feature: { isActive: true } },
        select: { feature: { select: { code: true } } },
      }),
      this.prisma.userFeatureOverride.findMany({
        where: {
          userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: {
          isGranted: true,
          feature: { select: { code: true, isActive: true } },
        },
      }),
    ]);

    const features = new Set(roleFeatures.map((r) => r.feature.code));
    for (const o of overrides) {
      if (!o.feature.isActive) continue;
      if (o.isGranted) features.add(o.feature.code);
      else features.delete(o.feature.code);
    }
    this.cache.set(userId, { features, expiresAt: Date.now() + this.ttlMs });
    return features;
  }

  async has(userId: string, role: Role, code: string): Promise<boolean> {
    return (await this.effectiveFeatures(userId, role)).has(code);
  }

  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }

  /** Role assignments changed: every cached user may be affected. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
