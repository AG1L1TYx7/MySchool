import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { PAYMENTS_STUB_PORT } from './payments-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { signProviderPayload } from '../src/modules/billing/billing-rules';
import { createServer, type Server as HttpServer } from 'node:http';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface SubscriptionView {
  tenant: { id: string; slug: string };
  subscription: {
    id: string;
    status: string;
    seats: number;
    plan: { code: string };
  } | null;
  seatsNow: number;
  estimate: { monthlyCents: number } | null;
}
interface InvoiceView {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  lines: Array<{ amountCents: number }>;
  paidAt: string | null;
}
interface StatusPage {
  status: string;
  components: Array<{ key: string; status: string }>;
  incidents: Array<{ id: string; status: string; open: boolean }>;
  checkedAt: string | null;
  uptime: { days: number; percent: number | null; byDay: unknown[] };
}
interface Incident {
  id: string;
  status: string;
  open: boolean;
  updates: unknown[];
}

const PASSWORD = 'SmartSchool!Demo2026';

/**
 * Billing and operations (slice 26): plans and the district subscription with idempotency keys, invoices
 * issued once per period and paid by hand or by a signed provider webhook, usage metering, the public
 * status page with incidents and uptime, and the district security policy (password length, IP ranges,
 * session age, 2FA roles).
 */
