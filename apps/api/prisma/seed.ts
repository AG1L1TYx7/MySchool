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
import {
  PLATFORM_CODE_LESSONS,
  PLATFORM_SKILLS,
} from '../src/modules/careers/careers-rules';
import { FEATURE_CATALOG } from '../src/modules/access/feature-catalog';
import { H5P_LIBRARIES } from '../src/modules/h5p/h5p-libraries';
import { BADGES } from '../src/modules/motivation/motivation-rules';

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
  {
    email: 'counselor@smartschool.local',
    firstName: 'Casey',
    lastName: 'Counselor',
    role: 'COUNSELOR',
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
    // Roles the catalogue no longer lists lose the default grant (per-user overrides are separate).
    await prisma.roleFeature.deleteMany({
      where: { featureId: feature.id, role: { notIn: [...def.roles] } },
    });
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
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-7000-8000-000000000001' },
    update: {
      name: 'Demo District',
      slug: 'demo',
      branding: JSON.stringify({
        displayName: 'Demo District',
        primaryColor: '#1e40af',
      }),
    },
    create: {
      id: '00000000-0000-7000-8000-000000000001',
      name: 'Demo District',
      slug: 'demo',
      branding: JSON.stringify({
        displayName: 'Demo District',
        primaryColor: '#1e40af',
      }),
    },
  });
  const existing = await prisma.organization.findFirst({
    where: { name: 'Demo School', deletedAt: null },
  });
  if (existing) {
    await prisma.organization.update({
      where: { id: existing.id },
      data: {
        tenantId: tenant.id,
        ...(existing.joinCode ? {} : { joinCode: 'DEMO-2026' }),
      },
    });
    return existing.id;
  }
  const org = await prisma.organization.create({
    data: {
      id: uuidv7(),
      tenantId: tenant.id,
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

async function seedH5pLibraries(): Promise<void> {
  for (const l of H5P_LIBRARIES) {
    await prisma.h5PLibrary.upsert({
      where: {
        machineName_majorVersion_minorVersion_patchVersion: {
          machineName: l.machineName,
          majorVersion: l.major,
          minorVersion: l.minor,
          patchVersion: l.patch,
        },
      },
      update: {
        title: l.title,
        runnable: l.runnable,
        dependencies: JSON.stringify(l.dependencies),
      },
      create: {
        id: uuidv7(),
        machineName: l.machineName,
        majorVersion: l.major,
        minorVersion: l.minor,
        patchVersion: l.patch,
        title: l.title,
        runnable: l.runnable,
        dependencies: JSON.stringify(l.dependencies),
      },
    });
  }
  console.log(`h5p libraries: ${H5P_LIBRARIES.length} present`);
}

/** School year, terms, grading periods, a bell schedule, attendance codes and grade levels for the demo school. */
async function seedStructure(organizationId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      gradeLevels: '6,7,8',
      timezone: 'America/Chicago',
      attendanceDeadlineTime: '10:00',
    },
  });
  const year = await prisma.academicYear.upsert({
    where: { organizationId_name: { organizationId, name: '2026-2027' } },
    update: { isCurrent: true },
    create: {
      id: uuidv7(),
      organizationId,
      name: '2026-2027',
      startDate: new Date('2026-08-15T00:00:00Z'),
      endDate: new Date('2027-06-05T00:00:00Z'),
      isCurrent: true,
    },
  });
  const terms = [
    {
      name: 'Fall 2026',
      start: '2026-08-15',
      end: '2026-12-20',
      periods: [
        ['Q1', '2026-08-15', '2026-10-10'],
        ['Q2', '2026-10-11', '2026-12-20'],
      ],
    },
    {
      name: 'Spring 2027',
      start: '2027-01-05',
      end: '2027-06-05',
      periods: [
        ['Q3', '2027-01-05', '2027-03-13'],
        ['Q4', '2027-03-14', '2027-06-05'],
      ],
    },
  ];
  const termIds: string[] = [];
  for (const [i, t] of terms.entries()) {
    const term = await prisma.term.upsert({
      where: { academicYearId_name: { academicYearId: year.id, name: t.name } },
      update: {},
      create: {
        id: uuidv7(),
        academicYearId: year.id,
        name: t.name,
        type: 'SEMESTER',
        startDate: new Date(`${t.start}T00:00:00Z`),
        endDate: new Date(`${t.end}T00:00:00Z`),
        sortOrder: i,
      },
    });
    termIds.push(term.id);
    for (const [j, [name, start, end]] of t.periods.entries()) {
      await prisma.gradingPeriod.upsert({
        where: { termId_name: { termId: term.id, name } },
        update: {},
        create: {
          id: uuidv7(),
          termId: term.id,
          name,
          startDate: new Date(`${start}T00:00:00Z`),
          endDate: new Date(`${end}T00:00:00Z`),
          sortOrder: j,
        },
      });
    }
  }
  const schedule = await prisma.bellSchedule.upsert({
    where: { organizationId_name: { organizationId, name: 'Regular day' } },
    update: { isDefault: true },
    create: {
      id: uuidv7(),
      organizationId,
      name: 'Regular day',
      isDefault: true,
    },
  });
  const times = [
    ['08:00', '08:50'],
    ['08:55', '09:45'],
    ['09:50', '10:40'],
    ['10:45', '11:35'],
    ['12:15', '13:05'],
    ['13:10', '14:00'],
    ['14:05', '14:55'],
  ];
  const periodIds: string[] = [];
  for (const [i, [startTime, endTime]] of times.entries()) {
    const period = await prisma.period.upsert({
      where: {
        bellScheduleId_name: {
          bellScheduleId: schedule.id,
          name: String(i + 1),
        },
      },
      update: {},
      create: {
        id: uuidv7(),
        bellScheduleId: schedule.id,
        name: String(i + 1),
        startTime,
        endTime,
        days: 'MTWRF',
        sortOrder: i,
      },
    });
    periodIds.push(period.id);
  }
  const codes = [
    ['P', 'Present', 'PRESENT', true],
    ['T', 'Tardy', 'TARDY', true],
    ['AE', 'Absent, excused', 'EXCUSED', false],
    ['AU', 'Absent, unexcused', 'UNEXCUSED', false],
    ['R', 'Remote', 'REMOTE', true],
    ['FT', 'Field trip', 'OTHER', true],
    ['S', 'Suspended', 'UNEXCUSED', false],
  ] as const;
  for (const [i, [code, label, category, countsAsPresent]] of codes.entries()) {
    await prisma.attendanceCode.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: {},
      create: {
        id: uuidv7(),
        organizationId,
        code,
        label,
        category,
        countsAsPresent,
        sortOrder: i,
      },
    });
  }
  const classes = await prisma.class.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  for (const [i, klass] of classes.entries()) {
    await prisma.class.update({
      where: { id: klass.id },
      data: {
        academicYearId: year.id,
        termId: termIds[0],
        periodId: periodIds[i % periodIds.length],
        gradeLevel: klass.gradeLevel ?? '7',
      },
    });
  }
  console.log(
    `structure: year 2026-2027 with ${terms.length} terms, ${times.length} periods, ${codes.length} attendance codes`,
  );
}

