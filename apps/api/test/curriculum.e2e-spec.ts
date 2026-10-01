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
interface CourseBody {
  id: string;
  courseCode: string;
  status: string;
  isPublished: boolean;
  canEdit: boolean;
  modules?: Array<{
    id: string;
    title: string;
    lessons: Array<{ id: string; title: string; content: string | null }>;
  }>;
}
interface ClassBody {
  id: string;
  name: string;
  enrolledCount: number;
  waitlistedCount: number;
  teachers: Array<{ id: string; isPrimary: boolean }>;
  myEnrollmentStatus?: string | null;
}
interface EnrollBody {
  enrolled: string[];
  waitlisted: string[];
  skipped: string[];
  notFound: string[];
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Courses, modules, lessons, classes and enrolment against a real database (seeded). */
describe('Curriculum and classes (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const stamp = Date.now();
  const tokens: Record<string, string> = {};
  let courseId = '';
  let moduleId = '';
  let classId = '';
  let teacherId = '';
  const studentIds: string[] = [];

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

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
    await Promise.all(['teacher', 'student', 'principal', 'parent'].map(login));
    const teacher = await prisma.user.findUniqueOrThrow({
      where: { email: 'teacher@smartschool.local' },
      select: { id: true, organizationId: true },
    });
    teacherId = teacher.id;
    for (let i = 0; i < 2; i++) {
      const s = await prisma.student.create({
        data: {
          id:
            `e2e${stamp}`.slice(0, 8).padEnd(8, '0') +
            `-0000-7000-8000-${String(i).padStart(12, '0')}`,
          organizationId: teacher.organizationId!,
          studentNumber: `E2E-C-${stamp}-${i}`,
          firstName: 'Class',
          lastName: `Tester${i}`,
        },
      });
      studentIds.push(s.id);
    }
  });

  afterAll(async () => {
    if (classId) await prisma.class.deleteMany({ where: { id: classId } });
    await prisma.course.deleteMany({
      where: { courseCode: { startsWith: `E2E-${stamp}` } },
    });
    await prisma.course.deleteMany({
      where: { title: { contains: `E2E ${stamp}` } },
    });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await app.close();
  });

  it('lets a teacher create a draft course with a generated code', async () => {
    const res = await request(server)
      .post('/api/v1/courses')
      .set(as('teacher'))
      .send({
        title: `E2E ${stamp} Biology`,
        subject: 'Science',
        gradeLevel: '10',
      })
      .expect(201);
    const body = res.body as CourseBody;
    expect(body.status).toBe('draft');
    expect(body.isPublished).toBe(false);
    expect(body.canEdit).toBe(true);
    expect(body.courseCode).toMatch(/^E2E-/);
    courseId = body.id;
  });

  it('hides the draft from students and refuses to publish it empty', async () => {
    await request(server)
      .get(`/api/v1/courses/${courseId}`)
      .set(as('student'))
      .expect(404);
    const res = await request(server)
      .post(`/api/v1/courses/${courseId}/publish`)
      .set(as('teacher'))
      .expect(400);
    expect((res.body as Problem).code).toBe('course.empty');
  });

  it('builds modules and lessons, reorders them, then publishes', async () => {
    const m1 = await request(server)
      .post(`/api/v1/courses/${courseId}/modules`)
      .set(as('teacher'))
      .send({ title: 'Cells' })
      .expect(201);
    const m2 = await request(server)
      .post(`/api/v1/courses/${courseId}/modules`)
      .set(as('teacher'))
      .send({ title: 'Genetics' })
      .expect(201);
    moduleId = (m1.body as { id: string }).id;
    const m2Id = (m2.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/modules/${moduleId}/lessons`)
      .set(as('teacher'))
      .send({ title: 'Cell structure', content: '# Cells' })
      .expect(201);
    await request(server)
      .post(`/api/v1/modules/${moduleId}/lessons`)
      .set(as('teacher'))
      .send({
        title: 'Mitosis',
        lessonType: 'video',
        contentUrl: 'https://example.org/mitosis',
      })
      .expect(201);
    const reordered = await request(server)
      .put(`/api/v1/courses/${courseId}/modules/order`)
      .set(as('teacher'))
      .send({ ids: [m2Id, moduleId] })
      .expect(200);
    expect(
      (reordered.body as { data: Array<{ id: string }> }).data.map((m) => m.id),
    ).toEqual([m2Id, moduleId]);
    const bad = await request(server)
      .put(`/api/v1/courses/${courseId}/modules/order`)
      .set(as('teacher'))
      .send({ ids: [moduleId] })
      .expect(400);
    expect((bad.body as Problem).code).toBe('request.invalid');
    const published = await request(server)
      .post(`/api/v1/courses/${courseId}/publish`)
      .set(as('teacher'))
      .expect(200);
    expect(published.body as CourseBody).toMatchObject({
      isPublished: true,
      status: 'active',
    });
  });

  it('shows the published course and its lessons to a student, without edit rights', async () => {
    const res = await request(server)
      .get(`/api/v1/courses/${courseId}`)
      .set(as('student'))
      .expect(200);
    const body = res.body as CourseBody;
    expect(body.canEdit).toBe(false);
    expect(body.modules).toHaveLength(2);
    expect(body.modules?.[1].lessons.map((l) => l.title)).toEqual([
      'Cell structure',
      'Mitosis',
    ]);
    await request(server)
      .post(`/api/v1/courses/${courseId}/modules`)
      .set(as('student'))
      .send({ title: 'Nope' })
      .expect(403);
  });

  it('clones the course as a new draft', async () => {
    const res = await request(server)
      .post(`/api/v1/courses/${courseId}/clone`)
      .set(as('principal'))
      .expect(201);
    const body = res.body as CourseBody;
    expect(body.status).toBe('draft');
    expect(body.courseCode).toContain('-COPY');
    const detail = await request(server)
      .get(`/api/v1/courses/${body.id}`)
      .set(as('principal'))
      .expect(200);
    expect((detail.body as CourseBody).modules).toHaveLength(2);
  });

  it('creates a class with capacity 1, assigns the teacher, enrols two students (one waitlisted)', async () => {
    const created = await request(server)
      .post('/api/v1/classes')
      .set(as('principal'))
      .send({
        courseId,
        name: `E2E ${stamp} Biology A`,
        term: '2026-Fall',
        maxStudents: 1,
        teacherId,
        startDate: '2026-09-01',
        endDate: '2026-12-18',
      })
      .expect(201);
    const body = created.body as ClassBody;
    classId = body.id;
    expect(body.teachers[0]).toMatchObject({ id: teacherId, isPrimary: true });
    const enrolled = await request(server)
      .post(`/api/v1/classes/${classId}/enrollments`)
      .set(as('teacher'))
      .send({
        studentIds: [...studentIds, '01900000-0000-7000-8000-000000000000'],
      })
      .expect(200);
    const result = enrolled.body as EnrollBody;
    expect(result.enrolled).toEqual([studentIds[0]]);
    expect(result.waitlisted).toEqual([studentIds[1]]);
    expect(result.notFound).toHaveLength(1);
    const again = await request(server)
      .post(`/api/v1/classes/${classId}/enrollments`)
      .set(as('teacher'))
      .send({ studentIds: [studentIds[0]] })
      .expect(200);
    expect((again.body as EnrollBody).skipped).toEqual([studentIds[0]]);
  });

  it('enforces capacity when promoting from the waitlist, then frees a seat by dropping', async () => {
    const full = await request(server)
      .patch(`/api/v1/classes/${classId}/enrollments/${studentIds[1]}`)
      .set(as('teacher'))
      .send({ status: 'enrolled' })
      .expect(409);
    expect((full.body as Problem).code).toBe('class.full');
    await request(server)
      .delete(`/api/v1/classes/${classId}/enrollments/${studentIds[0]}`)
      .set(as('teacher'))
      .expect(204);
    await request(server)
      .patch(`/api/v1/classes/${classId}/enrollments/${studentIds[1]}`)
      .set(as('teacher'))
      .send({ status: 'enrolled' })
      .expect(200);
    const detail = await request(server)
      .get(`/api/v1/classes/${classId}`)
      .set(as('teacher'))
      .expect(200);
    expect(detail.body as ClassBody).toMatchObject({
      enrolledCount: 1,
      waitlistedCount: 0,
    });
  });

  it('lists the seeded class for the demo student and their parent, and hides others', async () => {
    const mine = await request(server)
      .get('/api/v1/classes/mine')
      .set(as('student'))
      .expect(200);
    const names = (mine.body as { data: ClassBody[] }).data.map((c) => c.name);
    expect(names).toContain('English 7 - Section A');
    expect(names).not.toContain(`E2E ${stamp} Biology A`);
    const parent = await request(server)
      .get('/api/v1/classes/mine')
      .set(as('parent'))
      .expect(200);
    expect(
      (parent.body as { data: ClassBody[] }).data.map((c) => c.name),
    ).toContain('English 7 - Section A');
    await request(server)
      .get(`/api/v1/classes/${classId}`)
      .set(as('student'))
      .expect(404);
    await request(server)
      .get(`/api/v1/classes/${classId}/enrollments`)
      .set(as('student'))
      .expect(403);
  });

  it('refuses to archive a course with a running class', async () => {
    const res = await request(server)
      .delete(`/api/v1/courses/${courseId}`)
      .set(as('principal'))
      .expect(409);
    expect((res.body as Problem).code).toBe('course.in_use');
  });
});