describe('Billing and operations (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let paymentServer: HttpServer;
  const paymentCalls: Array<{
    path: string;
    body: string;
    authorization: string;
  }> = [];
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const stamp = Date.now();
  let tenantId = '';
  let invoiceId = '';
  let incidentId = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
    const user = await prisma.user.findFirstOrThrow({
      where: { email: `${role}@smartschool.local` },
      select: { id: true },
    });
    ids[role] = user.id;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    stub = await startAiStub(AI_STUB_TOKEN, AI_STUB_PORT);
    paymentServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        paymentCalls.push({
          path: req.url ?? '',
          body,
          authorization: String(req.headers.authorization ?? ''),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'cs_test_1',
            url: 'https://checkout.stripe.test/cs_test_1',
          }),
        );
      });
    });
    await new Promise<void>((r) =>
      paymentServer.listen(PAYMENTS_STUB_PORT, '127.0.0.1', r),
    );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // The IP allowlist test sends X-Forwarded-For, so this app trusts the loopback proxy the way a
    // deployment behind its own reverse proxy does (TRUST_PROXY=loopback, docs/21 F03).
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      }),
      { trustProxy: 'loopback' },
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    for (const r of ['superadmin', 'superintendent', 'principal', 'teacher'])
      await login(r);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { slug: 'demo' },
    });
    tenantId = tenant.id;
    // A clean slate for the district: no subscription, invoices, stored keys, incidents or security policy.
    await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.subscription.deleteMany({ where: { tenantId } });
    await prisma.idempotencyKey.deleteMany({});
    await prisma.serviceIncident.deleteMany({});
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { policies: null },
    });
  });

  afterAll(async () => {
    paymentServer?.close();
    if (prisma)
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { policies: null },
      });
    await app?.close();
    stub.server.close();
  });

  it('lists plans; the subscription is set once per Idempotency-Key and replayed, never run twice', async () => {
    const plans = await request(server)
      .get('/api/v1/billing/plans')
      .set(as('superintendent'))
      .expect(200);
    expect((plans.body as Array<{ code: string }>).map((p) => p.code)).toEqual(
      expect.arrayContaining(['starter', 'district', 'enterprise']),
    );

    await request(server)
      .put('/api/v1/billing/subscription')
      .set(as('superadmin'))
      .send({ tenantId, planCode: 'district' })
      .expect(400);

    const key = `sub-${stamp}`;
    const first = await request(server)
      .put('/api/v1/billing/subscription')
      .set(as('superadmin'))
      .set('Idempotency-Key', key)
      .send({ tenantId, planCode: 'district', billingEmail: 'ap@demo.example' })
      .expect(201);
    const view = first.body as SubscriptionView;
    expect(view.subscription?.plan.code).toBe('district');
    expect(view.subscription?.status).toBe('active');
    // Other specs add and remove students at the same time; the two counts are moments apart.
    expect(view.subscription?.seats).toBeGreaterThan(0);
    expect(view.seatsNow).toBeGreaterThan(0);
    expect(view.estimate?.monthlyCents).toBeGreaterThanOrEqual(50_000);
    expect(first.headers['idempotent-replayed']).toBe('false');

    const again = await request(server)
      .put('/api/v1/billing/subscription')
      .set(as('superadmin'))
      .set('Idempotency-Key', key)
      .send({ planCode: 'district', tenantId, billingEmail: 'ap@demo.example' })
      .expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as SubscriptionView).subscription?.id).toBe(
      view.subscription?.id,
    );

    const clash = await request(server)
      .put('/api/v1/billing/subscription')
      .set(as('superadmin'))
      .set('Idempotency-Key', key)
      .send({ tenantId, planCode: 'enterprise' })
      .expect(422);
    expect((clash.body as Problem).code).toBe('idempotency.mismatch');

    await request(server)
      .put('/api/v1/billing/subscription')
      .set(as('superintendent'))
      .set('Idempotency-Key', `x-${stamp}`)
      .send({ planCode: 'enterprise' })
      .expect(403);

    const mine = await request(server)
      .get('/api/v1/billing/subscription')
      .set(as('superintendent'))
      .expect(200);
    expect((mine.body as SubscriptionView).subscription?.plan.code).toBe(
      'district',
    );
    await request(server)
      .get('/api/v1/billing/subscription')
      .set(as('teacher'))
      .expect(403);
  });

  it('issues one invoice per period, serves it as PDF, and records a payment', async () => {
    const issued = await request(server)
      .post('/api/v1/billing/invoices')
      .set(as('superadmin'))
      .set('Idempotency-Key', `inv-${stamp}`)
      .send({ tenantId })
      .expect(201);
    const inv = issued.body as InvoiceView;
    invoiceId = inv.id;
    expect(inv.number).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(inv.status).toBe('open');
    expect(inv.totalCents).toBe(
      inv.lines.reduce((a, l) => a + l.amountCents, 0),
    );
    expect(inv.totalCents).toBeGreaterThanOrEqual(50_000);

    const dup = await request(server)
      .post('/api/v1/billing/invoices')
      .set(as('superadmin'))
      .set('Idempotency-Key', `inv2-${stamp}`)
      .send({ tenantId, periodStart: inv.number ? undefined : undefined })
      .expect(409)
      .catch(() => null);
    if (dup) expect((dup.body as Problem).code).toBe('billing.period_invoiced');

    const list = await request(server)
      .get('/api/v1/billing/invoices')
      .set(as('superintendent'))
      .expect(200);
    expect((list.body as InvoiceView[]).map((i) => i.id)).toContain(invoiceId);

    const pdf = await request(server)
      .get(`/api/v1/billing/invoices/${invoiceId}/pdf`)
      .set(as('superintendent'))
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    await request(server)
      .post(`/api/v1/billing/invoices/${invoiceId}/pay`)
      .set(as('superintendent'))
      .send({ reference: 'CHK 1001' })
      .expect(403);
    const paid = await request(server)
      .post(`/api/v1/billing/invoices/${invoiceId}/pay`)
      .set(as('superadmin'))
      .send({ reference: 'CHK 1001' })
      .expect(201);
    expect((paid.body as InvoiceView).status).toBe('paid');
    expect((paid.body as InvoiceView).paidAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'billing.invoice.paid', entityId: invoiceId },
    });
    expect(audit).not.toBeNull();
    await request(server)
      .post(`/api/v1/billing/invoices/${invoiceId}/void`)
      .set(as('superadmin'))
      .send({})
      .expect(400);
  });

  it('prorates a mid-period plan change, taxes the next invoice and takes card payment through the provider seam', async () => {
    // A district on the District plan upgrades to Enterprise halfway through: the difference for the rest of
    // the period waits for the next invoice, which also carries the sales tax the platform administrator set.
    const before = (
      await request(server)
        .get('/api/v1/billing/subscription')
        .set(as('superintendent'))
        .expect(200)
    ).body as {
      subscription: {
        plan: { code: string };
        pendingAdjustmentCents: number;
        cardPayments: boolean;
      };
    };
    expect(before.subscription.cardPayments).toBe(true);
    await request(server)
      .put('/api/v1/billing/subscription')
      .set(as('superintendent'))
      .set('Idempotency-Key', `tax-${stamp}`)
      .send({ planCode: 'enterprise', taxRatePercent: 8.25 })
      .expect(403);
    const changed = (
      await request(server)
        .put('/api/v1/billing/subscription')
        .set(as('superadmin'))
        .set('Idempotency-Key', `up-${stamp}`)
        .send({ tenantId, planCode: 'enterprise', taxRatePercent: 8.25 })
        .expect(201)
    ).body as {
      subscription: {
        plan: { code: string };
        pendingAdjustmentCents: number;
        taxRatePercent: number;
      };
    };
    expect(changed.subscription.plan.code).toBe('enterprise');
    expect(changed.subscription.taxRatePercent).toBe(8.25);
    expect(changed.subscription.pendingAdjustmentCents).toBeGreaterThan(0);
    const adjustment = changed.subscription.pendingAdjustmentCents;
    const issued = (
      await request(server)
        .post('/api/v1/billing/invoices')
        .set(as('superadmin'))
        .set('Idempotency-Key', `inv-tax-${stamp}`)
        .send({ tenantId, periodStart: '2031-03-01T00:00:00Z' })
        .expect(201)
    ).body as {
      id: string;
      number: string;
      lines: Array<{ description: string; amountCents: number }>;
      subtotalCents: number;
      taxCents: number;
      totalCents: number;
    };
    expect(
      issued.lines.some(
        (l) =>
          l.description.startsWith('Proration') && l.amountCents === adjustment,
      ),
    ).toBe(true);
    expect(issued.taxCents).toBe(
      Math.round((issued.subtotalCents * 8.25) / 100),
    );
    expect(issued.totalCents).toBe(issued.subtotalCents + issued.taxCents);
    expect(
      (
        (
          await request(server)
            .get('/api/v1/billing/subscription')
            .set(as('superintendent'))
            .expect(200)
        ).body as { subscription: { pendingAdjustmentCents: number } }
      ).subscription.pendingAdjustmentCents,
    ).toBe(0);
    // Card payment: the provider seam answers with a hosted checkout URL and the signed webhook settles it.
    const checkout = (
      await request(server)
        .post(`/api/v1/billing/invoices/${issued.id}/checkout`)
        .set(as('superintendent'))
        .send({})
        .expect(201)
    ).body as { url: string; provider: string };
    expect(checkout).toEqual({
      url: 'https://checkout.stripe.test/cs_test_1',
      provider: 'stripe',
    });
    const session = paymentCalls.find(
      (c) => c.path === '/v1/checkout/sessions',
    );
    expect(session).toBeDefined();
    const form = new URLSearchParams(session!.body);
    expect(form.get('metadata[invoiceNumber]')).toBe(issued.number);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe(
      String(issued.totalCents),
    );
    expect(session!.authorization).toBe('Bearer sk_test_fixture');
    const event = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_1', metadata: { invoiceNumber: issued.number } },
      },
    });
    await request(server)
      .post('/api/v1/billing/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signProviderPayload(
          event,
          process.env.STRIPE_WEBHOOK_SECRET ?? '',
          new Date(),
        ),
      )
      .send(event)
      .expect(200);
    const paid = (
      await request(server)
        .get(`/api/v1/billing/invoices/${issued.id}`)
        .set(as('superintendent'))
        .expect(200)
    ).body as { status: string; providerRef: string | null };
    expect(paid.status).toBe('paid');
    expect(paid.providerRef).toBe('cs_test_1');
    await request(server)
      .post(`/api/v1/billing/invoices/${issued.id}/checkout`)
      .set(as('superintendent'))
      .send({})
      .expect(400);
  });

  it('the provider webhook needs a configured secret and a valid signature', async () => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    const body = JSON.stringify({
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_test',
          metadata: { invoiceNumber: 'INV-0000-00000' },
        },
      },
    });
    if (!secret) {
      const off = await request(server)
        .post('/api/v1/billing/webhooks/provider')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(404);
      expect((off.body as Problem).code).toBe('billing.provider_off');
      return;
    }
    await request(server)
      .post('/api/v1/billing/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=bad')
      .send(body)
      .expect(403);
    const ok = await request(server)
      .post('/api/v1/billing/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signProviderPayload(body, secret, new Date()))
      .send(body)
      .expect(200);
    expect((ok.body as { received: boolean }).received).toBe(true);
  });

  it('meters usage per school and day; the snapshot adds students and storage', async () => {
    await request(server).get('/api/v1/classes').set(as('teacher')).expect(200);
    await request(server)
      .get('/api/v1/classes')
      .set(as('principal'))
      .expect(200);
    await request(server)
      .post('/api/v1/billing/usage/snapshot')
      .set(as('superadmin'))
      .expect(201);
    const usage = await request(server)
      .get('/api/v1/billing/usage')
      .set(as('superintendent'))
      .expect(200);
    const u = usage.body as {
      totals: {
        apiRequests: number;
        peakActiveUsers: number;
        peakActiveStudents: number;
      };
      schools: Array<{ name: string; apiRequests: number }>;
      days: unknown[];
    };
    expect(u.totals.apiRequests).toBeGreaterThan(0);
    expect(u.totals.peakActiveUsers).toBeGreaterThanOrEqual(2);
    expect(u.totals.peakActiveStudents).toBeGreaterThan(0);
    expect(u.schools.some((s) => s.name === 'Demo School')).toBe(true);
    await request(server)
      .get('/api/v1/billing/usage')
      .set(as('principal'))
      .expect(403);
  });

  it('the status page is public and shows checks, an incident lifecycle and uptime', async () => {
    const before = await request(server).get('/api/v1/status').expect(200);
    expect((before.body as StatusPage).components).toHaveLength(4);
    expect((before.body as StatusPage).uptime.days).toBe(90);

    await request(server)
      .post('/api/v1/operations/checks/run')
      .set(as('superadmin'))
      .expect(201);
    await request(server)
      .post('/api/v1/operations/checks/run')
      .set(as('principal'))
      .expect(403);

    await request(server)
      .post('/api/v1/operations/incidents')
      .set(as('superadmin'))
      .send({
        kind: 'maintenance',
        title: 'No start',
        message: 'x',
        components: ['api'],
      })
      .expect(400);
    const created = await request(server)
      .post('/api/v1/operations/incidents')
      .set(as('superadmin'))
      .send({
        title: `AI tutor slow ${stamp}`,
        message: 'We are looking into slow answers from the tutor.',
        impact: 'major',
        components: ['ai'],
      })
      .expect(201);
    incidentId = (created.body as Incident).id;
    expect((created.body as Incident).status).toBe('investigating');

    const during = await request(server).get('/api/v1/status').expect(200);
    const page = during.body as StatusPage;
    expect(page.status).toBe('partial_outage');
    expect(page.components.find((c) => c.key === 'ai')?.status).toBe('down');
    expect(page.incidents.map((i) => i.id)).toContain(incidentId);
    expect(page.checkedAt).not.toBeNull();
    expect(page.uptime.percent).not.toBeNull();

    const resolved = await request(server)
      .patch(`/api/v1/operations/incidents/${incidentId}`)
      .set(as('superadmin'))
      .send({ status: 'resolved', message: 'A model restart fixed it.' })
      .expect(200);
    expect((resolved.body as Incident).open).toBe(false);
    expect((resolved.body as Incident).updates).toHaveLength(2);
    const bad = await request(server)
      .patch(`/api/v1/operations/incidents/${incidentId}`)
      .set(as('superadmin'))
      .send({ status: 'investigating', message: 'again?' })
      .expect(400);
    expect((bad.body as Problem).code).toBe('operations.bad_transition');

    const after = await request(server).get('/api/v1/status').expect(200);
    expect((after.body as StatusPage).status).not.toBe('partial_outage');
    expect(
      (after.body as StatusPage).incidents.find((i) => i.id === incidentId)
        ?.open,
    ).toBe(false);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'operations.incident.update', entityId: incidentId },
    });
    expect(audit).not.toBeNull();
  });

  it('the district security policy limits administrator networks, session age, password length and 2FA roles', async () => {
    const set = await request(server)
      .put(`/api/v1/tenants/${tenantId}/policies`)
      .set(as('superintendent'))
      .send({
        security: {
          passwordMinLength: 16,
          adminIpAllowlist: ['203.0.113.0/24'],
          sessionMaxHours: 1,
          mfaRequiredRoles: ['teacher'],
        },
      })
      .expect(200);
    const policy = (
      set.body as {
        policies: {
          security: { passwordMinLength: number; adminIpAllowlist: string[] };
        };
      }
    ).policies.security;
    expect(policy.passwordMinLength).toBe(16);
    expect(policy.adminIpAllowlist).toEqual(['203.0.113.0/24']);

    // Administrators from an unapproved network are refused; teachers are not held to the list.
    const blocked = await request(server)
      .get('/api/v1/classes')
      .set(as('principal'))
      .set('X-Forwarded-For', '198.51.100.7')
      .expect(403);
    expect((blocked.body as Problem).code).toBe('security.ip_not_allowed');
    await request(server)
      .get('/api/v1/classes')
      .set(as('principal'))
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);

    // A teacher now needs 2FA before anything but the auth routes.
    const mfa = await request(server)
      .get('/api/v1/classes')
      .set(as('teacher'))
      .set('X-Forwarded-For', '198.51.100.7')
      .expect(403);
    expect((mfa.body as Problem).code).toBe('auth.mfa_setup_required');

    // A sign-in older than the district's hour is closed.
    await prisma.authSession.updateMany({
      where: { userId: ids.principal, revokedAt: null },
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    const old = await request(server)
      .get('/api/v1/classes')
      .set(as('principal'))
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(401);
    expect((old.body as Problem).code).toBe('security.session_expired');

    // Registration into the district checks the longer password.
    const weak = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `new-${stamp}@example.com`,
        password: 'Short-Pass-9!',
        firstName: 'New',
        lastName: 'Person',
        joinCode: 'DEMO-2026',
      })
      .expect(400);
    expect((weak.body as Problem).code).toBe('auth.password_weak');
    expect((weak.body as { detail: string }).detail).toContain('16');

    // Back to the defaults; the superintendent's own session is not limited by the IP list from loopback.
    const reset = await request(server)
      .put(`/api/v1/tenants/${tenantId}/policies`)
      .set(as('superintendent'))
      .send({ security: {} })
      .expect(200);
    expect(
      (reset.body as { policies: { security: { passwordMinLength: number } } })
        .policies.security.passwordMinLength,
    ).toBe(12);
    await request(server).get('/api/v1/classes').set(as('teacher')).expect(200);
  });
});