/** Grade categories, a shared standards catalogue, a proficiency scale and the district scales for the demo. */
async function seedGrading(organizationId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      gradingScale: JSON.stringify([
        { letter: 'A', min: 90 },
        { letter: 'B', min: 80 },
        { letter: 'C', min: 70 },
        { letter: 'D', min: 60 },
        { letter: 'F', min: 0 },
      ]),
      gpaScale: JSON.stringify([
        { letter: 'A', points: 4 },
        { letter: 'B', points: 3 },
        { letter: 'C', points: 2 },
        { letter: 'D', points: 1 },
        { letter: 'F', points: 0 },
      ]),
    },
  });
  await prisma.proficiencyScale.upsert({
    where: { organizationId_name: { organizationId, name: 'Four levels' } },
    update: {},
    create: {
      id: uuidv7(),
      organizationId,
      name: 'Four levels',
      isDefault: true,
      levels: JSON.stringify([
        { level: 1, label: 'Beginning', minPercent: 0 },
        { level: 2, label: 'Developing', minPercent: 60 },
        { level: 3, label: 'Proficient', minPercent: 80 },
        { level: 4, label: 'Advanced', minPercent: 95 },
      ]),
    },
  });
  const sets: Array<{
    code: string;
    name: string;
    subject: string;
    jurisdiction: string;
    sourceUri: string;
    standards: Array<[string, string, string]>;
  }> = [
    {
      code: 'CCSS-MATH',
      name: 'Common Core State Standards: Mathematics',
      subject: 'Mathematics',
      jurisdiction: 'CCSSO',
      sourceUri: 'https://www.thecorestandards.org/Math/',
      standards: [
        [
          'CCSS.MATH.CONTENT.7.EE.A.1',
          'Apply properties of operations as strategies to add, subtract, factor, and expand linear expressions with rational coefficients.',
          '7',
        ],
        [
          'CCSS.MATH.CONTENT.7.EE.B.3',
          'Solve multi-step real-life and mathematical problems posed with positive and negative rational numbers in any form.',
          '7',
        ],
        [
          'CCSS.MATH.CONTENT.7.EE.B.4',
          'Use variables to represent quantities in a real-world or mathematical problem, and construct simple equations and inequalities to solve problems.',
          '7',
        ],
        [
          'CCSS.MATH.CONTENT.7.RP.A.2',
          'Recognize and represent proportional relationships between quantities.',
          '7',
        ],
        [
          'CCSS.MATH.CONTENT.7.NS.A.1',
          'Apply and extend previous understandings of addition and subtraction to add and subtract rational numbers.',
          '7',
        ],
        [
          'CCSS.MATH.CONTENT.8.EE.C.7',
          'Solve linear equations in one variable.',
          '8',
        ],
      ],
    },
    {
      code: 'CCSS-ELA',
      name: 'Common Core State Standards: English Language Arts',
      subject: 'English Language Arts',
      jurisdiction: 'CCSSO',
      sourceUri: 'https://www.thecorestandards.org/ELA-Literacy/',
      standards: [
        [
          'CCSS.ELA-LITERACY.RL.7.1',
          'Cite several pieces of textual evidence to support analysis of what the text says explicitly as well as inferences drawn from the text.',
          '7',
        ],
        [
          'CCSS.ELA-LITERACY.RL.7.3',
          'Analyze how particular elements of a story or drama interact.',
          '7',
        ],
        [
          'CCSS.ELA-LITERACY.W.7.3',
          'Write narratives to develop real or imagined experiences or events using effective technique, relevant descriptive details, and well-structured event sequences.',
          '7',
        ],
        [
          'CCSS.ELA-LITERACY.W.7.4',
          'Produce clear and coherent writing in which the development, organization, and style are appropriate to task, purpose, and audience.',
          '7',
        ],
      ],
    },
    {
      code: 'NGSS',
      name: 'Next Generation Science Standards',
      subject: 'Science',
      jurisdiction: 'NGSS Lead States',
      sourceUri: 'https://www.nextgenscience.org/',
      standards: [
        [
          'MS-PS1-1',
          'Develop models to describe the atomic composition of simple molecules and extended structures.',
          '6,7,8',
        ],
        [
          'MS-LS1-1',
          'Conduct an investigation to provide evidence that living things are made of cells.',
          '6,7,8',
        ],
        [
          'MS-ESS2-4',
          "Develop a model to describe the cycling of water through Earth's systems driven by energy from the sun and the force of gravity.",
          '6,7,8',
        ],
      ],
    },
    {
      code: 'TEKS-MATH',
      name: 'Texas Essential Knowledge and Skills: Mathematics',
      subject: 'Mathematics',
      jurisdiction: 'Texas',
      sourceUri: 'https://tea.texas.gov/academics/curriculum-standards/teks',
      standards: [
        [
          'TEKS.MATH.7.10.A',
          'Write one-variable, two-step equations and inequalities to represent constraints or conditions within problems.',
          '7',
        ],
        [
          'TEKS.MATH.7.11.A',
          'Model and solve one-variable, two-step equations and inequalities.',
          '7',
        ],
        [
          'TEKS.MATH.7.4.A',
          'Represent constant rates of change in mathematical and real-world problems given pictorial, tabular, verbal, numeric, graphical, and algebraic representations.',
          '7',
        ],
      ],
    },
  ];
  const standardIdByCode = new Map<string, string>();
  for (const set of sets) {
    let row = await prisma.standardSet.findFirst({
      where: { organizationId: null, code: set.code },
    });
    if (!row)
      row = await prisma.standardSet.create({
        data: {
          id: uuidv7(),
          organizationId: null,
          code: set.code,
          name: set.name,
          subject: set.subject,
          jurisdiction: set.jurisdiction,
          sourceUri: set.sourceUri,
        },
      });
    for (const [
      i,
      [code, description, gradeLevels],
    ] of set.standards.entries()) {
      const st = await prisma.standard.upsert({
        where: { setId_code: { setId: row.id, code } },
        update: {},
        create: {
          id: uuidv7(),
          setId: row.id,
          code,
          description,
          gradeLevels,
          sortOrder: i,
        },
      });
      standardIdByCode.set(code, st.id);
    }
  }
  const q1 = await prisma.gradingPeriod.findFirst({
    where: { name: 'Q1', term: { academicYear: { organizationId } } },
  });
  const classes = await prisma.class.findMany({
    where: { organizationId, deletedAt: null },
  });
  for (const klass of classes) {
    const categories: Array<[string, number, number]> = [
      ['Homework', 30, 1],
      ['Quizzes', 30, 0],
      ['Tests', 40, 0],
    ];
    const ids = new Map<string, string>();
    for (const [i, [name, weight, dropLowest]] of categories.entries()) {
      const c = await prisma.gradeCategory.upsert({
        where: { classId_name: { classId: klass.id, name } },
        update: {},
        create: {
          id: uuidv7(),
          classId: klass.id,
          name,
          weight,
          dropLowest,
          sortOrder: i,
        },
      });
      ids.set(name, c.id);
    }
    await prisma.class.update({
      where: { id: klass.id },
      data: {
        latePolicy:
          'Late work loses 10% per day for up to four days, then is accepted for feedback only.',
        syllabus:
          klass.syllabus ??
          `${klass.name}: weekly homework, a quiz every other Friday, and a test at the end of each unit.`,
      },
    });
    // Lessons of the class's course teach the same standard, so mastery per skill (slice 16) has evidence.
    const lessonStandard = standardIdByCode.get(
      klass.name.startsWith('Algebra')
        ? 'CCSS.MATH.CONTENT.7.EE.B.4'
        : 'CCSS.ELA-LITERACY.RL.7.3',
    );
    if (lessonStandard) {
      const lessons = await prisma.lesson.findMany({
        where: { module: { courseId: klass.courseId } },
        select: { id: true },
      });
      for (const l of lessons)
        await prisma.lessonStandard.upsert({
          where: {
            lessonId_standardId: { lessonId: l.id, standardId: lessonStandard },
          },
          update: {},
          create: { lessonId: l.id, standardId: lessonStandard },
        });
    }
    const assignments = await prisma.assignment.findMany({
      where: { classId: klass.id, deletedAt: null },
    });
    for (const a of assignments) {
      const standard = standardIdByCode.get(
        klass.name.startsWith('Algebra')
          ? 'CCSS.MATH.CONTENT.7.EE.B.4'
          : 'CCSS.ELA-LITERACY.RL.7.3',
      );
      await prisma.assignment.update({
        where: { id: a.id },
        data: {
          categoryId: a.categoryId ?? ids.get(a.category ?? 'Homework') ?? null,
          gradingPeriodId: a.gradingPeriodId ?? q1?.id ?? null,
        },
      });
      if (standard)
        await prisma.assignmentStandard.upsert({
          where: {
            assignmentId_standardId: {
              assignmentId: a.id,
              standardId: standard,
            },
          },
          update: {},
          create: { assignmentId: a.id, standardId: standard },
        });
    }
  }
  console.log(
    `grading: ${sets.length} shared standard sets, categories on ${classes.length} classes, one proficiency scale`,
  );
}

