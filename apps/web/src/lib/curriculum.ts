export interface Course {
  id: string;
  organizationId: string;
  courseCode: string;
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  creditHours: number | null;
  estimatedHours: number | null;
  status: string;
  isPublished: boolean;
  publishedAt: string | null;
  instructorId: string | null;
  instructor: { id: string; firstName: string; lastName: string } | null;
  moduleCount: number;
  lessonCount: number;
  classCount: number;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  description: string | null;
  lessonType: string;
  content: string | null;
  contentUrl: string | null;
  sortOrder: number;
  durationMinutes: number | null;
  isPublished: boolean;
}

export interface CourseModule {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  isPublished: boolean;
  estimatedMinutes: number | null;
  lessons: Lesson[];
}

export interface CourseDetail extends Course {
  modules: CourseModule[];
  prerequisites: Array<{ id: string; courseCode: string; title: string }>;
}

export interface ClassItem {
  id: string;
  organizationId: string;
  courseId: string;
  course: { id: string; courseCode: string; title: string; subject: string | null; gradeLevel: string | null };
  name: string;
  section: string | null;
  term: string;
  academicYearId: string | null;
  termId: string | null;
  periodId: string | null;
  period: { id: string; name: string; startTime: string; endTime: string; days: string } | null;
  gradeLevel: string | null;
  startDate: string | null;
  endDate: string | null;
  room: string | null;
  meetingSchedule: string | null;
  maxStudents: number | null;
  status: string;
  teachers: Array<{ id: string; firstName: string; lastName: string; email: string; isPrimary: boolean }>;
  enrolledCount: number;
  waitlistedCount: number;
  canManage: boolean;
  myEnrollmentStatus?: string | null;
}

export interface Enrollment {
  id: string;
  classId: string;
  studentId: string;
  student: { id: string; studentNumber: string; firstName: string; lastName: string; gradeLevel: string | null; email: string | null };
  status: string;
  enrolledAt: string;
  droppedAt: string | null;
  currentGrade: number | null;
}

export const COURSE_STATUSES = ['draft', 'active', 'archived', 'under_review'] as const;
export const LESSON_TYPES = ['text', 'video', 'document', 'link', 'interactive'] as const;
export const CLASS_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export const ENROLLMENT_STATUSES = ['enrolled', 'waitlisted', 'dropped', 'completed'] as const;
