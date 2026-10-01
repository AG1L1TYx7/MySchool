/**
 * Idempotent baseline seed. Safe to run repeatedly.
 *   pnpm --filter @smartschool/api db:seed
 *
 * Creates: the feature catalogue with default role assignments, feature flags, the demo
 * organisation, and demo accounts for every role. Demo passwords are development-only.
 */
import { createAdapter } from '../src/infra/prisma/connection';
import { PrismaClient, Role } from '../src/generated/prisma/client';
import type { EnrollmentStatus } from '../src/generated/prisma/client';
import argon2 from 'argon2';
import { newId as uuidv7 } from '../src/common/utils/ids';
import { FEATURE_CATALOG } from '../src/modules/access/feature-catalog';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({
  adapter: createAdapter(process.env.DATABASE_URL),
});

export const DEMO_PASSWORD = 'SmartSchool!Demo2026';
const NL = String.fromCharCode(10);

const DEMO_USERS: Array<{
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}> = [
  {
    email: 'superadmin@smartschool.local',
    firstName: 'Sam',
    lastName: 'Admin',
    role: 'SUPER_ADMIN',
  },
  {
    email: 'superintendent@smartschool.local',
    firstName: 'Dana',
    lastName: 'Rivera',
    role: 'SUPERINTENDENT',
  },
  {
    email: 'principal@smartschool.local',
    firstName: 'Jordan',
    lastName: 'Lee',
    role: 'PRINCIPAL',
  },
  {
    email: 'teacher@smartschool.local',
    firstName: 'Jane',
    lastName: 'Teacher',
    role: 'TEACHER',
  },
  {
    email: 'student@smartschool.local',
    firstName: 'Emma',
    lastName: 'Johnson',
    role: 'STUDENT',
  },
  {
    email: 'parent@smartschool.local',
    firstName: 'Michael',
    lastName: 'Johnson',
    role: 'PARENT',
  },
  {
    email: 'assistant@smartschool.local',
    firstName: 'Alex',
    lastName: 'Aide',
    role: 'ASSISTANT',
  },
];

const FLAGS: Array<{ name: string; isEnabled: boolean; description: string }> =
  [
    {
      name: 'ai.tutor',
      isEnabled: true,
      description: 'Student-facing AI tutor',
    },
    {
      name: 'ai.content-generation',
      isEnabled: true,
      description: 'Teacher AI content generation',
    },
    {
      name: 'self-registration',
      isEnabled: true,
      description:
        'Allow students, parents and teachers to register themselves',
    },
  ];

async function seedFeatures(): Promise<void> {
  for (const def of FEATURE_CATALOG) {
    const feature = await prisma.feature.upsert({
      where: { code: def.code },
      update: {
        name: def.name,
        category: def.category,
        description: def.description ?? null,
      },
      create: {
        id: uuidv7(),
        code: def.code,
        name: def.name,
        category: def.category,
        description: def.description ?? null,
      },
    });
    for (const role of def.roles) {
      await prisma.roleFeature.upsert({
        where: { role_featureId: { role, featureId: feature.id } },
        update: {},
        create: { id: uuidv7(), role, featureId: feature.id },
      });
    }
  }
  console.log(
    `features: ${FEATURE_CATALOG.length} present with default role assignments`,
  );
}

async function seedFlags(): Promise<void> {
  for (const flag of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { name: flag.name },
      update: { description: flag.description },
      create: { id: uuidv7(), ...flag },
    });
  }
  console.log(`feature flags: ${FLAGS.length} present`);
}

async function seedOrganization(): Promise<string> {
  const existing = await prisma.organization.findFirst({
    where: { name: 'Demo School', deletedAt: null },
  });
  if (existing) {
    if (!existing.joinCode)
      await prisma.organization.update({
        where: { id: existing.id },
        data: { joinCode: 'DEMO-2026' },
      });
    return existing.id;
  }
  const org = await prisma.organization.create({
    data: {
      id: uuidv7(),
      name: 'Demo School',
      description: 'A demo school for development and evaluation',
      email: 'office@demo.smartschool.local',
      phone: '+1 555 0100',
      address: '123 Demo Street, Demo City',
      timezone: 'America/New_York',
      joinCode: 'DEMO-2026',
    },
  });
  console.log('organization: Demo School created');
  return org.id;
}

async function seedUsers(organizationId: string): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        organizationId: u.role === 'SUPER_ADMIN' ? null : organizationId,
      },
      create: {
        id: uuidv7(),
        email: u.email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        organizationId: u.role === 'SUPER_ADMIN' ? null : organizationId,
        emailVerifiedAt: new Date(),
      },
    });
  }
  console.log(
    `users: ${DEMO_USERS.length} demo accounts present (password: ${DEMO_PASSWORD})`,
  );
}

