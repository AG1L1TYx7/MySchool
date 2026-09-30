import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Global on/off switches (docs/02 section 2). Cached for one minute. */
@Injectable()
export class FeatureFlagService {
  private cache: { flags: Map<string, boolean>; expiresAt: number } | null =
    null;

  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Map<string, boolean>> {
    if (this.cache && this.cache.expiresAt > Date.now())
      return this.cache.flags;
    const rows = await this.prisma.featureFlag.findMany({
      select: { name: true, isEnabled: true },
    });
    const flags = new Map(rows.map((r) => [r.name, r.isEnabled]));
    this.cache = { flags, expiresAt: Date.now() + 60_000 };
    return flags;
  }

  /** Unknown flags are treated as disabled so a typo never opens a route. */
  async isEnabled(name: string): Promise<boolean> {
    return (await this.all()).get(name) ?? false;
  }

  invalidate(): void {
    this.cache = null;
  }
}
