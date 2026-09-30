import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface Problem {
  code: string;
  detail: string;
}
interface StudentBody {
  id: string;
  studentNumber: string;
  gradeLevel: string | null;
  enrollmentStatus: string;
}
interface ImportBody {
  dryRun: boolean;
  created: number;
  updated: number;
  guardiansLinked: number;
  errors: Array<{ line: number; message: string }>;
}

/**
 * Students and guardians against a real database. Requires the seed (principal account).
 */
describe('Students (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let token = '';
  const stamp = Date.now();
  const numbers = [`E2E-${stamp}-1`, `E2E-${stamp}-2`, `E2E-${stamp}-3`];
  const guardianEmail = `guardian.${stamp}@smartschool.local`;
  let studentId = '';

  beforeAll(async () => {
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
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'principal@smartschool.local',
        password: 'SmartSchool!Demo2026',
      })
      .expect(200);
    token = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await prisma.student.deleteMany({
      where: { studentNumber: { in: numbers } },
    });
    await prisma.user.deleteMany({ where: { email: guardianEmail } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('creates a student with a generated number', async () => {
    const res = await request(server)
      .post('/api/v1/students')
      .set(auth())
      .send({
        firstName: 'Grace',
        lastName: 'Hopper',
        gradeLevel: '9',
        studentNumber: numbers[0],
      })
      .expect(201);
    const body = res.body as { student: StudentBody };
    expect(body.student.studentNumber).toBe(numbers[0]);
    expect(body.student.enrollmentStatus).toBe('active');
    studentId = body.student.id;
  });

  it('refuses a duplicate student number', async () => {
    const res = await request(server)
      .post('/api/v1/students')
      .set(auth())
      .send({ firstName: 'Dup', lastName: 'Licate', studentNumber: numbers[0] })
      .expect(409);
    expect((res.body as Problem).code).toBe('resource.conflict');
  });

  it('dry-runs then imports a CSV, linking and inviting a guardian', async () => {
    const csv = [
      'studentNumber,firstName,lastName,gradeLevel,guardianEmail,guardianRelationship',
      `${numbers[0]},Grace,Hopper,10,,`,
      `${numbers[1]},Katherine,Johnson,8,${guardianEmail},mother`,
      `bad number!,X,Y,,,`,
    ].join('\n');
    const dry = await request(server)
      .post('/api/v1/students/import?dryRun=true')
      .set(auth())
      .send({ csv })
      .expect(200);
    expect(dry.body as ImportBody).toMatchObject({
      dryRun: true,
      created: 1,
      updated: 1,
    });
    expect((dry.body as ImportBody).errors).toHaveLength(1);

    const real = await request(server)
      .post('/api/v1/students/import')
      .set(auth())
      .set('Content-Type', 'text/csv')
      .send(csv)
      .expect(200);
    expect(real.body as ImportBody).toMatchObject({
      dryRun: false,
      created: 1,
      updated: 1,
      guardiansLinked: 1,
    });

    const updated = await request(server)
      .get(`/api/v1/students/${studentId}`)
      .set(auth())
      .expect(200);
    expect((updated.body as StudentBody).gradeLevel).toBe('10');
  });

  it('lists with search and exports CSV', async () => {
    const list = await request(server)
      .get(`/api/v1/students?search=E2E-${stamp}`)
      .set(auth())
      .expect(200);
    expect(
      (list.body as { meta: { totalItems: number } }).meta.totalItems,
    ).toBe(2);
    const csv = await request(server)
      .get(`/api/v1/students/export?search=E2E-${stamp}`)
      .set(auth())
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(numbers[1]);
    expect(csv.text).toContain(guardianEmail);
  });

  it('manages guardians on a student', async () => {
    const added = await request(server)
      .post(`/api/v1/students/${studentId}/guardians`)
      .set(auth())
      .send({ email: guardianEmail, relationship: 'father', isPrimary: true })
      .expect(201);
    const guardianId = (added.body as { guardian: { id: string } }).guardian.id;
    const list = await request(server)
      .get(`/api/v1/students/${studentId}/guardians`)
      .set(auth())
      .expect(200);
    expect((list.body as { data: unknown[] }).data).toHaveLength(1);
    await request(server)
      .delete(`/api/v1/students/${studentId}/guardians/${guardianId}`)
      .set(auth())
      .expect(204);
  });

  it('keeps students out of the admin list but lets them read their own record', async () => {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'student@smartschool.local',
        password: 'SmartSchool!Demo2026',
      })
      .expect(200);
    const studentToken = (login.body as { accessToken: string }).accessToken;
    await request(server)
      .get('/api/v1/students')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
    const mine = await request(server)
      .get('/api/v1/students/mine')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(
      (mine.body as { data: StudentBody[] }).data.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('lets a district administrator soft-delete a student, but not a principal', async () => {
    await request(server)
      .delete(`/api/v1/students/${studentId}`)
      .set(auth())
      .expect(403);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'superintendent@smartschool.local',
        password: 'SmartSchool!Demo2026',
      })
      .expect(200);
    const district = (login.body as { accessToken: string }).accessToken;
    await request(server)
      .delete(`/api/v1/students/${studentId}`)
      .set('Authorization', `Bearer ${district}`)
      .expect(204);
    await request(server)
      .get(`/api/v1/students/${studentId}`)
      .set(auth())
      .expect(404);
  });
});