const DEMO_STUDENTS: Array<{
  studentNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
  gradeLevel: string;
  dateOfBirth: string;
  enrollmentStatus?: EnrollmentStatus;
}> = [
  {
    studentNumber: 'S2026-000001',
    firstName: 'Emma',
    lastName: 'Johnson',
    email: 'student@smartschool.local',
    gradeLevel: '7',
    dateOfBirth: '2013-04-12',
  },
  {
    studentNumber: 'S2026-000002',
    firstName: 'Liam',
    lastName: 'Garcia',
    gradeLevel: '7',
    dateOfBirth: '2013-08-03',
  },
  {
    studentNumber: 'S2026-000003',
    firstName: 'Olivia',
    lastName: 'Chen',
    gradeLevel: '8',
    dateOfBirth: '2012-01-27',
  },
  {
    studentNumber: 'S2026-000004',
    firstName: 'Noah',
    lastName: 'Patel',
    gradeLevel: '8',
    dateOfBirth: '2012-11-15',
  },
  {
    studentNumber: 'S2026-000005',
    firstName: 'Ava',
    lastName: 'Okafor',
    gradeLevel: '9',
    dateOfBirth: '2011-06-30',
  },
  {
    studentNumber: 'S2026-000006',
    firstName: 'Ethan',
    lastName: 'Novak',
    gradeLevel: '9',
    dateOfBirth: '2011-02-09',
    enrollmentStatus: 'INACTIVE',
  },
];

/** Demo student records; Emma is linked to the student@ account and to parent@ as her father. */
async function seedStudents(organizationId: string): Promise<void> {
  const studentUser = await prisma.user.findUnique({
    where: { email: 'student@smartschool.local' },
    select: { id: true },
  });
  const parentUser = await prisma.user.findUnique({
    where: { email: 'parent@smartschool.local' },
    select: { id: true },
  });
  for (const s of DEMO_STUDENTS) {
    const userId =
      s.email === 'student@smartschool.local'
        ? (studentUser?.id ?? null)
        : null;
    const data = {
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email ?? null,
      gradeLevel: s.gradeLevel,
      dateOfBirth: new Date(s.dateOfBirth + 'T00:00:00Z'),
      enrollmentStatus: s.enrollmentStatus ?? 'ACTIVE',
      enrollmentDate: new Date('2026-09-01T00:00:00Z'),
      userId,
    };
    const student = await prisma.student.upsert({
      where: {
        organizationId_studentNumber: {
          organizationId,
          studentNumber: s.studentNumber,
        },
      },
      update: data,
      create: {
        id: uuidv7(),
        organizationId,
        studentNumber: s.studentNumber,
        ...data,
      },
    });
    if (userId && parentUser) {
      await prisma.studentGuardian.upsert({
        where: {
          studentId_guardianUserId: {
            studentId: student.id,
            guardianUserId: parentUser.id,
          },
        },
        update: {},
        create: {
          id: uuidv7(),
          studentId: student.id,
          guardianUserId: parentUser.id,
          relationship: 'FATHER',
          isPrimary: true,
        },
      });
    }
  }
  console.log(
    `students: ${DEMO_STUDENTS.length} demo records present (Emma Johnson linked to student@ and parent@)`,
  );
}

