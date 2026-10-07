import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { newId } from '../src/common/utils/ids';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Tenant {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  verification: { name: string; value: string } | null;
  schools: number;
}
interface Overview {
  tenant: { id: string; slug: string };
  totals: { schools: number; students: number };
  schools: Array<{ organizationId: string; name: string; students: number }>;
}
interface Paged<T> {
  data: T[];
}

const PASSWORD = 'SmartSchool!Demo2026';
const DEFAULT_TENANT = '00000000-0000-7000-8000-000000000001';

/**
 * District and tenancy (slice 20, ADR-005): two districts on one platform never see each other,
 * a district's policy switches reach its schools, and state exports leave as CSV.
 */
describe('District (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let demoOrgId = '';
  let orgB = '';
  let tenantB = '';
  let slugB = '';
  let studentBNumber = '';

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const hash = () =>
    argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

  beforeAll(async () => {
    stub = await startAiStub(AI_STUB_TOKEN, AI_STUB_PORT);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    await Promise.all(
      ['superadmin', 'superintendent', 'student', 'principal'].map((r) =>
        login(r),
      ),
    );
    const demo = await prisma.organization.findFirstOrThrow({
      where: { name: 'Demo School', deletedAt: null },
    });
    demoOrgId = demo.id;
  });

  afterAll(async () => {
    await app?.close();
    stub.server.close();
  });

  // ---------------------------------------------------------------------------
  // Tenants (platform administrator)
  // ---------------------------------------------------------------------------

  it('lets only the platform administrator create a tenant', async () => {
    await request(server)
      .post('/api/v1/tenants')
      .set(as('superintendent'))
      .send({ name: `Beta District ${stamp}` })
      .expect(403);
    const res = await request(server)
      .post('/api/v1/tenants')
      .set(as('superadmin'))
      .send({
        name: `Beta District ${stamp}`,
        branding: {
          displayName: 'Beta Public Schools',
          primaryColor: '#7c2d12',
        },
      })
      .expect(201);
    const t = res.body as Tenant;
    tenantB = t.id;
    slugB = t.slug;
    expect(slugB).toBe(`beta-district-${stamp}`);
    expect(t.schools).toBe(0);

    // A second school and its people live in the new district.
    const org = await prisma.organization.create({
      data: {
        id: newId(),
        tenantId: tenantB,
        name: `Beta Middle ${stamp}`,
        timezone: 'America/Denver',
        joinCode: `BETA-${String(stamp).slice(-6)}`,
      },
    });
    orgB = org.id;
    const mk = async (role: string) =>
      prisma.user.create({
        data: {
          id: newId(),
          email: `${role}-beta-${stamp}@smartschool.local`,
          passwordHash: await hash(),
          passwordChangedAt: new Date(),
          firstName: 'Beta',
          lastName: role,
          role: role.toUpperCase() as never,
          organizationId: orgB,
          emailVerifiedAt: new Date(),
        },
      });
    const [supB, studentUser] = await Promise.all([
      mk('superintendent'),
      mk('student'),
    ]);
    studentBNumber = `BETA-${stamp}`;
    await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgB,
        userId: studentUser.id,
        studentNumber: studentBNumber,
        firstName: 'Beta',
        lastName: 'Student',
        gradeLevel: '7',
        enrollmentStatus: 'ACTIVE',
      },
    });
    await login('supB', supB.email);
    await login('studentB', studentUser.email);
  });

  it('serves branding publicly by slug', async () => {
    const res = await request(server)
      .get(`/api/v1/branding?tenant=${slugB}`)
      .expect(200);
    expect(res.body).toMatchObject({
      tenant: { slug: slugB },
      displayName: 'Beta Public Schools',
      primaryColor: '#7c2d12',
    });
    const demo = await request(server)
      .get('/api/v1/branding?tenant=demo')
      .expect(200);
    expect((demo.body as { tenant: { id: string } }).tenant.id).toBe(
      DEFAULT_TENANT,
    );
  });

  it('lists tenants for the platform administrator only', async () => {
    const res = await request(server)
      .get('/api/v1/tenants')
      .set(as('superadmin'))
      .expect(200);
    const ids = (res.body as Paged<Tenant>).data.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([DEFAULT_TENANT, tenantB]));
    await request(server)
      .get('/api/v1/tenants')
      .set(as('superintendent'))
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Two-tenant isolation
  // ---------------------------------------------------------------------------

  it('keeps each superintendent inside their own district', async () => {
    const listA = await request(server)
      .get('/api/v1/organizations')
      .set(as('superintendent'))
      .expect(200);
    const idsA = (listA.body as Paged<{ id: string }>).data.map((o) => o.id);
    expect(idsA).toContain(demoOrgId);
    expect(idsA).not.toContain(orgB);

    const listB = await request(server)
      .get('/api/v1/organizations')
      .set(as('supB'))
      .expect(200);
    const idsB = (listB.body as Paged<{ id: string }>).data.map((o) => o.id);
    expect(idsB).toEqual([orgB]);

    const crossA = await request(server)
      .get(`/api/v1/organizations/${orgB}`)
      .set(as('superintendent'))
      .expect(403);
    expect((crossA.body as Problem).code).toBe('authz.forbidden');
    await request(server)
      .get(`/api/v1/organizations/${demoOrgId}`)
      .set(as('supB'))
      .expect(403);

    // Student lists follow the same fence.
    const students = await request(server)
      .get('/api/v1/students')
      .set(as('supB'))
      .expect(200);
    const numbers = (
      students.body as Paged<{ studentNumber: string }>
    ).data.map((s) => s.studentNumber);
    expect(numbers).toEqual([studentBNumber]);

    // Tenant records: own district readable, the other district's not.
    await request(server)
      .get(`/api/v1/tenants/${tenantB}`)
      .set(as('supB'))
      .expect(200);
    await request(server)
      .get(`/api/v1/tenants/${tenantB}`)
      .set(as('superintendent'))
      .expect(403);
    await request(server)
      .patch(`/api/v1/tenants/${tenantB}`)
      .set(as('superintendent'))
      .send({ name: 'Hijacked' })
      .expect(403);
  });

  it('shows the district overview for the right district', async () => {
    const a = await request(server)
      .get('/api/v1/district/overview')
      .set(as('superintendent'))
      .expect(200);
    const ovA = a.body as Overview;
    expect(ovA.tenant.id).toBe(DEFAULT_TENANT);
    expect(ovA.schools.map((s) => s.organizationId)).toContain(demoOrgId);
    expect(ovA.schools.map((s) => s.organizationId)).not.toContain(orgB);
    expect(ovA.totals.students).toBeGreaterThan(0);

    const b = await request(server)
      .get('/api/v1/district/overview')
      .set(as('supB'))
      .expect(200);
    const ovB = b.body as Overview;
    expect(ovB.schools.map((s) => s.organizationId)).toEqual([orgB]);
    expect(ovB.totals).toMatchObject({ schools: 1, students: 1 });

    await request(server)
      .get(`/api/v1/district/overview?tenantId=${tenantB}`)
      .set(as('superintendent'))
      .expect(403);
    const platform = await request(server)
      .get(`/api/v1/district/overview?tenantId=${tenantB}`)
      .set(as('superadmin'))
      .expect(200);
    expect((platform.body as Overview).tenant.id).toBe(tenantB);

    await request(server)
      .get('/api/v1/district/overview')
      .set(as('principal'))
      .expect(403);
    await request(server)
      .get('/api/v1/district/overview')
      .set(as('student'))
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Policy switches
  // ---------------------------------------------------------------------------

  it('applies district policy switches to its schools', async () => {
    await request(server)
      .put(`/api/v1/tenants/${tenantB}/policies`)
      .set(as('superintendent'))
      .send({ aiEnabled: false })
      .expect(403);
    const bad = await request(server)
      .put(`/api/v1/tenants/${tenantB}/policies`)
      .set(as('supB'))
      .send({ aiDisabledSchools: [demoOrgId] })
      .expect(400);
    expect((bad.body as Problem).code).toBe('request.invalid');

    const before = await request(server)
      .get('/api/v1/me/motivation')
      .set(as('studentB'))
      .expect(200);
    expect(before.body).toBeDefined();

    const set = await request(server)
      .put(`/api/v1/tenants/${tenantB}/policies`)
      .set(as('supB'))
      .send({
        aiDisabledSchools: [orgB],
        disabledFeatures: ['motivation.view'],
        studentMessagingAllowed: false,
        retention: { auditLogDays: 400 },
      })
      .expect(200);
    expect(set.body).toMatchObject({
      tenantId: tenantB,
    });
    expect((set.body as { policies: unknown }).policies).toMatchObject({
      aiEnabled: true,
      aiDisabledSchools: [orgB],
      disabledFeatures: ['motivation.view'],
      studentMessagingAllowed: false,
    });

    const blocked = await request(server)
      .get('/api/v1/me/motivation')
      .set(as('studentB'))
      .expect(403);
    expect((blocked.body as Problem).code).toBe('feature.disabled_by_district');
    const noAi = await request(server)
      .post('/api/v1/ai/tutor/conversations')
      .set(as('studentB'))
      .send({ mode: 'explain' })
      .expect(403);
    expect((noAi.body as Problem).code).toBe('ai.disabled_by_district');

    // The demo district is untouched.
    await request(server)
      .get('/api/v1/me/motivation')
      .set(as('student'))
      .expect(200);

    const read = await request(server)
      .get(`/api/v1/tenants/${tenantB}/policies`)
      .set(as('supB'))
      .expect(200);
    expect(
      (read.body as { policies: { retention: Record<string, number> } })
        .policies.retention.auditLogDays,
    ).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Reports and state exports
  // ---------------------------------------------------------------------------

  it('downloads cross-school reports and state exports as CSV', async () => {
    for (const kind of [
      'schools',
      'enrollment_by_grade',
      'attendance_daily',
      'ai_usage',
    ]) {
      const res = await request(server)
        .get(`/api/v1/district/reports/${kind}.csv`)
        .set(as('superintendent'))
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0]).toContain('School');
    }
    const schools = await request(server)
      .get('/api/v1/district/reports/schools.csv')
      .set(as('superintendent'))
      .expect(200);
    expect(schools.text).toContain('Demo School');
    expect(schools.text).not.toContain(`Beta Middle ${stamp}`);

    for (const kind of ['enrollment', 'attendance', 'discipline', 'grades']) {
      const res = await request(server)
        .get(`/api/v1/district/state-exports/${kind}.csv`)
        .set(as('supB'))
        .expect(200);
      expect(res.text.split('\n')[0]).toMatch(
        /^﻿?School code,School,Student number/,
      );
    }
    const enrollment = await request(server)
      .get('/api/v1/district/state-exports/enrollment.csv')
      .set(as('supB'))
      .expect(200);
    expect(enrollment.text).toContain(studentBNumber);
    expect(enrollment.text).not.toContain('S2026-');
    const exportedByA = await request(server)
      .get('/api/v1/district/state-exports/enrollment.csv')
      .set(as('superintendent'))
      .expect(200);
    expect(exportedByA.text).toContain('S2026-');
    expect(exportedByA.text).not.toContain(studentBNumber);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'district.state_export', entityId: tenantB },
    });
    expect(audit).not.toBeNull();

    await request(server)
      .get('/api/v1/district/state-exports/enrollment.csv')
      .set(as('principal'))
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Hosting
  // ---------------------------------------------------------------------------

  it('attaches a custom domain and reports the verification record', async () => {
    const res = await request(server)
      .patch(`/api/v1/tenants/${tenantB}`)
      .set(as('superadmin'))
      .send({ customDomain: `beta-${stamp}.example.invalid` })
      .expect(200);
    const t = res.body as Tenant;
    expect(t.verification?.name).toBe(
      `_smartschool.beta-${stamp}.example.invalid`,
    );
    expect(t.verification?.value).toMatch(/^smartschool-verify=[0-9a-f]{32}$/);
    const verify = await request(server)
      .post(`/api/v1/tenants/${tenantB}/domain/verify`)
      .set(as('superadmin'))
      .expect(200);
    expect((verify.body as { verified: boolean }).verified).toBe(false);
    await request(server)
      .post(`/api/v1/tenants/${tenantB}/domain/verify`)
      .set(as('supB'))
      .expect(403);
    const bad = await request(server)
      .patch(`/api/v1/tenants/${tenantB}`)
      .set(as('superadmin'))
      .send({ slug: 'www' })
      .expect(400);
    expect((bad.body as Problem).code).toBe('request.invalid');
  });
});
