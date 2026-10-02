/**
 * Load-test data (docs/07 slice 8): a second organisation, "Load School", with 10,000 students, 400 teachers,
 * 40 courses, 400 classes of 25, one published assignment per class and a graded submission for every
 * fifth student. Idempotent: re-running updates in place. Demo data is untouched.
 *
 * Run: pnpm --filter @smartschool/api db:seed:load   (about a minute on a laptop)
 * Sign in: load.teacher1@load.smartschool.local / load.student1@load.smartschool.local, password SmartSchool!Load2026
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { newId } from '../src/common/utils/ids';
import { PrismaClient } from '../src/generated/prisma/client';
import { createAdapter } from '../src/infra/prisma/connection';

const prisma = new PrismaClient({
  adapter: createAdapter(process.env.DATABASE_URL ?? ''),
});

export const LOAD_PASSWORD = 'SmartSchool!Load2026';
const STUDENTS = Number(process.env.LOAD_STUDENTS ?? 10_000);
const TEACHERS = 400;
const COURSES = 40;
const CLASS_SIZE = 25;
const CLASSES = Math.ceil(STUDENTS / CLASS_SIZE);
const DOMAIN = 'load.smartschool.local';
const FIRST = [
  'Ava',
  'Liam',
  'Mia',
  'Noah',
  'Zoe',
  'Ethan',
  'Isla',
  'Lucas',
  'Maya',
  'Owen',
  'Nora',
  'Eli',
  'Ruby',
  'Jack',
  'Leah',
  'Caleb',
  'Ivy',
  'Mason',
  'Ella',
  'Levi',
];
const LAST = [
  'Lopez',
  'Nguyen',
  'Patel',
  'Garcia',
  'Kim',
  'Brown',
  'Singh',
  'Okafor',
  'Rossi',
  'Chen',
  'Martin',
  'Silva',
  'Khan',
  'Weber',
  'Diaz',
  'Cohen',
  'Moore',
  'Ali',
  'Park',
  'Reyes',
];
const SUBJECTS = [
  'Math',
  'English',
  'Science',
  'History',
  'Spanish',
  'Art',
  'Music',
  'PE',
];

const chunk = <T>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, (i + 1) * size),
  );
const name = (i: number) => ({
  firstName: FIRST[i % FIRST.length],
  lastName:
    LAST[Math.floor(i / FIRST.length) % LAST.length] +
    (i >= FIRST.length * LAST.length
      ? String(Math.floor(i / (FIRST.length * LAST.length)))
      : ''),
});

async function main(): Promise<void> {
  const started = Date.now();
  const passwordHash = await argon2.hash(LOAD_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const org = await prisma.organization.upsert({
    where: { joinCode: 'LOAD-2026' },
    update: {},
    create: {
      id: newId(),
      name: 'Load School',
      description: 'Synthetic school for load tests (10,000 students)',
      address: '1 Benchmark Way, Austin, TX',
      timezone: 'America/Chicago',
      isActive: true,
      joinCode: 'LOAD-2026',
    },
  });
  console.log(`organisation ${org.name} (${org.id})`);

  // Teachers
  const existingTeachers = await prisma.user.findMany({
    where: { organizationId: org.id, role: 'TEACHER' },
    select: { id: true, email: true },
  });
  const teacherByEmail = new Map(existingTeachers.map((t) => [t.email, t.id]));
  const teacherRows = [];
  for (let i = 1; i <= TEACHERS; i++) {
    const email = `load.teacher${i}@${DOMAIN}`;
    if (teacherByEmail.has(email)) continue;
    const n = name(i + 7);
    const id = newId();
    teacherByEmail.set(email, id);
    teacherRows.push({
      id,
      email,
      passwordHash,
      firstName: n.firstName,
      lastName: n.lastName,
      role: 'TEACHER' as const,
      organizationId: org.id,
      status: 'ACTIVE' as const,
      emailVerifiedAt: new Date(),
    });
  }
  for (const batch of chunk(teacherRows, 500))
    await prisma.user.createMany({ data: batch });
  const teacherIds = [...teacherByEmail.values()];
  console.log(`teachers: ${teacherIds.length}`);

  // Students with user accounts
  const existingStudents = await prisma.student.findMany({
    where: { organizationId: org.id },
    select: { id: true, studentNumber: true },
  });
  const studentByNumber = new Map(
    existingStudents.map((s) => [s.studentNumber, s.id]),
  );
  const userRows = [];
  const studentRows = [];
  for (let i = 1; i <= STUDENTS; i++) {
    const studentNumber = `L${String(i).padStart(6, '0')}`;
    if (studentByNumber.has(studentNumber)) continue;
    const n = name(i);
    const userId = newId();
    const studentId = newId();
    const grade = 6 + (i % 7);
    studentByNumber.set(studentNumber, studentId);
    userRows.push({
      id: userId,
      email: `load.student${i}@${DOMAIN}`,
      passwordHash,
      firstName: n.firstName,
      lastName: n.lastName,
      role: 'STUDENT' as const,
      organizationId: org.id,
      status: 'ACTIVE' as const,
      emailVerifiedAt: new Date(),
    });
    studentRows.push({
      id: studentId,
      organizationId: org.id,
      userId,
      studentNumber,
      firstName: n.firstName,
      lastName: n.lastName,
      email: `load.student${i}@${DOMAIN}`,
      gradeLevel: String(grade),
      dateOfBirth: new Date(Date.UTC(2026 - 5 - grade, i % 12, 1 + (i % 28))),
      enrollmentStatus: 'ACTIVE' as const,
      enrollmentDate: new Date('2026-08-20T00:00:00Z'),
    });
  }
  for (const batch of chunk(userRows, 1000))
    await prisma.user.createMany({ data: batch });
  for (const batch of chunk(studentRows, 1000))
    await prisma.student.createMany({ data: batch });
  const studentIds = [...studentByNumber.values()];
  console.log(`students: ${studentIds.length}`);

  // Courses
  const courseIds: string[] = [];
  for (let i = 1; i <= COURSES; i++) {
    const subject = SUBJECTS[i % SUBJECTS.length];
    const grade = 6 + (i % 7);
    const courseCode = `LOAD-${subject.slice(0, 3).toUpperCase()}-${i}`;
    const teacherId = teacherIds[i % teacherIds.length];
    const course = await prisma.course.upsert({
      where: {
        organizationId_courseCode: { organizationId: org.id, courseCode },
      },
      update: {},
      create: {
        id: newId(),
        organizationId: org.id,
        courseCode,
        title: `${subject} ${grade}`,
        subject,
        gradeLevel: String(grade),
        description: `Load course ${i}`,
        status: 'ACTIVE',
        isPublished: true,
        publishedAt: new Date(),
        instructorId: teacherId,
        createdById: teacherId,
      },
    });
    courseIds.push(course.id);
    const modules = await prisma.module.count({
      where: { courseId: course.id },
    });
    if (modules === 0) {
      const mod = await prisma.module.create({
        data: {
          id: newId(),
          courseId: course.id,
          title: 'Unit 1',
          sortOrder: 0,
          isPublished: true,
        },
      });
      await prisma.lesson.createMany({
        data: Array.from({ length: 5 }, (_, li) => ({
          id: newId(),
          moduleId: mod.id,
          title: `Lesson ${li + 1}`,
          content: `Lesson ${li + 1} of ${subject} ${grade}. `.repeat(40),
          lessonType: 'TEXT' as const,
          sortOrder: li,
          durationMinutes: 30,
          isPublished: true,
        })),
      });
    }
  }
  console.log(`courses: ${courseIds.length}`);

  // Classes of 25 with a teacher, enrolments, one assignment, a grade for every fifth student
  const existingClasses = await prisma.class.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true },
  });
  const classByName = new Map(existingClasses.map((c) => [c.name, c.id]));
  let enrolments = 0;
  let grades = 0;
  for (let c = 0; c < CLASSES; c++) {
    const courseId = courseIds[c % courseIds.length];
    const teacherId = teacherIds[c % teacherIds.length];
    const className = `Load class ${c + 1}`;
    let classId = classByName.get(className);
    if (!classId) {
      classId = newId();
      await prisma.class.create({
        data: {
          id: classId,
          organizationId: org.id,
          courseId,
          name: className,
          section: String.fromCharCode(65 + (c % 6)),
          term: '2026-Fall',
          startDate: new Date('2026-09-01T00:00:00Z'),
          endDate: new Date('2026-12-18T00:00:00Z'),
          room: String(100 + (c % 40)),
          maxStudents: CLASS_SIZE,
          status: 'IN_PROGRESS',
        },
      });
      await prisma.classTeacher.create({
        data: { id: newId(), classId, teacherId, isPrimary: true },
      });
      const members = studentIds.slice(c * CLASS_SIZE, (c + 1) * CLASS_SIZE);
      await prisma.classEnrollment.createMany({
        data: members.map((studentId) => ({
          id: newId(),
          classId: classId as string,
          studentId,
          status: 'ENROLLED' as const,
        })),
      });
      enrolments += members.length;
      const assignment = await prisma.assignment.create({
        data: {
          id: newId(),
          organizationId: org.id,
          classId,
          createdById: teacherId,
          title: `Week 1 check (${className})`,
          type: 'HOMEWORK',
          submissionType: 'ONLINE',
          category: 'Homework',
          maxPoints: 20,
          weight: 1,
          dueAt: new Date('2026-09-12T23:59:00Z'),
          status: 'PUBLISHED',
          publishedAt: new Date('2026-09-05T00:00:00Z'),
        },
      });
      const graded = members.filter((_, i) => i % 5 === 0);
      for (const studentId of graded) {
        const submission = await prisma.assignmentSubmission.create({
          data: {
            id: newId(),
            assignmentId: assignment.id,
            studentId,
            attemptNumber: 1,
            status: 'GRADED',
            textContent: 'Load submission',
            submittedAt: new Date('2026-09-10T15:00:00Z'),
          },
        });
        const score = 12 + (grades % 9);
        await prisma.grade.create({
          data: {
            id: newId(),
            assignmentId: assignment.id,
            studentId,
            submissionId: submission.id,
            gradedById: teacherId,
            score,
            maxPoints: 20,
            percentage: (score / 20) * 100,
            letterGrade: score >= 18 ? 'A' : score >= 16 ? 'B' : 'C',
            gradedAt: new Date('2026-09-11T09:00:00Z'),
          },
        });
        grades += 1;
      }
    }
    if ((c + 1) % 50 === 0) console.log(`classes: ${c + 1}/${CLASSES}`);
  }
  console.log(`enrolments added: ${enrolments}, grades added: ${grades}`);
  console.log(
    `load seed complete in ${Math.round((Date.now() - started) / 1000)} s`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
