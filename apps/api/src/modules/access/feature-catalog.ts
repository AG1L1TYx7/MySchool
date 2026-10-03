import { Role } from '../../generated/prisma/client';

/**
 * The feature catalogue: every fine-grained permission in the product (docs/02 section 2).
 * Codes are stable identifiers used by @RequireFeature and the web client; never rename one.
 * Default role assignments follow the matrix in docs/02. Administrators change them at runtime
 * through /api/v1/roles/{role}/features and per-user overrides.
 */
export interface FeatureDefinition {
  code: string;
  name: string;
  category: string;
  description?: string;
  roles: readonly Role[];
}

const ALL: readonly Role[] = [
  'SUPER_ADMIN',
  'SUPERINTENDENT',
  'PRINCIPAL',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'ASSISTANT',
];
const ADMINS: readonly Role[] = ['SUPER_ADMIN', 'SUPERINTENDENT', 'PRINCIPAL'];
const DISTRICT: readonly Role[] = ['SUPER_ADMIN', 'SUPERINTENDENT'];
const STAFF: readonly Role[] = [
  'SUPER_ADMIN',
  'SUPERINTENDENT',
  'PRINCIPAL',
  'TEACHER',
];
const STAFF_AND_ASSISTANT: readonly Role[] = [...STAFF, 'ASSISTANT'];

function f(
  code: string,
  name: string,
  category: string,
  roles: readonly Role[],
  description?: string,
): FeatureDefinition {
  return { code, name, category, roles, description };
}

