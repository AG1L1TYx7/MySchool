import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import {
  PagedQueryDto,
  PagedResponse,
} from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { csvLines } from '../integrations/integration-rules';

export interface AuditEntry {
  userId?: string | null;
  organizationId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestPath?: string | null;
  httpMethod?: string | null;
  statusCode?: number | null;
  details?: Record<string, unknown>;
  traceId?: string | null;
}

export class AuditQueryDto extends PagedQueryDto {
  userId?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: an audit failure must not fail the request it describes. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: newId(),
          userId: entry.userId ?? null,
          organizationId: entry.organizationId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
          requestPath: entry.requestPath?.slice(0, 500) ?? null,
          httpMethod: entry.httpMethod ?? null,
          statusCode: entry.statusCode ?? null,
          details: entry.details ? JSON.stringify(entry.details) : null,
          traceId: entry.traceId ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Audit write failed for ${entry.action}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async query(q: AuditQueryDto, organizationId?: string | null) {
    const where: Prisma.AuditLogWhereInput = {
      ...(organizationId ? { organizationId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.from || q.to
        ? {
            timestamp: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return PagedResponse.of(data, q, total);
  }

  /** The same filter as the list, as CSV (at most 50,000 rows, newest first). */
  async exportCsv(
    q: AuditQueryDto,
    organizationId: string | null | undefined,
    actor: { id: string; organizationId: string | null },
  ): Promise<string> {
    const where: Prisma.AuditLogWhereInput = {
      ...(organizationId ? { organizationId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.from || q.to
        ? {
            timestamp: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 50_000,
      include: { user: { select: { email: true } } },
    });
    await this.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'audit.export',
      entityType: 'AuditLog',
      details: { rows: rows.length, filter: { ...q } },
    });
    return csvLines([
      [
        'Timestamp',
        'Action',
        'User',
        'Organization',
        'Entity type',
        'Entity id',
        'Method',
        'Path',
        'Status',
        'IP',
        'Trace',
        'Details',
      ],
      ...rows.map((r) => [
        r.timestamp.toISOString(),
        r.action,
        r.user?.email ?? r.userId ?? '',
        r.organizationId ?? '',
        r.entityType ?? '',
        r.entityId ?? '',
        r.httpMethod ?? '',
        r.requestPath ?? '',
        r.statusCode ?? '',
        r.ipAddress ?? '',
        r.traceId ?? '',
        r.details ?? '',
      ]),
    ]);
  }
}