/** Support and safety demo data: an IEP for Emma, a counselor caseload, one positive behaviour note. */
async function seedSupport(organizationId: string): Promise<void> {
  const emma = await prisma.student.findFirst({
    where: { organizationId, studentNumber: 'S2026-000001' },
  });
  const counselor = await prisma.user.findUnique({
    where: { email: 'counselor@smartschool.local' },
  });
  const teacher = await prisma.user.findUnique({
    where: { email: 'teacher@smartschool.local' },
  });
  if (!emma || !counselor || !teacher) return;
  await prisma.accommodation.upsert({
    where: { studentId: emma.id },
    update: {},
    create: {
      id: uuidv7(),
      organizationId,
      studentId: emma.id,
      plan: 'IEP',
      extendedTimePercent: 50,
      readAloud: true,
      largeText: false,
      reducedMotion: false,
      reducedDistraction: false,
      notes:
        'Extended time on written work; read-aloud for passages longer than a paragraph.',
      startDate: new Date('2026-08-15T00:00:00Z'),
      updatedById: teacher.id,
    },
  });
  await prisma.counselorCaseload.upsert({
    where: {
      counselorId_studentId: { counselorId: counselor.id, studentId: emma.id },
    },
    update: {},
    create: {
      id: uuidv7(),
      counselorId: counselor.id,
      studentId: emma.id,
      reason: 'IEP review each quarter',
    },
  });
  const existing = await prisma.behaviorRecord.findFirst({
    where: { studentId: emma.id, title: 'Helped a new classmate settle in' },
  });
  if (!existing)
    await prisma.behaviorRecord.create({
      data: {
        id: uuidv7(),
        organizationId,
        studentId: emma.id,
        reportedById: teacher.id,
        kind: 'POSITIVE',
        title: 'Helped a new classmate settle in',
        description:
          'Showed a new student around and shared her notes without being asked.',
        occurredAt: new Date('2026-09-29T14:30:00Z'),
        location: 'Room 101',
      },
    });
  console.log(
    'support: accommodation, caseload and a behaviour note for the demo student',
  );
}

