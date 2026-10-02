import { PrismaService } from '../../infra/prisma/prisma.service';

/** Who a class concerns: its teachers, the users behind enrolled students, and their guardians. */
export async function classAudience(
  prisma: PrismaService,
  classId: string,
): Promise<{ teachers: string[]; students: string[]; guardians: string[] }> {
  const klass = await prisma.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: {
      teachers: { select: { teacherId: true } },
      enrollments: {
        where: { status: { in: ['ENROLLED', 'COMPLETED'] } },
        select: {
          student: {
            select: {
              userId: true,
              guardians: { select: { guardianUserId: true } },
            },
          },
        },
      },
    },
  });
  if (!klass) return { teachers: [], students: [], guardians: [] };
  const students = klass.enrollments
    .map((e) => e.student.userId)
    .filter((id): id is string => !!id);
  const guardians = klass.enrollments.flatMap((e) =>
    e.student.guardians.map((g) => g.guardianUserId),
  );
  return {
    teachers: klass.teachers.map((t) => t.teacherId),
    students: [...new Set(students)],
    guardians: [...new Set(guardians)],
  };
}

/** Every active user of an organisation. */
export async function organizationAudience(
  prisma: PrismaService,
  organizationId: string,
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** The user behind a student and the users of their guardians. */
export async function studentAudience(
  prisma: PrismaService,
  studentId: string,
): Promise<{ student: string | null; guardians: string[] }> {
  const s = await prisma.student.findFirst({
    where: { id: studentId },
    select: { userId: true, guardians: { select: { guardianUserId: true } } },
  });
  return {
    student: s?.userId ?? null,
    guardians: s?.guardians.map((g) => g.guardianUserId) ?? [],
  };
}
