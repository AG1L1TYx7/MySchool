export interface Student {
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
  enrollmentStatus: string;
  enrollmentDate: string | null;
  preferredLearningStyle: string | null;
  accessibilityNeeds: string | null;
  goals: string | null;
  notes: string | null;
  address: string | null;
  gpa: number | null;
  attendanceRate: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Guardian {
  id: string;
  studentId: string;
  relationship: string;
  isPrimary: boolean;
  receivesNotifications: boolean;
  canViewGrades: boolean;
  canViewAttendance: boolean;
  guardian: { id: string; email: string; firstName: string; lastName: string; role: string; phone: string | null; status: string };
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  guardiansLinked: number;
  invitationsSent: number;
  errors: Array<{ line: number; message: string }>;
}

export const ENROLLMENT_STATUSES = ['active', 'inactive', 'graduated', 'transferred', 'withdrawn', 'suspended'] as const;
export const LEARNING_STYLES = ['visual', 'auditory', 'kinesthetic', 'reading_writing', 'mixed'] as const;
export const RELATIONSHIPS = ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'other'] as const;
export const GRADE_LEVELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

export const label = (v: string) => v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