/** Two published courses with modules and lessons, two classes for the 2026-Fall term with the demo teacher and students. */
async function seedCurriculum(organizationId: string): Promise<void> {
  const teacher = await prisma.user.findUnique({
    where: { email: 'teacher@smartschool.local' },
    select: { id: true },
  });
  const courses: Array<{
    courseCode: string;
    title: string;
    subject: string;
    gradeLevel: string;
    description: string;
    modules: Array<{
      title: string;
      lessons: Array<{ title: string; content: string }>;
    }>;
    className: string;
    studentNumbers: string[];
  }> = [
    {
      courseCode: 'MATH-ALG1',
      title: 'Algebra I',
      subject: 'Mathematics',
      gradeLevel: '9',
      description:
        'Linear equations, inequalities, functions and an introduction to quadratics.',
      modules: [
        {
          title: 'Linear equations',
          lessons: [
            {
              title: 'Solving one-step equations',
              content:
                '# One-step equations' +
                NL +
                NL +
                'Undo the operation applied to the variable. If 3 was added, subtract 3 from both sides.',
            },
            {
              title: 'Two-step equations',
              content:
                '# Two-step equations' +
                NL +
                NL +
                'Undo addition or subtraction first, then multiplication or division.',
            },
          ],
        },
        {
          title: 'Graphing lines',
          lessons: [
            {
              title: 'Slope and intercept',
              content:
                '# Slope-intercept form' +
                NL +
                NL +
                'y = mx + b, where m is the slope and b is where the line crosses the y-axis.',
            },
            {
              title: 'Graphing from a table',
              content:
                '# Tables to graphs' +
                NL +
                NL +
                'Plot each (x, y) pair, then connect the points with a straight line.',
            },
          ],
        },
      ],
      className: 'Algebra I - Section A',
      studentNumbers: ['S2026-000005'],
    },
    {
      courseCode: 'ELA-7',
      title: 'English Language Arts 7',
      subject: 'English',
      gradeLevel: '7',
      description:
        'Reading comprehension, narrative and persuasive writing, vocabulary.',
      modules: [
        {
          title: 'Narrative writing',
          lessons: [
            {
              title: 'Story structure',
              content:
                '# Story structure' +
                NL +
                NL +
                'Exposition, rising action, climax, falling action, resolution.',
            },
            {
              title: 'Show, do not tell',
              content:
                '# Show, do not tell' +
                NL +
                NL +
                'Use sensory detail and action instead of naming the emotion.',
            },
          ],
        },
      ],
      className: 'English 7 - Section A',
      studentNumbers: ['S2026-000001', 'S2026-000002'],
    },
  ];

  for (const c of courses) {
    const course = await prisma.course.upsert({
      where: {
        organizationId_courseCode: { organizationId, courseCode: c.courseCode },
      },
      update: {
        title: c.title,
        subject: c.subject,
        gradeLevel: c.gradeLevel,
        description: c.description,
      },
      create: {
        id: uuidv7(),
        organizationId,
        courseCode: c.courseCode,
        title: c.title,
        subject: c.subject,
        gradeLevel: c.gradeLevel,
        description: c.description,
        status: 'ACTIVE',
        isPublished: true,
        publishedAt: new Date(),
        instructorId: teacher?.id ?? null,
        createdById: teacher?.id ?? null,
      },
    });
    const existingModules = await prisma.module.count({
      where: { courseId: course.id },
    });
    if (existingModules === 0) {
      for (const [mi, m] of c.modules.entries()) {
        const mod = await prisma.module.create({
          data: {
            id: uuidv7(),
            courseId: course.id,
            title: m.title,
            sortOrder: mi,
          },
        });
        for (const [li, l] of m.lessons.entries()) {
          await prisma.lesson.create({
            data: {
              id: uuidv7(),
              moduleId: mod.id,
              title: l.title,
              content: l.content,
              lessonType: 'TEXT',
              sortOrder: li,
              durationMinutes: 30,
            },
          });
        }
      }
    }
    let klass = await prisma.class.findFirst({
      where: {
        organizationId,
        courseId: course.id,
        term: '2026-Fall',
        deletedAt: null,
      },
    });
    if (!klass) {
      klass = await prisma.class.create({
        data: {
          id: uuidv7(),
          organizationId,
          courseId: course.id,
          name: c.className,
          section: 'A',
          term: '2026-Fall',
          startDate: new Date('2026-09-01T00:00:00Z'),
          endDate: new Date('2026-12-18T00:00:00Z'),
          room: '101',
          maxStudents: 25,
          status: 'IN_PROGRESS',
        },
      });
      if (teacher)
        await prisma.classTeacher.create({
          data: {
            id: uuidv7(),
            classId: klass.id,
            teacherId: teacher.id,
            isPrimary: true,
          },
        });
    }
    for (const number of c.studentNumbers) {
      const student = await prisma.student.findUnique({
        where: {
          organizationId_studentNumber: {
            organizationId,
            studentNumber: number,
          },
        },
        select: { id: true },
      });
      if (!student) continue;
      await prisma.classEnrollment.upsert({
        where: {
          classId_studentId: { classId: klass.id, studentId: student.id },
        },
        update: {},
        create: {
          id: uuidv7(),
          classId: klass.id,
          studentId: student.id,
          status: 'ENROLLED',
        },
      });
    }
  }
  console.log(
    'curriculum: ' +
      courses.length +
      ' courses with modules, lessons, one class each and demo enrolments',
  );
}