async function seedMotivation(organizationId: string): Promise<void> {
  for (const b of BADGES) {
    await prisma.badge.upsert({
      where: { code: b.code },
      update: {
        name: b.name,
        description: b.description,
        category: b.category,
        tier: b.tier,
        icon: b.icon,
        teacherAwarded: !!b.teacherAwarded,
      },
      create: {
        id: uuidv7(),
        code: b.code,
        name: b.name,
        description: b.description,
        category: b.category,
        tier: b.tier,
        icon: b.icon,
        teacherAwarded: !!b.teacherAwarded,
      },
    });
  }
  const klass = await prisma.class.findFirst({
    where: { organizationId, name: 'English 7 - Section A', deletedAt: null },
  });
  const teacher = await prisma.user.findUnique({
    where: { email: 'teacher@smartschool.local' },
  });
  if (klass && teacher) {
    const existing = await prisma.quest.findFirst({
      where: {
        classId: klass.id,
        title: 'Everyone turns in on time this week',
      },
    });
    if (!existing) {
      const now = new Date();
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      await prisma.quest.create({
        data: {
          id: uuidv7(),
          organizationId,
          classId: klass.id,
          title: 'Everyone turns in on time this week',
          description:
            'The whole class works together: every on-time submission counts toward the class goal.',
          metric: 'on_time',
          goal: 10,
          rewardXp: 30,
          startsAt: start,
          endsAt: end,
          createdById: teacher.id,
        },
      });
    }
  }
  console.log(
    `motivation: ${BADGES.length} badges in the catalogue and a class quest`,
  );
}