export const FEATURE_CATALOG: readonly FeatureDefinition[] = [
  // Dashboard
  f('dashboard.view', 'View dashboard', 'Dashboard', ALL),
  f('dashboard.customize', 'Customise dashboard', 'Dashboard', ALL),
  f('profile.view', 'View own profile', 'Dashboard', ALL),
  f('profile.edit', 'Edit own profile', 'Dashboard', ALL),

  // Users and administration
  f('users.view', 'View users', 'Users', ADMINS),
  f('users.create', 'Create users', 'Users', ADMINS),
  f('users.edit', 'Edit users', 'Users', ADMINS),
  f('users.deactivate', 'Deactivate users', 'Users', ADMINS),
  f('users.roles.assign', 'Assign roles', 'Users', DISTRICT),
  f('users.password.reset', 'Trigger password resets', 'Users', ADMINS),
  f('users.import', 'Import users', 'Users', ADMINS),
  f('users.export', 'Export users', 'Users', ADMINS),
  f('roles.manage', 'Manage role permissions', 'Administration', [
    'SUPER_ADMIN',
  ]),
  f('features.manage', 'Manage the feature catalogue', 'Administration', [
    'SUPER_ADMIN',
  ]),
  f('feature-flags.manage', 'Toggle feature flags', 'Administration', [
    'SUPER_ADMIN',
  ]),
  f('audit.logs.view', 'View audit logs', 'Administration', DISTRICT),
  f('settings.view', 'View settings', 'Administration', ADMINS),
  f('settings.edit', 'Edit settings', 'Administration', DISTRICT),
  f('system.health.view', 'View system health', 'Administration', DISTRICT),
  f('organizations.view', 'View organisations', 'Administration', ADMINS),
  f(
    'organizations.structure',
    'Configure school year, terms, periods and attendance codes',
    'Administration',
    ADMINS,
  ),
  f(
    'organizations.roster',
    'Configure rostering and sign-in',
    'Administration',
    ADMINS,
  ),
  f(
    'organizations.manage',
    'Create and edit organisations',
    'Administration',
    DISTRICT,
  ),

  // Students
  f('students.view', 'View students', 'Students', STAFF_AND_ASSISTANT),
  f('students.create', 'Create students', 'Students', ADMINS),
  f('students.edit', 'Edit students', 'Students', ADMINS),
  f('students.delete', 'Delete students', 'Students', DISTRICT),
  f('students.import', 'Import students', 'Students', ADMINS),
  f('students.export', 'Export students', 'Students', ADMINS),
  f('students.guardians.manage', 'Manage guardians', 'Students', ADMINS),
  f('students.progress.view', 'View student progress', 'Students', STAFF),

  // Courses and classes
  f('courses.view', 'View courses', 'Courses', ALL),
  f('courses.create', 'Create courses', 'Courses', STAFF),
  f('courses.edit', 'Edit courses', 'Courses', STAFF),
  f('courses.delete', 'Delete courses', 'Courses', ADMINS),
  f('courses.modules.manage', 'Manage modules and lessons', 'Courses', STAFF),
  f('classes.view', 'View classes', 'Classes', ALL),
  f('classes.create', 'Create classes', 'Classes', ADMINS),
  f('classes.edit', 'Edit classes', 'Classes', STAFF),
  f('classes.delete', 'Delete classes', 'Classes', ADMINS),
  f('classes.roster.manage', 'Manage rosters', 'Classes', STAFF),
  f('classes.teachers.manage', 'Assign teachers', 'Classes', ADMINS),

  // Assignments and grades
  f('assignments.view', 'View assignments', 'Assignments', ALL),
  f('assignments.create', 'Create assignments', 'Assignments', STAFF),
  f('assignments.edit', 'Edit assignments', 'Assignments', STAFF),
  f('assignments.delete', 'Delete assignments', 'Assignments', STAFF),
  f('assignments.submit', 'Submit assignments', 'Assignments', ['STUDENT']),
  f('assignments.grade', 'Grade submissions', 'Assignments', STAFF),
  f('rubrics.manage', 'Create and edit rubrics', 'Assignments', STAFF),
  f('grades.view.own', 'View own grades', 'Grades', ['STUDENT']),
  f('grades.view.child', "View a child's grades", 'Grades', ['PARENT']),
  f('grades.view.all', 'View all grades', 'Grades', STAFF),
  f('grades.edit', 'Edit grades', 'Grades', STAFF),
  f('grades.export', 'Export gradebook', 'Grades', STAFF),
  f(
    'standards.view',
    'Browse academic standards',
    'Grades',
    STAFF_AND_ASSISTANT,
  ),
  f('standards.manage', 'Create and import standard sets', 'Grades', STAFF),
  f('report-cards.view.own', 'View own report cards', 'Grades', ['STUDENT']),
  f('report-cards.view.child', "View a child's report cards", 'Grades', [
    'PARENT',
  ]),
  f(
    'report-cards.view.all',
    'View report cards',
    'Grades',
    STAFF_AND_ASSISTANT,
  ),
  f(
    'report-cards.manage',
    'Generate report cards and progress reports',
    'Grades',
    STAFF,
  ),
  f('report-cards.comment', 'Comment on report cards', 'Grades', STAFF),
  f('report-cards.publish', 'Publish report cards', 'Grades', ADMINS),

  // Attendance
  f('attendance.view.own', 'View own attendance', 'Attendance', ['STUDENT']),
  f('attendance.view.child', "View a child's attendance", 'Attendance', [
    'PARENT',
  ]),
  f('attendance.view', 'View attendance', 'Attendance', STAFF_AND_ASSISTANT),
  f('attendance.mark', 'Mark attendance', 'Attendance', STAFF_AND_ASSISTANT),
  f('attendance.edit', 'Edit attendance', 'Attendance', STAFF),
  f('attendance.report', 'Attendance reports', 'Attendance', STAFF),

  // Communication
  f('announcements.view', 'View announcements', 'Communication', ALL),
  f('announcements.create', 'Create announcements', 'Communication', STAFF),
  f('announcements.edit', 'Edit announcements', 'Communication', STAFF),
  f('messages.view', 'View messages', 'Communication', ALL),
  f('messages.send', 'Send messages', 'Communication', ALL),
  f('messages.delete', 'Delete messages', 'Communication', ALL),
  f('notifications.view', 'View notifications', 'Communication', ALL),
  f(
    'notifications.manage',
    'Manage notification preferences',
    'Communication',
    ALL,
  ),
  f('files.upload', 'Upload files', 'Files', ALL),
  f('files.manage', 'Manage all files', 'Files', ADMINS),

  // AI
  f('ai.tutor.chat', 'Chat with the AI tutor', 'AI', [
    'STUDENT',
    'TEACHER',
    'PRINCIPAL',
    'SUPERINTENDENT',
    'SUPER_ADMIN',
  ]),
  f('ai.tutor.homework', 'Homework help', 'AI', ['STUDENT', 'TEACHER']),
  f('ai.tutor.socratic', 'Socratic teaching mode', 'AI', [
    'STUDENT',
    'TEACHER',
  ]),
  f('ai.content.generate', 'Generate content with AI', 'AI', STAFF),
  f('ai.content.quiz', 'Generate quizzes', 'AI', STAFF),
  f('ai.content.flashcards', 'Generate flashcards', 'AI', STAFF),
  f('ai.content.lesson', 'Generate lesson plans', 'AI', STAFF),
  f('ai.grading.suggest', 'AI grading suggestions', 'AI', STAFF),
  f('ai.insights.teacher', 'Teacher insights', 'AI', STAFF),
  f('ai.insights.parent', 'Parent insights', 'AI', ['PARENT']),
  f('ai.usage.view', 'View AI usage', 'AI', ADMINS),

  // H5P
  f('h5p.view', 'Play interactive content', 'Interactive content', ALL),
  f('h5p.create', 'Create interactive content', 'Interactive content', STAFF),
  f('h5p.edit', 'Edit interactive content', 'Interactive content', STAFF),
  f(
    'h5p.results.view',
    'View interactive content results',
    'Interactive content',
    STAFF,
  ),

  // Analytics and reports (Release 2 routes, codes reserved now)
  f('analytics.view', 'View analytics', 'Analytics', STAFF),
  f('analytics.class', 'Class analytics', 'Analytics', STAFF),
  f('analytics.student', 'Student analytics', 'Analytics', STAFF),
  f('analytics.organization', 'Organisation analytics', 'Analytics', ADMINS),
  f('reports.view', 'View reports', 'Reports', STAFF),
  f('reports.create', 'Create reports', 'Reports', STAFF),
  f('reports.schedule', 'Schedule reports', 'Reports', ADMINS),

  // Engagement (Release 2)
  f('gamification.view', 'View points and badges', 'Engagement', ALL),
  f('gamification.award', 'Award points', 'Engagement', STAFF),
  f(
    'gamification.manage',
    'Manage achievements and badges',
    'Engagement',
    ADMINS,
  ),
  f('parent.dashboard.view', 'Parent dashboard', 'Parent portal', ['PARENT']),
  f('parent.access.manage', 'Manage parent access', 'Parent portal', ADMINS),
  f('sel.dashboard.view', 'SEL dashboard', 'Wellbeing', STAFF),
  f('sel.checkins.record', 'Record SEL check-ins', 'Wellbeing', [
    'STUDENT',
    'TEACHER',
  ]),
  f('wellness.alerts', 'Wellbeing alerts', 'Wellbeing', STAFF),
  f('calendar.view', 'View calendar', 'Calendar', ALL),
  f('calendar.manage', 'Manage calendar events', 'Calendar', STAFF),
];

export const FEATURE_CODES: readonly string[] = FEATURE_CATALOG.map(
  (d) => d.code,
);

/** Type-safe reference for @RequireFeature. */
export type FeatureCode = (typeof FEATURE_CATALOG)[number]['code'];