/** A rubric, one published assignment per class, Emma's submission and grade, and a week of attendance. */
async function seedAcademics(organizationId: string): Promise<void> {
  const teacher = await prisma.user.findUnique({
    where: { email: 'teacher@smartschool.local' },
    select: { id: true },
  });
  const classes = await prisma.class.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      enrollments: {
        where: { status: 'ENROLLED' },
        select: { studentId: true },
      },
    },
  });
  if (classes.length === 0) return;

  let rubric = await prisma.rubric.findFirst({
    where: {
      organizationId,
      title: 'Written response rubric',
      deletedAt: null,
    },
  });
  if (!rubric) {
    rubric = await prisma.rubric.create({
      data: {
        id: uuidv7(),
        organizationId,
        createdById: teacher?.id ?? null,
        title: 'Written response rubric',
        description: 'General-purpose rubric for short written answers.',
        criteria: JSON.stringify([
          {
            id: 'accuracy',
            title: 'Accuracy',
            maxPoints: 4,
            levels: [
              { label: 'Correct and complete', points: 4 },
              { label: 'Minor errors', points: 3 },
              { label: 'Partly correct', points: 2 },
              { label: 'Attempted', points: 1 },
            ],
          },
          { id: 'reasoning', title: 'Reasoning shown', maxPoints: 4 },
          { id: 'clarity', title: 'Clarity', maxPoints: 2 },
        ]),
        isTemplate: true,
      },
    });
  }

  const emma = await prisma.student.findUnique({
    where: {
      organizationId_studentNumber: {
        organizationId,
        studentNumber: 'S2026-000001',
      },
    },
    select: { id: true },
  });
  for (const klass of classes) {
    const title = klass.name.startsWith('Algebra')
      ? 'Solving two-step equations'
      : 'Story structure paragraph';
    let assignment = await prisma.assignment.findFirst({
      where: { classId: klass.id, title, deletedAt: null },
    });
    if (!assignment) {
      assignment = await prisma.assignment.create({
        data: {
          id: uuidv7(),
          organizationId,
          classId: klass.id,
          createdById: teacher?.id ?? null,
          title,
          description: klass.name.startsWith('Algebra')
            ? 'Solve the ten equations on the worksheet and show every step.'
            : 'Write one paragraph that names the five parts of a story using the book we read.',
          type: 'HOMEWORK',
          submissionType: 'ONLINE',
          category: 'Homework',
          maxPoints: 10,
          weight: 1,
          dueAt: new Date('2026-10-08T23:59:00Z'),
          allowLateUntil: new Date('2026-10-12T23:59:00Z'),
          latePenaltyPercent: 10,
          maxAttempts: 3,
          rubricId: rubric.id,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-09-28T12:00:00Z'),
        },
      });
    }
    const enrolledEmma =
      emma && klass.enrollments.some((e) => e.studentId === emma.id);
    if (enrolledEmma && emma) {
      const existing = await prisma.assignmentSubmission.findFirst({
        where: { assignmentId: assignment.id, studentId: emma.id },
      });
      if (!existing) {
        const submission = await prisma.assignmentSubmission.create({
          data: {
            id: uuidv7(),
            assignmentId: assignment.id,
            studentId: emma.id,
            attemptNumber: 1,
            status: 'GRADED',
            textContent:
              'Exposition introduces the characters, rising action builds the problem, the climax is the turning point, falling action shows the results and the resolution ends the story.',
            submittedAt: new Date('2026-10-05T18:30:00Z'),
          },
        });
        await prisma.grade.create({
          data: {
            id: uuidv7(),
            assignmentId: assignment.id,
            studentId: emma.id,
            submissionId: submission.id,
            gradedById: teacher?.id ?? null,
            score: 9,
            maxPoints: 10,
            percentage: 90,
            letterGrade: 'A',
            feedback:
              'Clear and complete. Next time give an example from the book for each part.',
            rubricScores: JSON.stringify([
              { criterionId: 'accuracy', points: 4 },
              { criterionId: 'reasoning', points: 3 },
              { criterionId: 'clarity', points: 2 },
            ]),
            gradedAt: new Date('2026-10-06T09:00:00Z'),
          },
        });
        await prisma.classEnrollment.updateMany({
          where: { classId: klass.id, studentId: emma.id },
          data: { currentGrade: 90 },
        });
      }
    }
    // five school days of attendance for everyone enrolled
    const days = [
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ];
    for (const [di, day] of days.entries()) {
      for (const [si, e] of klass.enrollments.entries()) {
        const status =
          (di + si) % 7 === 3
            ? 'LATE'
            : (di + si) % 11 === 5
              ? 'ABSENT'
              : 'PRESENT';
        await prisma.attendance.upsert({
          where: {
            classId_studentId_date: {
              classId: klass.id,
              studentId: e.studentId,
              date: new Date(day + 'T00:00:00Z'),
            },
          },
          update: {},
          create: {
            id: uuidv7(),
            classId: klass.id,
            studentId: e.studentId,
            date: new Date(day + 'T00:00:00Z'),
            status,
            markedById: teacher?.id ?? null,
          },
        });
      }
    }
  }
  console.log(
    'academics: rubric, one assignment per class, demo submission and grade, five days of attendance',
  );
}

async function main(): Promise<void> {
  await seedFeatures();
  await seedFlags();
  const orgId = await seedOrganization();
  await seedUsers(orgId);
  await seedStudents(orgId);
  await seedCurriculum(orgId);
  await seedAcademics(orgId);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('seed complete');
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