/** The demo student is weak on one ELA standard, so the learning path demo (slice 23) has a gap to build from. */
async function seedLearningGap(): Promise<void> {
  const emma = await prisma.student.findFirst({
    where: { studentNumber: 'S2026-000001' },
  });
  const standard = await prisma.standard.findFirst({
    where: { code: 'CCSS.ELA-LITERACY.RL.7.3' },
  });
  if (!emma || !standard) return;
  await prisma.masteryLevel.upsert({
    where: {
      studentId_standardId: { studentId: emma.id, standardId: standard.id },
    },
    update: {},
    create: {
      id: uuidv7(),
      studentId: emma.id,
      standardId: standard.id,
      level: 0.3,
      evidenceCount: 3,
      trend: 'down',
      lastEvidenceAt: new Date(),
    },
  });
}

/** Platform skills and code lessons (slice 24), the same for every school. */
async function seedCareers(): Promise<void> {
  for (const skill of PLATFORM_SKILLS) {
    const existing = await prisma.skill.findFirst({
      where: { organizationId: null, name: skill.name },
    });
    if (!existing)
      await prisma.skill.create({
        data: {
          id: uuidv7(),
          organizationId: null,
          name: skill.name,
          category: skill.category,
          description: skill.description,
        },
      });
  }
  let order = 0;
  for (const lesson of PLATFORM_CODE_LESSONS) {
    order += 1;
    const existing = await prisma.codeLesson.findFirst({
      where: { organizationId: null, title: lesson.title },
    });
    if (!existing)
      await prisma.codeLesson.create({
        data: {
          id: uuidv7(),
          organizationId: null,
          title: lesson.title,
          description: lesson.description,
          level: lesson.level,
          sortOrder: order,
          starter: lesson.starter,
          tests: JSON.stringify(lesson.tests),
        },
      });
  }
  console.log(
    `careers: ${PLATFORM_SKILLS.length} platform skills and ${PLATFORM_CODE_LESSONS.length} code lessons present`,
  );
}

async function main(): Promise<void> {
  await seedFeatures();
  await seedH5pLibraries();
  await seedFlags();
  const orgId = await seedOrganization();
  await seedUsers(orgId);
  await seedStudents(orgId);
  await seedCurriculum(orgId);
  await seedStructure(orgId);
  await seedAcademics(orgId);
  await seedGrading(orgId);
  await seedSupport(orgId);
  await seedMotivation(orgId);
  await seedLearningGap();
  await seedCareers();
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
