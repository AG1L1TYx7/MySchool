import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { newId } from '../../common/utils/ids';
import type { ServiceIncident } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { HealthService } from '../health/health.service';
import type {
  CreateIncidentDto,
  UpdateIncidentDto,
} from './dto/operations.dto';
import {
  canTransition,
  COMPONENTS,
  componentsFromHealth,
  isOpen,
  OVERALL_LABELS,
  overallStatus,
  parseComponents,
  parseUpdates,
  uptimeByDay,
  uptimeOverall,
  type ComponentState,
  type IncidentUpdate,
} from './operations-rules';

/** How long one build of the status page is served before it is rebuilt. */
const STATUS_CACHE_MS = 30_000;
const UPTIME_DAYS = 90;
const KEEP_CHECK_DAYS = 100;

/**
 * Operations (docs/02 section 35 and the rest of 32, slice 26): a health check every five minutes kept
 * as a row, the public status page built from the latest check, open incidents and the uptime those
 * rows give, and incident records with a plain-language update log.
 */
@Injectable()
export class OperationsService {
  private readonly log = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
    private readonly audit: AuditService,
  ) {}

  @Cron('*/5 * * * *')
  async checkScheduled(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.runCheck().catch((e: Error) =>
      this.log.warn(`status check failed: ${e.message}`),
    );
  }

  /** Probes the dependencies and stores the result; the status page and uptime are built from these rows. */
  async runCheck() {
    this.statusCache = null;
    const t0 = Date.now();
    const report = await this.health.report();
    const components = componentsFromHealth(report);
    const row = await this.prisma.statusCheck.create({
      data: {
        id: newId(),
        status: report.status,
        components: JSON.stringify(components),
        latencyMs: Date.now() - t0,
      },
    });
    await this.prisma.statusCheck.deleteMany({
      where: {
        checkedAt: { lt: new Date(Date.now() - KEEP_CHECK_DAYS * 86_400_000) },
      },
    });
    return {
      id: row.id,
      checkedAt: row.checkedAt,
      status: row.status,
      components,
      latencyMs: row.latencyMs,
    };
  }

  private statusCache: { at: number; value: Promise<unknown> } | null = null;

  /**
   * The public status page, served from a short cache (docs/21 F10): it is unauthenticated and reads
   * ninety days of checks, so one build serves everyone for ${STATUS_CACHE_MS} and any change to an
   * incident or a check drops the cache.
   */
  statusPage(): Promise<unknown> {
    const now = Date.now();
    if (this.statusCache && now - this.statusCache.at < STATUS_CACHE_MS)
      return this.statusCache.value;
    const value = this.buildStatusPage();
    this.statusCache = { at: now, value };
    value.catch(() => {
      this.statusCache = null;
    });
    return value;
  }

  private async buildStatusPage() {
    const now = new Date();
    const [latest, checks, incidents] = await Promise.all([
      this.prisma.statusCheck.findFirst({ orderBy: { checkedAt: 'desc' } }),
      this.prisma.statusCheck.findMany({
        where: {
          checkedAt: {
            gte: new Date(now.getTime() - UPTIME_DAYS * 86_400_000),
          },
        },
        select: { checkedAt: true, status: true },
      }),
      this.prisma.serviceIncident.findMany({
        where: {
          isPublic: true,
          OR: [
            { resolvedAt: null },
            { resolvedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
            { scheduledFor: { gte: now } },
          ],
        },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
    ]);
    let components: Record<string, ComponentState> = Object.fromEntries(
      COMPONENTS.map((c) => [c.key, 'operational']),
    );
    if (latest) {
      try {
        components = {
          ...components,
          ...(JSON.parse(latest.components) as Record<string, ComponentState>),
        };
      } catch {
        /* keep defaults */
      }
    }
    // An open incident marks its components; the status page reads the people's words, not only the probe's.
    for (const i of incidents) {
      if (!isOpen(i.status) || i.kind !== 'incident') continue;
      for (const key of parseComponents(i.components)) {
        if (i.impact === 'critical' || i.impact === 'major')
          components[key] = 'down';
        else if (components[key] === 'operational')
          components[key] = 'degraded';
      }
    }
    const overall = overallStatus(components, incidents);
    const days = uptimeByDay(checks, UPTIME_DAYS, now);
    return {
      status: overall,
      label: OVERALL_LABELS[overall],
      checkedAt: latest?.checkedAt ?? null,
      components: COMPONENTS.map((c) => ({
        key: c.key,
        name: c.name,
        status: components[c.key],
      })),
      incidents: incidents
        .filter((i) => i.kind === 'incident')
        .map((i) => this.toIncident(i)),
      maintenance: incidents
        .filter((i) => i.kind === 'maintenance')
        .map((i) => this.toIncident(i)),
      uptime: { days: UPTIME_DAYS, percent: uptimeOverall(days), byDay: days },
    };
  }

  // Incidents -------------------------------------------------------------------------------------------

  async incidents(includeClosed = true) {
    const rows = await this.prisma.serviceIncident.findMany({
      where: includeClosed ? {} : { resolvedAt: null },
      orderBy: [{ resolvedAt: 'asc' }, { startedAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => this.toIncident(r));
  }

  async createIncident(dto: CreateIncidentDto, actor: AuthenticatedUser) {
    this.statusCache = null;
    const kind = dto.kind ?? 'incident';
    const now = new Date();
    const status = kind === 'maintenance' ? 'scheduled' : 'investigating';
    if (kind === 'maintenance' && !dto.scheduledFor) {
      throw new BadRequestException({
        code: 'operations.schedule_required',
        detail: 'Maintenance needs a start time.',
      });
    }
    const first: IncidentUpdate = {
      at: now.toISOString(),
      status,
      message: dto.message.trim(),
      byId: actor.id,
    };
    const row = await this.prisma.serviceIncident.create({
      data: {
        id: newId(),
        kind,
        title: dto.title.trim(),
        status,
        impact:
          kind === 'maintenance'
            ? (dto.impact ?? 'none')
            : (dto.impact ?? 'minor'),
        components: dto.components.join(','),
        isPublic: dto.isPublic ?? true,
        startedAt:
          kind === 'maintenance' && dto.scheduledFor
            ? new Date(dto.scheduledFor)
            : now,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        scheduledUntil: dto.scheduledUntil
          ? new Date(dto.scheduledUntil)
          : null,
        updates: JSON.stringify([first]),
        createdById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: null,
      action: 'operations.incident.create',
      entityType: 'ServiceIncident',
      entityId: row.id,
      details: {
        kind,
        title: row.title,
        impact: row.impact,
        components: dto.components,
      },
    });
    return this.toIncident(row);
  }

  async updateIncident(
    id: string,
    dto: UpdateIncidentDto,
    actor: AuthenticatedUser,
  ) {
    this.statusCache = null;
    const row = await this.prisma.serviceIncident.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'operations.incident_not_found',
        detail: 'Incident not found.',
      });
    const status = dto.status ?? row.status;
    if (
      dto.status &&
      dto.status !== row.status &&
      !canTransition(row.status, dto.status)
    ) {
      throw new BadRequestException({
        code: 'operations.bad_transition',
        detail: `An incident that is ${row.status} cannot become ${dto.status}.`,
      });
    }
    const now = new Date();
    const updates = parseUpdates(row.updates);
    updates.push({
      at: now.toISOString(),
      status,
      message: dto.message.trim(),
      byId: actor.id,
    });
    const closed = status === 'resolved' || status === 'completed';
    const updated = await this.prisma.serviceIncident.update({
      where: { id },
      data: {
        status,
        title: dto.title?.trim() || row.title,
        impact: dto.impact ?? row.impact,
        isPublic: dto.isPublic ?? row.isPublic,
        resolvedAt: closed ? (row.resolvedAt ?? now) : null,
        updates: JSON.stringify(updates),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: null,
      action: 'operations.incident.update',
      entityType: 'ServiceIncident',
      entityId: id,
      details: { status, impact: dto.impact, isPublic: dto.isPublic },
    });
    return this.toIncident(updated);
  }

  async recentChecks(limit = 50) {
    const rows = await this.prisma.statusCheck.findMany({
      orderBy: { checkedAt: 'desc' },
      take: Math.min(500, limit),
    });
    return rows.map((r) => {
      let components: Record<string, ComponentState> = {};
      try {
        components = JSON.parse(r.components) as Record<string, ComponentState>;
      } catch {
        components = {};
      }
      return {
        id: r.id,
        checkedAt: r.checkedAt,
        status: r.status,
        components,
        latencyMs: r.latencyMs,
      };
    });
  }

  private toIncident(r: ServiceIncident) {
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      impact: r.impact,
      components: parseComponents(r.components),
      isPublic: r.isPublic,
      startedAt: r.startedAt,
      resolvedAt: r.resolvedAt,
      scheduledFor: r.scheduledFor,
      scheduledUntil: r.scheduledUntil,
      updates: parseUpdates(r.updates).map((u) => ({
        at: u.at,
        status: u.status,
        message: u.message,
      })),
      open: isOpen(r.status),
      createdAt: r.createdAt,
    };
  }
}
