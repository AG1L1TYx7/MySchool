import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { dayKey } from './billing-rules';

interface Bucket {
  tenantId: string;
  organizationId: string;
  day: string;
  apiRequests: number;
  aiCalls: number;
  users: Set<string>;
}

/**
 * Usage metering: every authenticated request is counted in memory per school and day and written out
 * once a minute (and on shutdown); distinct people per day are kept as rows so the count survives
 * restarts; a nightly snapshot records active students and storage per school.
 */
@Injectable()
export class UsageService implements OnModuleDestroy {
  private readonly log = new Logger(UsageService.name);
  private buckets = new Map<string, Bucket>();
  private readonly seenUsers = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  record(
    tenantId: string,
    organizationId: string,
    userId: string,
    aiCall: boolean,
    at = new Date(),
  ): void {
    const day = dayKey(at);
    const key = `${organizationId}|${day}`;
    const b = this.buckets.get(key) ?? {
      tenantId,
      organizationId,
      day,
      apiRequests: 0,
      aiCalls: 0,
      users: new Set<string>(),
    };
    b.apiRequests += 1;
    if (aiCall) b.aiCalls += 1;
    const userKey = `${key}|${userId}`;
    if (!this.seenUsers.has(userKey)) b.users.add(userId);
    this.buckets.set(key, b);
  }

  @Cron('*/1 * * * *')
  async flushScheduled(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.flush().catch((e: Error) =>
      this.log.warn(`usage flush failed: ${e.message}`),
    );
  }

  /** Writes the in-memory counts to the day rows. Safe to call at any time (tests do). */
  async flush(): Promise<number> {
    if (this.prisma.isClosed) return 0;
    const pending = Array.from(this.buckets.values());
    this.buckets = new Map();
    for (const b of pending) {
      const day = new Date(`${b.day}T00:00:00.000Z`);
      for (const userId of b.users) {
        const userKey = `${b.organizationId}|${b.day}|${userId}`;
        if (this.seenUsers.has(userKey)) continue;
        await this.prisma.usageActivity
          .upsert({
            where: {
              organizationId_day_userId: {
                organizationId: b.organizationId,
                day,
                userId,
              },
            },
            create: {
              id: newId(),
              tenantId: b.tenantId,
              organizationId: b.organizationId,
              day,
              userId,
            },
            update: {},
          })
          .catch(() => undefined);
        this.seenUsers.add(userKey);
      }
      const activeUsers = await this.prisma.usageActivity.count({
        where: { organizationId: b.organizationId, day },
      });
      await this.prisma.usageDaily.upsert({
        where: {
          tenantId_organizationId_day: {
            tenantId: b.tenantId,
            organizationId: b.organizationId,
            day,
          },
        },
        create: {
          id: newId(),
          tenantId: b.tenantId,
          organizationId: b.organizationId,
          day,
          apiRequests: b.apiRequests,
          aiCalls: b.aiCalls,
          activeUsers,
        },
        update: {
          apiRequests: { increment: b.apiRequests },
          aiCalls: { increment: b.aiCalls },
          activeUsers,
        },
      });
    }
    if (this.seenUsers.size > 50_000) this.seenUsers.clear();
    return pending.length;
  }

  /** Active students and storage per school for today; runs nightly and on demand. */
  @Cron('30 0 * * *')
  async snapshotScheduled(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.snapshot().catch((e: Error) =>
      this.log.warn(`usage snapshot failed: ${e.message}`),
    );
  }

  async snapshot(at = new Date()): Promise<number> {
    const day = new Date(`${dayKey(at)}T00:00:00.000Z`);
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, tenantId: true },
    });
    let n = 0;
    for (const org of orgs) {
      if (!org.tenantId) continue;
      const [students, storage] = await Promise.all([
        this.prisma.student.count({
          where: {
            organizationId: org.id,
            enrollmentStatus: 'ACTIVE',
            deletedAt: null,
          },
        }),
        this.prisma.fileUpload.aggregate({
          where: { organizationId: org.id },
          _sum: { sizeBytes: true },
        }),
      ]);
      const storageMb = Math.round((storage._sum.sizeBytes ?? 0) / 1_048_576);
      await this.prisma.usageDaily.upsert({
        where: {
          tenantId_organizationId_day: {
            tenantId: org.tenantId,
            organizationId: org.id,
            day,
          },
        },
        create: {
          id: newId(),
          tenantId: org.tenantId,
          organizationId: org.id,
          day,
          activeStudents: students,
          storageMb,
        },
        update: { activeStudents: students, storageMb },
      });
      n += 1;
    }
    return n;
  }

  /** Writes what is buffered while the database is still connected; after that the last minute is dropped. */
  async onModuleDestroy(): Promise<void> {
    await this.flush().catch(() => undefined);
  }
}
