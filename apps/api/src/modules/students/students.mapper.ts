import type {
  EnrollmentStatus,
  GuardianRelationship,
  LearningStyle,
  Prisma,
  Student,
  StudentGuardian,
  User,
} from '@prisma/client';
import { ROLE_API_NAME } from '../access/roles';
import {
  ENROLLMENT_STATUSES,
  LEARNING_STYLES,
  RELATIONSHIPS,
  type EnrollmentStatusApi,
  type LearningStyleApi,
  type RelationshipApi,
} from './dto/students.dto';

export interface PublicStudent {
  id: string;
  organizationId: string;
  userId: string | null;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  gradeLevel: string | null;
  enrollmentStatus: EnrollmentStatusApi;
  enrollmentDate: string | null;
  preferredLearningStyle: LearningStyleApi | null;
  accessibilityNeeds: string | null;
  goals: string | null;
  notes: string | null;
  address: string | null;
  gpa: number | null;
  attendanceRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicGuardian {
  id: string;
  studentId: string;
  relationship: RelationshipApi;
  isPrimary: boolean;
  receivesNotifications: boolean;
  canViewGrades: boolean;
  canViewAttendance: boolean;
  createdAt: Date;
  guardian: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    phone: string | null;
    status: string;
  };
}

export function toPublicStudent(s: Student): PublicStudent {
  return {
    id: s.id,
    organizationId: s.organizationId,
    userId: s.userId,
    studentNumber: s.studentNumber,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    phone: s.phone,
    dateOfBirth: dateOnly(s.dateOfBirth),
    gender: s.gender,
    gradeLevel: s.gradeLevel,
    enrollmentStatus: s.enrollmentStatus.toLowerCase() as EnrollmentStatusApi,
    enrollmentDate: dateOnly(s.enrollmentDate),
    preferredLearningStyle: s.preferredLearningStyle
      ? (s.preferredLearningStyle.toLowerCase() as LearningStyleApi)
      : null,
    accessibilityNeeds: s.accessibilityNeeds,
    goals: s.goals,
    notes: s.notes,
    address: s.address,
    gpa: s.gpa === null ? null : Number(s.gpa),
    attendanceRate: s.attendanceRate === null ? null : Number(s.attendanceRate),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toPublicGuardian(
  g: StudentGuardian & { guardian: User },
): PublicGuardian {
  return {
    id: g.id,
    studentId: g.studentId,
    relationship: g.relationship.toLowerCase() as RelationshipApi,
    isPrimary: g.isPrimary,
    receivesNotifications: g.receivesNotifications,
    canViewGrades: g.canViewGrades,
    canViewAttendance: g.canViewAttendance,
    createdAt: g.createdAt,
    guardian: {
      id: g.guardian.id,
      email: g.guardian.email,
      firstName: g.guardian.firstName,
      lastName: g.guardian.lastName,
      role: ROLE_API_NAME[g.guardian.role],
      phone: g.guardian.phone,
      status: g.guardian.status.toLowerCase(),
    },
  };
}

export function dateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Parses YYYY-MM-DD (or any ISO date) into a UTC date at midnight; undefined when blank, null when invalid. */
export function parseDate(
  value: string | undefined | null,
): Date | null | undefined {
  if (value === undefined || value === null || value.trim() === '')
    return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1
      ? null
      : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? null
    : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function enrollmentStatusToDb(
  v: EnrollmentStatusApi | undefined,
): EnrollmentStatus | undefined {
  return v ? (v.toUpperCase() as EnrollmentStatus) : undefined;
}
export function learningStyleToDb(
  v: LearningStyleApi | undefined,
): LearningStyle | undefined {
  return v ? (v.toUpperCase() as LearningStyle) : undefined;
}
export function relationshipToDb(
  v: RelationshipApi | undefined,
): GuardianRelationship | undefined {
  return v ? (v.toUpperCase() as GuardianRelationship) : undefined;
}
export function isEnrollmentStatus(v: string): v is EnrollmentStatusApi {
  return (ENROLLMENT_STATUSES as readonly string[]).includes(v);
}
export function isLearningStyle(v: string): v is LearningStyleApi {
  return (LEARNING_STYLES as readonly string[]).includes(v);
}
export function isRelationship(v: string): v is RelationshipApi {
  return (RELATIONSHIPS as readonly string[]).includes(v);
}

/** Prisma Decimal columns accept numbers, strings or Decimal instances. */
export type DecimalInput = Prisma.Decimal | number | string | null | undefined;
