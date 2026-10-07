import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { newId } from '../../common/utils/ids';
import type { DomainEvent } from '../../common/events/domain-event';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import type {
  CreateWebhookDto,
  ListDeliveriesQuery,
  UpdateWebhookDto,
} from './dto/integrations.dto';
import {
  eventMatches,
  isAllowedWebhookUrl,
  newWebhookSecret,
  nextDeliveryState,
  parseEventFilter,
  signWebhook,
  WEBHOOK_EVENT_TYPES,
  type WebhookEnvelope,
} from './integration-rules';

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Webhooks for IT (docs/04 section 5): every domain event becomes one delivery row per matching subscription;
 * a minute-by-minute pass posts the rows that are due, signs each body and backs off on failure.
 */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  async list(organizationId: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublic(r));
  }

  async create(
    organizationId: string,
    dto: CreateWebhookDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    this.validate(dto.url, dto.events);
    const secret = newWebhookSecret();
    const row = await this.prisma.webhookSubscription.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name,
        url: dto.url,
        secret,
        events: JSON.stringify(dto.events ?? []),
        retryLimit: dto.retryLimit ?? 5,
        createdById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'webhooks.create',
      entityType: 'WebhookSubscription',
      entityId: row.id,
      details: { url: dto.url, events: dto.events ?? [] },
    });
    // The secret is returned exactly once.
    return { ...this.toPublic(row), secret };
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateWebhookDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.own(organizationId, id);
    this.validate(dto.url, dto.events);
    const row = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.events !== undefined
          ? { events: JSON.stringify(dto.events) }
          : {}),
        ...(dto.isActive !== undefined
          ? {
              isActive: dto.isActive,
              ...(dto.isActive ? { failureCount: 0 } : {}),
            }
          : {}),
        ...(dto.retryLimit !== undefined ? { retryLimit: dto.retryLimit } : {}),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'webhooks.update',
      entityType: 'WebhookSubscription',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublic(row);
  }

  async remove(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    await this.own(organizationId, id);
    await this.prisma.webhookSubscription.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'webhooks.delete',
      entityType: 'WebhookSubscription',
      entityId: id,
    });
  }

  /** Rotates the secret; the new one is returned once. */
  async rotateSecret(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.own(organizationId, id);
    const secret = newWebhookSecret();
    const row = await this.prisma.webhookSubscription.update({
      where: { id },
      data: { secret },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'webhooks.rotate_secret',
      entityType: 'WebhookSubscription',
      entityId: id,
    });
    return { ...this.toPublic(row), secret };
  }

  /** Queues a ping event for one subscription so IT can check their receiver; delivered on the next pass or by deliverDue(). */
  async test(organizationId: string, id: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const sub = await this.own(organizationId, id);
    const envelope: WebhookEnvelope = {
      id: newId(),
      eventType: 'webhook.test',
      entityType: 'WebhookSubscription',
      entityId: id,
      organizationId,
      occurredAt: new Date().toISOString(),
      data: { message: 'SmartSchool webhook test', name: sub.name },
    };
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        id: newId(),
        subscriptionId: id,
        organizationId,
        eventId: envelope.id,
        eventType: envelope.eventType,
        payload: JSON.stringify(envelope),
        nextAttemptAt: new Date(),
      },
    });
    const result = await this.attempt(delivery.id);
    return result;
  }

  async deliveries(
    organizationId: string,
    id: string,
    q: ListDeliveriesQuery,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.own(organizationId, id);
    const where = {
      subscriptionId: id,
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return PagedResponse.of(
      rows.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.eventType,
        status: d.status,
        attempts: d.attempts,
        responseCode: d.responseCode,
        lastError: d.lastError,
        nextAttemptAt: d.nextAttemptAt,
        deliveredAt: d.deliveredAt,
        createdAt: d.createdAt,
      })),
      q,
      total,
    );
  }

  eventTypes(): readonly string[] {
    return WEBHOOK_EVENT_TYPES;
  }

  // ---------------------------------------------------------------------------
  // Fan-out and delivery
  // ---------------------------------------------------------------------------

  /** Every domain event: one pending delivery per active subscription of the organisation whose filter matches. */
  @OnEvent('**', { async: true })
  async onDomainEvent(
    event: DomainEvent<Record<string, unknown>>,
  ): Promise<void> {
    if (
      !event ||
      typeof event !== 'object' ||
      !('eventType' in event) ||
      !event.organizationId
    )
      return;
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { organizationId: event.organizationId, isActive: true },
      select: { id: true, events: true },
    });
    const matching = subs.filter((s) =>
      eventMatches(parseEventFilter(s.events), event.eventType),
    );
    if (matching.length === 0) return;
    const envelope: WebhookEnvelope = {
      id: event.id,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      organizationId: event.organizationId,
      occurredAt: event.occurredAt,
      data: event.data,
    };
    const payload = JSON.stringify(envelope);
    await this.prisma.webhookDelivery.createMany({
      data: matching.map((s) => ({
        id: newId(),
        subscriptionId: s.id,
        organizationId: event.organizationId as string,
        eventId: event.id,
        eventType: event.eventType,
        payload,
        nextAttemptAt: new Date(),
      })),
    });
  }

  @Cron('* * * * *')
  async deliveryPass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deliverDue();
    } catch (err) {
      this.log.warn(`webhook pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Posts every pending delivery that is due; returns how many were attempted. */
  async deliverDue(
    limit = this.config.get('WEBHOOK_BATCH_SIZE'),
  ): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const d of due) await this.attempt(d.id);
    return due.length;
  }

  private async attempt(deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { subscription: true },
    });
    if (!d || d.status !== 'pending')
      return d ? { status: d.status, responseCode: d.responseCode } : null;
    const now = new Date();
    const timestamp = String(Math.floor(now.getTime() / 1000));
    let ok = false;
    let responseCode: number | null = null;
    let lastError: string | null = null;
    try {
      const res = await fetch(d.subscription.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'SmartSchool-Webhooks/1.0',
          'x-webhook-id': d.eventId,
          'x-webhook-event': d.eventType,
          'x-webhook-timestamp': timestamp,
          'x-webhook-signature': signWebhook(
            d.subscription.secret,
            timestamp,
            d.payload,
          ),
        },
        body: d.payload,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        redirect: 'manual',
      });
      responseCode = res.status;
      ok = res.status >= 200 && res.status < 300;
      if (!ok) lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message.slice(0, 500);
    }
    const next = nextDeliveryState(
      d.attempts,
      ok,
      d.subscription.retryLimit,
      now,
    );
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: next.status,
        attempts: next.attempts,
        nextAttemptAt: next.nextAttemptAt,
        responseCode,
        lastError,
        deliveredAt: ok ? now : null,
      },
    });
    if (ok) {
      await this.prisma.webhookSubscription.update({
        where: { id: d.subscriptionId },
        data: { lastDeliveredAt: now, failureCount: 0 },
      });
    } else if (next.status === 'failed') {
      // Twenty failed deliveries in a row switch the subscription off so a dead endpoint stops costing time.
      const sub = await this.prisma.webhookSubscription.update({
        where: { id: d.subscriptionId },
        data: { failureCount: { increment: 1 } },
      });
      if (sub.failureCount >= 20)
        await this.prisma.webhookSubscription.update({
          where: { id: d.subscriptionId },
          data: { isActive: false },
        });
    }
    return {
      status: next.status,
      responseCode,
      lastError,
      attempts: next.attempts,
    };
  }

  // ---------------------------------------------------------------------------

  private validate(url: string | undefined, events: string[] | undefined) {
    if (url !== undefined && !isAllowedWebhookUrl(url))
      throw new BadRequestException({
        code: 'request.invalid',
        detail:
          'Webhook endpoints must use https (http is allowed on localhost only).',
      });
    const unknown = (events ?? []).filter(
      (e) =>
        !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e) &&
        !(e.endsWith('.') && WEBHOOK_EVENT_TYPES.some((t) => t.startsWith(e))),
    );
    if (unknown.length)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: `Unknown event types: ${unknown.join(', ')}.`,
      });
  }

  private async own(organizationId: string, id: string) {
    const row = await this.prisma.webhookSubscription.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Webhook not found.',
      });
    return row;
  }

  private toPublic(r: {
    id: string;
    organizationId: string;
    name: string;
    url: string;
    events: string | null;
    isActive: boolean;
    retryLimit: number;
    failureCount: number;
    lastDeliveredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      url: r.url,
      events: parseEventFilter(r.events),
      isActive: r.isActive,
      retryLimit: r.retryLimit,
      failureCount: r.failureCount,
      lastDeliveredAt: r.lastDeliveredAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
