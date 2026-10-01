import type { ClassEnrollmentStatus } from '../../generated/prisma/client';

export type EnrollmentDecision = 'enrolled' | 'waitlisted' | 'skipped';

/**
 * Pure enrolment rule: a student already enrolled or waitlisted is skipped, a dropped or
 * completed one may rejoin, and the class capacity decides between enrolled and waitlisted.
 */
export function decideEnrollment(input: {
  existingStatus: ClassEnrollmentStatus | null;
  enrolledCount: number;
  maxStudents: number | null;
}): EnrollmentDecision {
  if (
    input.existingStatus === 'ENROLLED' ||
    input.existingStatus === 'WAITLISTED'
  )
    return 'skipped';
  if (input.maxStudents !== null && input.enrolledCount >= input.maxStudents)
    return 'waitlisted';
  return 'enrolled';
}

/** When a seat frees up, the earliest waitlisted student takes it (first come, first served). */
export function seatsAvailable(
  enrolledCount: number,
  maxStudents: number | null,
): number {
  return maxStudents === null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, maxStudents - enrolledCount);
}
