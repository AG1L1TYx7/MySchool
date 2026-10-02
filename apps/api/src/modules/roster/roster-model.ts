/**
 * The provider-neutral roster snapshot (docs/13 section 2). Every importer (OneRoster CSV, OneRoster API,
 * Clever, ClassLink) produces one of these; one sync routine applies it. Ids are the provider's own ids.
 */
export type RosterRole =
  'student' | 'teacher' | 'staff' | 'parent' | 'administrator' | 'ignored';

export interface RosterSchool {
  externalId: string;
  name: string;
}

export interface RosterTerm {
  externalId: string;
  title: string;
  type: 'schoolYear' | 'term' | 'semester' | 'gradingPeriod' | 'other';
  startDate: string | null;
  endDate: string | null;
  schoolYear: string | null;
}

export interface RosterUser {
  externalId: string;
  role: RosterRole;
  active: boolean;
  email: string | null;
  username: string | null;
  identifier: string | null;
  firstName: string;
  lastName: string;
  grade: string | null;
  dateOfBirth: string | null;
  schoolExternalIds: string[];
  /** For parents and guardians: the students they are responsible for. */
  agentExternalIds: string[];
}

export interface RosterCourse {
  externalId: string;
  title: string;
  courseCode: string | null;
  subject: string | null;
  grade: string | null;
  schoolExternalId: string | null;
}

export interface RosterClass {
  externalId: string;
  title: string;
  classCode: string | null;
  courseExternalId: string | null;
  schoolExternalId: string | null;
  termExternalIds: string[];
  period: string | null;
  grade: string | null;
  active: boolean;
}

export interface RosterEnrollment {
  externalId: string;
  classExternalId: string;
  userExternalId: string;
  role: 'student' | 'teacher' | 'ignored';
  primary: boolean;
  active: boolean;
}

export interface RosterSnapshot {
  schools: RosterSchool[];
  terms: RosterTerm[];
  users: RosterUser[];
  courses: RosterCourse[];
  classes: RosterClass[];
  enrollments: RosterEnrollment[];
}

export function emptySnapshot(): RosterSnapshot {
  return {
    schools: [],
    terms: [],
    users: [],
    courses: [],
    classes: [],
    enrollments: [],
  };
}

/** OneRoster and Clever role names to ours. Unknown roles are ignored rather than guessed. */
export function roleFrom(raw: string | null | undefined): RosterRole {
  const r = (raw ?? '').trim().toLowerCase();
  if (r === 'student') return 'student';
  if (r === 'teacher') return 'teacher';
  if (r === 'parent' || r === 'guardian' || r === 'relative' || r === 'contact')
    return 'parent';
  if (r === 'aide' || r === 'staff' || r === 'proctor') return 'staff';
  if (
    r === 'administrator' ||
    r === 'districtadministrator' ||
    r === 'district_admin' ||
    r === 'school_admin'
  )
    return 'administrator';
  return 'ignored';
}

export function normalizeEmail(
  email: string | null | undefined,
): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/** "07", "7", "Grade 7", "KG", "K" -> "7" / "K"; anything else is kept as given. */
export function normalizeGrade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const g = raw
    .trim()
    .toUpperCase()
    .replace(/^GRADE\s*/, '');
  if (g === 'KG' || g === 'K' || g === 'KINDERGARTEN' || g === '00') return 'K';
  if (g === 'PK' || g === 'PRE-K' || g === 'PREK') return 'PK';
  const n = Number(g);
  if (Number.isInteger(n) && n >= 1 && n <= 13) return String(n);
  return g.length <= 16 ? g : g.slice(0, 16);
}

/** OneRoster list fields are comma-separated inside one CSV cell. */
export function splitList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isActiveStatus(raw: string | null | undefined): boolean {
  const s = (raw ?? 'active').trim().toLowerCase();
  return s === '' || s === 'active';
}
