import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { AppConfigService } from '../../config/app-config.service';
import { newId } from '../../common/utils/ids';
import type {
  Invoice,
  Prisma,
  Subscription,
  SubscriptionPlan,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  buildInvoiceLines,
  centsToDollars,
  dayKey,
  dueDateFor,
  effectiveInvoiceStatus,
  IDEMPOTENCY_HOURS,
  idempotencyDecision,
  invoiceNumber,
  isValidIdempotencyKey,
  monthlyAmountCents,
  monthlyRecurringCents,
  periodFrom,
  PLATFORM_PLANS,
  requestFingerprint,
  rollupUsage,
  seatsFor,
  subscriptionStatusFrom,
  verifyProviderSignature,
  type InvoiceLine,
  type UsageRow,
} from './billing-rules';
import type {
  GenerateInvoiceDto,
  InvoiceActionDto,
  ListInvoicesQuery,
  SetSubscriptionDto,
  UpsertPlanDto,
  UsageQuery,
} from './dto/billing.dto';

type SubscriptionRow = Subscription & {
  plan: SubscriptionPlan;
  tenant: { id: string; name: string; slug: string };
};

/**
 * Billing (docs/02 section 32, slice 26): platform plans, one subscription per district, invoices for
 * each monthly period (manual by default; a payment provider's webhook can mark them paid), idempotent
 * write routes, and the usage that the metering collects.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  // Plans ----------------------------------------------------------------------------------------------

  async plans(includeInactive = false) {
    const rows = await this.prisma.subscriptionPlan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((p) => this.toPlan(p));
  }

  async upsertPlan(dto: UpsertPlanDto, actor: AuthenticatedUser) {
    const data = {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      pricePerStudentCents: dto.pricePerStudentCents,
      minimumCents: dto.minimumCents,
      includedStudents: dto.includedStudents ?? 0,
      features: JSON.stringify(dto.features ?? []),
      isActive: dto.isActive ?? true,
    };
    const row = await this.prisma.subscriptionPlan.upsert({
      where: { code: dto.code.trim().toLowerCase() },
      create: {
        id: newId(),
        code: dto.code.trim().toLowerCase(),
        sortOrder: 10,
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: null,
      action: 'billing.plan.upsert',
      entityType: 'SubscriptionPlan',
      entityId: row.id,
      details: { ...dto },
    });
    return this.toPlan(row);
  }

  /** Makes sure the platform plans exist (seed and first start). */
  async ensurePlans(): Promise<void> {
    for (const p of PLATFORM_PLANS) {
      await this.prisma.subscriptionPlan.upsert({
        where: { code: p.code },
        create: {
          id: newId(),
          code: p.code,
          name: p.name,
          description: p.description,
          pricePerStudentCents: p.pricePerStudentCents,
          minimumCents: p.minimumCents,
          includedStudents: p.includedStudents,
          features: JSON.stringify(p.features),
          sortOrder: p.sortOrder,
        },
        update: {},
      });
    }
  }

  // Subscription ---------------------------------------------------------------------------------------

  async subscription(actor: AuthenticatedUser, requestedTenantId?: string) {
    const tenantId = this.tenantFor(actor, requestedTenantId);
    const row = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: {
        plan: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
    const tenant =
      row?.tenant ??
      (await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true },
      }));
    if (!tenant)
      throw new NotFoundException({
        code: 'tenant.not_found',
        detail: 'District not found.',
      });
    const seats = await this.countSeats(tenantId);
    if (!row)
      return { tenant, subscription: null, seatsNow: seats, estimate: null };
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: { in: ['open'] } },
      select: { status: true, dueAt: true },
    });
    return {
      tenant,
      subscription: this.toSubscription(row, invoices),
      seatsNow: seats,
      estimate: this.estimate(row.plan, row.seats),
    };
  }

  async setSubscription(dto: SetSubscriptionDto, actor: AuthenticatedUser) {
    const tenantId = this.tenantFor(actor, dto.tenantId);
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { code: dto.planCode.toLowerCase(), isActive: true },
    });
    if (!plan)
      throw new BadRequestException({
        code: 'billing.plan_unknown',
        detail: 'No such plan.',
      });
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant)
      throw new NotFoundException({
        code: 'tenant.not_found',
        detail: 'District not found.',
      });
    if (actor.role !== 'SUPER_ADMIN' && dto.trialDays !== undefined) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the platform administrator sets trials.',
      });
    }
    const now = new Date();
    const seats = dto.seats ?? (await this.countSeats(tenantId));
    const existing = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    const period =
      existing && existing.currentPeriodEnd > now
        ? { start: existing.currentPeriodStart, end: existing.currentPeriodEnd }
        : periodFrom(now);
    const trialEndsAt = dto.trialDays
      ? new Date(now.getTime() + dto.trialDays * 86_400_000)
      : (existing?.trialEndsAt ?? null);
    const data = {
      planId: plan.id,
      seats,
      billingEmail: dto.billingEmail ?? existing?.billingEmail ?? null,
      billingName: dto.billingName ?? existing?.billingName ?? null,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      trialEndsAt,
      canceledAt: null,
      status: trialEndsAt && trialEndsAt > now ? 'trialing' : 'active',
    };
    const row = await this.prisma.subscription.upsert({
      where: { tenantId },
      create: { id: newId(), tenantId, ...data },
      update: data,
      include: {
        plan: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: existing
        ? 'billing.subscription.update'
        : 'billing.subscription.create',
      entityType: 'Subscription',
      entityId: row.id,
      details: {
        tenantId,
        planCode: plan.code,
        seats,
        trialDays: dto.trialDays,
      },
    });
    return {
      tenant: row.tenant,
      subscription: this.toSubscription(row, []),
      seatsNow: await this.countSeats(tenantId),
      estimate: this.estimate(plan, seats),
    };
  }

  async cancelSubscription(
    actor: AuthenticatedUser,
    requestedTenantId?: string,
  ) {
    const tenantId = this.tenantFor(actor, requestedTenantId);
    const row = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'billing.no_subscription',
        detail: 'This district has no subscription.',
      });
    await this.prisma.subscription.update({
      where: { id: row.id },
      data: { canceledAt: new Date(), status: 'canceled' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'billing.subscription.cancel',
      entityType: 'Subscription',
      entityId: row.id,
      details: { tenantId },
    });
    return this.subscription(actor, tenantId);
  }

  // Invoices -------------------------------------------------------------------------------------------

  async invoices(q: ListInvoicesQuery, actor: AuthenticatedUser) {
    const where: Prisma.InvoiceWhereInput = {};
    if (actor.role === 'SUPER_ADMIN') {
      if (q.tenantId) where.tenantId = q.tenantId;
    } else {
      where.tenantId = this.tenantFor(actor, q.tenantId);
    }
    const rows = await this.prisma.invoice.findMany({
      where,
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
    const now = new Date();
    const out = rows.map((r) => this.toInvoice(r, now));
    return q.status ? out.filter((i) => i.status === q.status) : out;
  }

  async invoice(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.invoice.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'billing.invoice_not_found',
        detail: 'Invoice not found.',
      });
    this.assertTenant(actor, row.tenantId);
    return this.toInvoice(row, new Date());
  }

  async generateInvoice(dto: GenerateInvoiceDto, actor: AuthenticatedUser) {
    const tenantId = this.tenantFor(actor, dto.tenantId);
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!sub)
      throw new NotFoundException({
        code: 'billing.no_subscription',
        detail: 'This district has no subscription.',
      });
    if (sub.canceledAt)
      throw new BadRequestException({
        code: 'billing.subscription_canceled',
        detail: 'The subscription is canceled.',
      });
    const period = dto.periodStart
      ? periodFrom(new Date(dto.periodStart))
      : { start: sub.currentPeriodStart, end: sub.currentPeriodEnd };
    const duplicate = await this.prisma.invoice.findFirst({
      where: { tenantId, periodStart: period.start, status: { not: 'void' } },
    });
    if (duplicate)
      throw new ConflictException({
        code: 'billing.period_invoiced',
        detail: `This period already has invoice ${duplicate.number}.`,
      });
    const seats = await this.countSeats(tenantId);
    const built = buildInvoiceLines(sub.plan, seats, period);
    const now = new Date();
    const year = now.getUTCFullYear();
    const count = await this.prisma.invoice.count({
      where: { number: { startsWith: `INV-${year}-` } },
    });
    const row = await this.prisma.invoice.create({
      data: {
        id: newId(),
        tenantId,
        subscriptionId: sub.id,
        number: invoiceNumber(year, count + 1),
        status: 'open',
        periodStart: period.start,
        periodEnd: period.end,
        lines: JSON.stringify(built.lines),
        subtotalCents: built.subtotalCents,
        taxCents: built.taxCents,
        totalCents: built.totalCents,
        issuedAt: now,
        dueAt: dueDateFor(now),
        note: dto.note?.trim() || null,
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (sub.seats !== seats)
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { seats },
      });
    // The next period starts when this one ends.
    if (period.end.getTime() === sub.currentPeriodEnd.getTime()) {
      const next = periodFrom(period.end);
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodStart: next.start, currentPeriodEnd: next.end },
      });
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'billing.invoice.create',
      entityType: 'Invoice',
      entityId: row.id,
      details: { tenantId, number: row.number, totalCents: row.totalCents },
    });
    return this.toInvoice(row, now);
  }

  async markPaid(
    id: string,
    dto: InvoiceActionDto,
    actor: AuthenticatedUser,
    provider = 'manual',
  ) {
    const row = await this.loadInvoice(id, actor);
    if (row.status !== 'open')
      throw new BadRequestException({
        code: 'billing.invoice_not_open',
        detail: `Invoice is ${row.status}.`,
      });
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        provider,
        providerRef: dto.reference?.trim() || null,
        note: dto.note?.trim() || row.note,
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    await this.refreshSubscriptionStatus(row.tenantId);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'billing.invoice.paid',
      entityType: 'Invoice',
      entityId: id,
      details: { provider, reference: dto.reference },
    });
    return this.toInvoice(updated, new Date());
  }

  async voidInvoice(
    id: string,
    dto: InvoiceActionDto,
    actor: AuthenticatedUser,
  ) {
    const row = await this.loadInvoice(id, actor);
    if (row.status === 'paid')
      throw new BadRequestException({
        code: 'billing.invoice_paid',
        detail: 'A paid invoice cannot be voided.',
      });
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'void',
        voidedAt: new Date(),
        note: dto.note?.trim() || row.note,
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    await this.refreshSubscriptionStatus(row.tenantId);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'billing.invoice.void',
      entityType: 'Invoice',
      entityId: id,
      details: { note: dto.note },
    });
    return this.toInvoice(updated, new Date());
  }

  async invoicePdf(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const inv = await this.invoice(id, actor);
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 54,
      info: { Title: `Invoice ${inv.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );
    doc.fontSize(20).text('SmartSchool');
    doc
      .moveDown(0.2)
      .fontSize(10)
      .fillColor('#555555')
      .text(`Invoice ${inv.number} · ${inv.status}`);
    doc.fillColor('#000000').moveDown(1).fontSize(11);
    doc.text(`Billed to: ${inv.tenant.name}`);
    doc.text(
      `Period: ${inv.periodStart.slice(0, 10)} to ${inv.periodEnd.slice(0, 10)}`,
    );
    doc.text(
      `Issued: ${inv.issuedAt.slice(0, 10)}   Due: ${inv.dueAt.slice(0, 10)}${inv.paidAt ? `   Paid: ${inv.paidAt.slice(0, 10)}` : ''}`,
    );
    doc.moveDown(1).fontSize(12).text('Lines');
    doc.moveDown(0.3).fontSize(10);
    for (const l of inv.lines)
      doc.text(
        `${l.description}  —  ${l.quantity} × ${centsToDollars(l.unitCents)} = ${centsToDollars(l.amountCents)}`,
      );
    doc
      .moveDown(0.8)
      .fontSize(11)
      .text(`Subtotal ${centsToDollars(inv.subtotalCents)}`);
    doc.text(`Tax ${centsToDollars(inv.taxCents)}`);
    doc
      .fontSize(13)
      .text(`Total ${centsToDollars(inv.totalCents)} ${inv.currency}`);
    if (inv.note)
      doc.moveDown(1).fontSize(10).fillColor('#555555').text(inv.note);
    doc.end();
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'billing.invoice.pdf',
      entityType: 'Invoice',
      entityId: id,
    });
    return { buffer: await done, fileName: `${inv.number}.pdf` };
  }

  // Idempotency ----------------------------------------------------------------------------------------

  /** Runs `fn` once per (actor, route, key): a repeat with the same body replays the stored answer, a different body is refused. */
  async withIdempotency<T>(
    actor: AuthenticatedUser,
    route: string,
    key: unknown,
    body: unknown,
    fn: () => Promise<T>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    if (!isValidIdempotencyKey(key)) {
      throw new BadRequestException({
        code: 'idempotency.key_required',
        detail:
          'Send an Idempotency-Key header of 8 to 120 letters, digits, dots, dashes or colons.',
      });
    }
    const now = new Date();
    const fingerprint = requestFingerprint(body);
    const stored = await this.prisma.idempotencyKey.findUnique({
      where: { actorId_route_key: { actorId: actor.id, route, key } },
    });
    const decision = idempotencyDecision(stored, fingerprint, now);
    if (decision === 'replay' && stored)
      return {
        status: stored.statusCode,
        body: JSON.parse(stored.responseBody) as T,
        replayed: true,
      };
    if (decision === 'mismatch') {
      throw new UnprocessableEntityException({
        code: 'idempotency.mismatch',
        detail:
          'This Idempotency-Key was already used with a different request body.',
      });
    }
    const result = await fn();
    await this.prisma.idempotencyKey.upsert({
      where: { actorId_route_key: { actorId: actor.id, route, key } },
      create: {
        id: newId(),
        actorId: actor.id,
        route,
        key,
        requestHash: fingerprint,
        statusCode: 201,
        responseBody: JSON.stringify(result),
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_HOURS * 3_600_000),
      },
      update: {
        requestHash: fingerprint,
        statusCode: 201,
        responseBody: JSON.stringify(result),
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_HOURS * 3_600_000),
      },
    });
    return { status: 201, body: result, replayed: false };
  }

  // Usage ----------------------------------------------------------------------------------------------

  async usage(q: UsageQuery, actor: AuthenticatedUser) {
    const tenantId = this.tenantFor(actor, q.tenantId);
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from
      ? new Date(q.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    const rows = await this.prisma.usageDaily.findMany({
      where: {
        tenantId,
        day: {
          gte: new Date(`${dayKey(from)}T00:00:00.000Z`),
          lte: new Date(`${dayKey(to)}T00:00:00.000Z`),
        },
      },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: [{ day: 'asc' }],
    });
    const byDay = new Map<string, UsageRow>();
    for (const r of rows) {
      const key = dayKey(r.day);
      const d = byDay.get(key) ?? {
        day: key,
        apiRequests: 0,
        aiCalls: 0,
        activeUsers: 0,
        activeStudents: 0,
        storageMb: 0,
      };
      d.apiRequests += r.apiRequests;
      d.aiCalls += r.aiCalls;
      d.activeUsers += r.activeUsers;
      d.activeStudents += r.activeStudents;
      d.storageMb += r.storageMb;
      byDay.set(key, d);
    }
    const days = Array.from(byDay.values());
    const schools = new Map<
      string,
      { organizationId: string; name: string } & Omit<UsageRow, 'day'>
    >();
    for (const r of rows) {
      const s = schools.get(r.organizationId) ?? {
        organizationId: r.organizationId,
        name: r.organization.name,
        apiRequests: 0,
        aiCalls: 0,
        activeUsers: 0,
        activeStudents: 0,
        storageMb: 0,
      };
      s.apiRequests += r.apiRequests;
      s.aiCalls += r.aiCalls;
      s.activeUsers = Math.max(s.activeUsers, r.activeUsers);
      s.activeStudents = Math.max(s.activeStudents, r.activeStudents);
      s.storageMb = Math.max(s.storageMb, r.storageMb);
      schools.set(r.organizationId, s);
    }
    return {
      tenantId,
      from: dayKey(from),
      to: dayKey(to),
      days,
      totals: rollupUsage(days),
      schools: Array.from(schools.values()),
    };
  }

  // Platform overview ----------------------------------------------------------------------------------

  async overview() {
    const [tenants, subs, invoices] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.subscription.findMany({
        include: {
          plan: true,
          tenant: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.invoice.findMany({
        where: { status: 'open' },
        select: { tenantId: true, status: true, dueAt: true, totalCents: true },
      }),
    ]);
    const now = new Date();
    const byStatus: Record<string, number> = {};
    const rows = subs.map((s) => {
      const theirs = invoices.filter((i) => i.tenantId === s.tenantId);
      const status = subscriptionStatusFrom(s, theirs, now);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      return {
        tenant: s.tenant,
        planCode: s.plan.code,
        planName: s.plan.name,
        seats: s.seats,
        status,
        monthlyCents: monthlyAmountCents(s.plan, s.seats),
        currentPeriodEnd: s.currentPeriodEnd,
      };
    });
    const overdueCents = invoices
      .filter((i) => effectiveInvoiceStatus(i, now) === 'overdue')
      .reduce((a, i) => a + i.totalCents, 0);
    return {
      tenants,
      subscriptions: rows,
      byStatus,
      mrrCents: monthlyRecurringCents(
        subs.map((s) => ({
          status: s.canceledAt ? 'canceled' : s.status,
          seats: s.seats,
          plan: s.plan,
        })),
      ),
      openInvoiceCents: invoices.reduce((a, i) => a + i.totalCents, 0),
      overdueCents,
    };
  }

  // Provider webhook -----------------------------------------------------------------------------------

  async providerWebhook(rawBody: string, signature: string | undefined) {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET');
    if (!secret)
      throw new NotFoundException({
        code: 'billing.provider_off',
        detail: 'No payment provider is configured.',
      });
    if (!verifyProviderSignature(signature, rawBody, secret, new Date())) {
      throw new ForbiddenException({
        code: 'billing.bad_signature',
        detail: 'The webhook signature does not match.',
      });
    }
    let event: {
      type?: string;
      data?: {
        object?: { id?: string; metadata?: { invoiceNumber?: string } };
      };
    } = {};
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      throw new BadRequestException({
        code: 'billing.bad_payload',
        detail: 'The webhook body is not JSON.',
      });
    }
    const number = event.data?.object?.metadata?.invoiceNumber;
    if (event.type === 'invoice.paid' && number) {
      const inv = await this.prisma.invoice.findUnique({ where: { number } });
      if (inv && inv.status === 'open') {
        await this.prisma.invoice.update({
          where: { id: inv.id },
          data: {
            status: 'paid',
            paidAt: new Date(),
            provider: 'stripe',
            providerRef: event.data?.object?.id ?? null,
          },
        });
        await this.refreshSubscriptionStatus(inv.tenantId);
        await this.audit.record({
          userId: null,
          organizationId: null,
          action: 'billing.invoice.paid',
          entityType: 'Invoice',
          entityId: inv.id,
          details: { provider: 'stripe', reference: event.data?.object?.id },
        });
        return { received: true, applied: true };
      }
    }
    return { received: true, applied: false };
  }

  // Helpers --------------------------------------------------------------------------------------------

  private tenantFor(actor: AuthenticatedUser, requested?: string): string {
    if (actor.role === 'SUPER_ADMIN') {
      if (!requested)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'tenantId is required for the platform administrator.',
        });
      return requested;
    }
    if (!actor.tenantId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a district.',
      });
    if (requested && requested !== actor.tenantId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'That district is not yours.',
      });
    return actor.tenantId;
  }

  private assertTenant(actor: AuthenticatedUser, tenantId: string): void {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.tenantId !== tenantId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'That invoice belongs to another district.',
      });
  }

  private async loadInvoice(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Invoice> {
    const row = await this.prisma.invoice.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'billing.invoice_not_found',
        detail: 'Invoice not found.',
      });
    this.assertTenant(actor, row.tenantId);
    return row;
  }

  private async countSeats(tenantId: string): Promise<number> {
    const orgs = await this.prisma.organization.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    const counts = await Promise.all(
      orgs.map((o) =>
        this.prisma.student.count({
          where: {
            organizationId: o.id,
            enrollmentStatus: 'ACTIVE',
            deletedAt: null,
          },
        }),
      ),
    );
    return seatsFor(counts);
  }

  private async refreshSubscriptionStatus(tenantId: string): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    if (!sub) return;
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: 'open' },
      select: { status: true, dueAt: true },
    });
    const status = subscriptionStatusFrom(sub, invoices, new Date());
    if (status !== sub.status)
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status },
      });
  }

  private estimate(plan: SubscriptionPlan, seats: number) {
    const cents = monthlyAmountCents(plan, seats);
    return { seats, monthlyCents: cents, monthly: centsToDollars(cents) };
  }

  private toPlan(p: SubscriptionPlan) {
    let features: string[] = [];
    try {
      features = p.features ? (JSON.parse(p.features) as string[]) : [];
    } catch {
      features = [];
    }
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      pricePerStudentCents: p.pricePerStudentCents,
      minimumCents: p.minimumCents,
      includedStudents: p.includedStudents,
      features,
      isActive: p.isActive,
    };
  }

  private toSubscription(
    s: SubscriptionRow,
    openInvoices: Array<{ status: string; dueAt: Date }>,
  ) {
    return {
      id: s.id,
      tenantId: s.tenantId,
      plan: this.toPlan(s.plan),
      status: subscriptionStatusFrom(s, openInvoices, new Date()),
      seats: s.seats,
      billingEmail: s.billingEmail,
      billingName: s.billingName,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      trialEndsAt: s.trialEndsAt,
      provider: s.provider,
      canceledAt: s.canceledAt,
      createdAt: s.createdAt,
    };
  }

  private toInvoice(
    r: Invoice & { tenant: { id: string; name: string; slug: string } },
    now: Date,
  ) {
    let lines: InvoiceLine[] = [];
    try {
      lines = JSON.parse(r.lines) as InvoiceLine[];
    } catch {
      lines = [];
    }
    return {
      id: r.id,
      tenant: r.tenant,
      number: r.number,
      status: effectiveInvoiceStatus(r, now),
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      lines,
      subtotalCents: r.subtotalCents,
      taxCents: r.taxCents,
      totalCents: r.totalCents,
      total: centsToDollars(r.totalCents),
      currency: r.currency,
      issuedAt: r.issuedAt.toISOString(),
      dueAt: r.dueAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
      voidedAt: r.voidedAt?.toISOString() ?? null,
      provider: r.provider,
      providerRef: r.providerRef,
      note: r.note,
    };
  }
}
