import {
  buildInvoiceLines,
  effectiveInvoiceStatus,
  idempotencyDecision,
  invoiceNumber,
  isAiRoute,
  isValidIdempotencyKey,
  monthlyAmountCents,
  monthlyRecurringCents,
  periodFrom,
  PLATFORM_PLANS,
  requestFingerprint,
  rollupUsage,
  seatsFor,
  signProviderPayload,
  subscriptionStatusFrom,
  verifyProviderSignature,
  prorationCents,
  settleInvoice,
  taxCentsFor,
} from './billing-rules';

const plan = (code: string) => PLATFORM_PLANS.find((p) => p.code === code)!;
const now = new Date('2026-10-13T12:00:00Z');

describe('billing rules', () => {
  it('prices a month: starter is free within its included students, district never under its minimum', () => {
    expect(monthlyAmountCents(plan('starter'), 120)).toBe(0);
    expect(monthlyAmountCents(plan('district'), 100)).toBe(50_000);
    expect(monthlyAmountCents(plan('district'), 1000)).toBe(300_000);
    expect(monthlyAmountCents(plan('enterprise'), 10_000)).toBe(5_000_000);
  });

  it('builds a period a month long and clamps the end day', () => {
    const p = periodFrom(new Date('2026-01-31T10:00:00Z'));
    expect(p.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(
      periodFrom(new Date('2026-10-13')).end.toISOString().slice(0, 10),
    ).toBe('2026-11-13');
  });

  it('numbers invoices by year and sequence and writes lines that add up', () => {
    expect(invoiceNumber(2026, 7)).toBe('INV-2026-00007');
    const period = periodFrom(new Date('2026-10-01'));
    const small = buildInvoiceLines(plan('district'), 100, period);
    expect(small.lines).toHaveLength(2);
    expect(small.totalCents).toBe(50_000);
    expect(small.lines[1].description).toContain('Minimum');
    const big = buildInvoiceLines(plan('district'), 1000, period);
    expect(big.lines).toHaveLength(1);
    expect(big.totalCents).toBe(300_000);
    const free = buildInvoiceLines(plan('starter'), 90, period);
    expect(free.totalCents).toBe(0);
    expect(free.lines[0].description).toContain('no charge');
  });

  it('marks invoices overdue after the grace period and subscriptions past due with them', () => {
    const due = new Date('2026-09-01T00:00:00Z');
    expect(
      effectiveInvoiceStatus(
        { status: 'open', dueAt: due },
        new Date('2026-09-10'),
      ),
    ).toBe('open');
    expect(
      effectiveInvoiceStatus(
        { status: 'open', dueAt: due },
        new Date('2026-09-20'),
      ),
    ).toBe('overdue');
    expect(
      effectiveInvoiceStatus(
        { status: 'paid', dueAt: due },
        new Date('2026-12-01'),
      ),
    ).toBe('paid');
    const sub = { canceledAt: null, trialEndsAt: null };
    expect(
      subscriptionStatusFrom(sub, [{ status: 'open', dueAt: due }], now),
    ).toBe('past_due');
    expect(
      subscriptionStatusFrom(sub, [{ status: 'paid', dueAt: due }], now),
    ).toBe('active');
    expect(
      subscriptionStatusFrom({ canceledAt: now, trialEndsAt: null }, [], now),
    ).toBe('canceled');
    expect(
      subscriptionStatusFrom(
        { canceledAt: null, trialEndsAt: new Date('2026-11-01') },
        [{ status: 'open', dueAt: due }],
        now,
      ),
    ).toBe('trialing');
  });

  it('adds up recurring revenue and seats', () => {
    expect(
      monthlyRecurringCents([
        { status: 'active', seats: 1000, plan: plan('district') },
        { status: 'canceled', seats: 1000, plan: plan('district') },
        { status: 'trialing', seats: 50, plan: plan('starter') },
      ]),
    ).toBe(300_000);
    expect(seatsFor([120, 80, -3])).toBe(200);
  });

  it('fingerprints bodies in any key order and decides replay, mismatch or new', () => {
    const a = requestFingerprint({ planCode: 'district', seats: 10 });
    const b = requestFingerprint({ seats: 10, planCode: 'district' });
    expect(a).toBe(b);
    expect(requestFingerprint({ seats: 11, planCode: 'district' })).not.toBe(a);
    const stored = {
      requestHash: a,
      expiresAt: new Date(now.getTime() + 3600_000),
    };
    expect(idempotencyDecision(stored, a, now)).toBe('replay');
    expect(idempotencyDecision(stored, 'other', now)).toBe('mismatch');
    expect(
      idempotencyDecision(
        { ...stored, expiresAt: new Date(now.getTime() - 1) },
        a,
        now,
      ),
    ).toBe('new');
    expect(idempotencyDecision(null, a, now)).toBe('new');
    expect(isValidIdempotencyKey('order-2026-10-13-001')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('has space here')).toBe(false);
  });

  it('verifies a provider signature, refuses stale or wrong ones', () => {
    const body = '{"type":"invoice.paid","data":{"id":"in_1"}}';
    const header = signProviderPayload(body, 'whsec_test', now);
    expect(verifyProviderSignature(header, body, 'whsec_test', now)).toBe(true);
    expect(verifyProviderSignature(header, body + ' ', 'whsec_test', now)).toBe(
      false,
    );
    expect(verifyProviderSignature(header, body, 'whsec_other', now)).toBe(
      false,
    );
    expect(
      verifyProviderSignature(
        header,
        body,
        'whsec_test',
        new Date(now.getTime() + 600_000),
      ),
    ).toBe(false);
    expect(verifyProviderSignature(undefined, body, 'whsec_test', now)).toBe(
      false,
    );
    expect(verifyProviderSignature(header, body, '', now)).toBe(false);
  });

  it('rolls usage up and knows which routes are AI calls', () => {
    const r = rollupUsage([
      {
        day: '2026-10-01',
        apiRequests: 100,
        aiCalls: 5,
        activeUsers: 10,
        activeStudents: 8,
        storageMb: 20,
      },
      {
        day: '2026-10-02',
        apiRequests: 50,
        aiCalls: 2,
        activeUsers: 14,
        activeStudents: 9,
        storageMb: 22,
      },
    ]);
    expect(r).toEqual({
      apiRequests: 150,
      aiCalls: 7,
      peakActiveUsers: 14,
      peakActiveStudents: 9,
      storageMb: 22,
      days: 2,
    });
    expect(isAiRoute('/api/v1/ai/tutor/chat')).toBe(true);
    expect(isAiRoute('/api/v1/assistant/plan')).toBe(true);
    expect(isAiRoute('/api/v1/classes')).toBe(false);
  });
});

describe('proration and tax (slice 30)', () => {
  const period = {
    start: new Date('2026-10-01T00:00:00Z'),
    end: new Date('2026-11-01T00:00:00Z'),
  };
  it('charges the difference for the rest of the period and credits a downgrade', () => {
    const mid = new Date('2026-10-16T12:00:00Z'); // exactly half of 31 days
    expect(prorationCents(50000, 80000, period, mid)).toBe(15000);
    expect(prorationCents(80000, 50000, period, mid)).toBe(-15000);
    expect(
      prorationCents(50000, 80000, period, new Date('2026-12-01T00:00:00Z')),
    ).toBe(0);
    expect(
      prorationCents(50000, 80000, period, new Date('2026-09-01T00:00:00Z')),
    ).toBe(30000);
    expect(
      prorationCents(1, 2, { start: period.end, end: period.start }, mid),
    ).toBe(0);
  });
  it('taxes the subtotal and settles the adjustment onto the lines', () => {
    expect(taxCentsFor(50000, 8.25)).toBe(4125);
    expect(taxCentsFor(50000, 0)).toBe(0);
    expect(taxCentsFor(-5, 10)).toBe(0);
    const settled = settleInvoice(
      {
        lines: [
          {
            description: 'Plan',
            quantity: 1,
            unitCents: 50000,
            amountCents: 50000,
          },
        ],
        subtotalCents: 50000,
      },
      15000,
      8.25,
    );
    expect(settled.lines).toHaveLength(2);
    expect(settled.lines[1].description).toMatch(/^Proration/);
    expect(settled).toMatchObject({
      subtotalCents: 65000,
      taxCents: 5363,
      totalCents: 70363,
    });
    const credited = settleInvoice({ lines: [], subtotalCents: 0 }, -99999, 5);
    expect(credited).toMatchObject({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
    expect(credited.lines[0].description).toMatch(/^Credit/);
  });
});
