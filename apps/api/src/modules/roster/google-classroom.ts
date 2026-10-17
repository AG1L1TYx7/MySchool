import { createSign } from 'node:crypto';
import { base64url, serviceAccountFrom } from '../push/push-rules';
import {
  emptySnapshot,
  normalizeEmail,
  type RosterSnapshot,
} from './roster-model';

/**
 * Google Classroom as a roster source and a gradebook target (slice 30). The school's Google Workspace
 * administrator creates a service account with domain-wide delegation for the Classroom scopes and names
 * an administrator to act as; SmartSchool signs a one-hour JWT with the account's key, exchanges it for an
 * access token, lists the courses with their teachers and students, and later writes grades back to
 * course work. No SDK: the REST calls are small and the token exchange is the same as push notifications.
 */

export interface GoogleClassroomConfig {
  /** The service account's JSON key as downloaded from Google Cloud. */
  serviceAccountJson: string;
  /** The Workspace administrator the service account acts as (domain-wide delegation). */
  adminEmail: string;
  /** Overridable for tests. */
  baseUrl?: string;
  tokenUrl?: string;
}

export const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.coursework.students',
].join(' ');

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
  ownerId?: string;
}

export interface ClassroomMember {
  userId: string;
  profile?: {
    id?: string;
    name?: { givenName?: string; familyName?: string; fullName?: string };
    emailAddress?: string;
  };
}

export interface ClassroomCourseWork {
  id: string;
  title: string;
  maxPoints?: number;
  state?: string;
  description?: string;
  workType?: string;
  dueDate?: { year?: number; month?: number; day?: number };
  dueTime?: { hours?: number; minutes?: number };
}

/** The due moment of a piece of course work in UTC, or null when Classroom gave none. */
export function courseWorkDueAt(cw: ClassroomCourseWork): Date | null {
  const d = cw.dueDate;
  if (!d || !d.year || !d.month || !d.day) return null;
  const t = cw.dueTime ?? {};
  return new Date(
    Date.UTC(d.year, d.month - 1, d.day, t.hours ?? 23, t.minutes ?? 59),
  );
}

/** Published assignments in Classroom that SmartSchool does not hold yet, as assignment inputs. */
export function importableCourseWork(
  items: ClassroomCourseWork[],
  linkedIds: ReadonlySet<string>,
): Array<{
  courseWorkId: string;
  title: string;
  maxPoints: number;
  description: string | null;
  dueAt: Date | null;
}> {
  const out: Array<{
    courseWorkId: string;
    title: string;
    maxPoints: number;
    description: string | null;
    dueAt: Date | null;
  }> = [];
  for (const cw of items) {
    if (!cw.id || linkedIds.has(cw.id)) continue;
    if ((cw.state ?? 'PUBLISHED') !== 'PUBLISHED') continue;
    if (
      cw.workType &&
      cw.workType !== 'ASSIGNMENT' &&
      cw.workType !== 'SHORT_ANSWER_QUESTION' &&
      cw.workType !== 'MULTIPLE_CHOICE_QUESTION'
    )
      continue;
    out.push({
      courseWorkId: cw.id,
      title: (cw.title || `Classroom work ${cw.id}`).slice(0, 200),
      maxPoints:
        typeof cw.maxPoints === 'number' && cw.maxPoints > 0
          ? cw.maxPoints
          : 100,
      description:
        typeof cw.description === 'string' && cw.description.trim()
          ? cw.description.slice(0, 20000)
          : null,
      dueAt: courseWorkDueAt(cw),
    });
  }
  return out;
}

export interface ClassroomSubmission {
  id: string;
  userId: string;
  state?: string;
  assignedGrade?: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Courses and their people as a roster snapshot: one school, no terms, a class per active course. */
export function classroomSnapshot(
  courses: ClassroomCourse[],
  rosters: Map<
    string,
    { teachers: ClassroomMember[]; students: ClassroomMember[] }
  >,
  school: { externalId: string; name: string },
): RosterSnapshot {
  const snap = emptySnapshot();
  snap.schools.push(school);
  const users = new Map<string, RosterSnapshot['users'][number]>();
  const member = (m: ClassroomMember, role: 'student' | 'teacher') => {
    const id = str(m.userId) || str(m.profile?.id);
    if (!id) return null;
    const existing = users.get(id);
    if (existing) {
      if (role === 'teacher' && existing.role === 'student')
        existing.role = 'teacher';
      return id;
    }
    const given = str(m.profile?.name?.givenName);
    const family = str(m.profile?.name?.familyName);
    const full = str(m.profile?.name?.fullName);
    users.set(id, {
      externalId: id,
      role,
      active: true,
      email: normalizeEmail(str(m.profile?.emailAddress)),
      username: null,
      identifier: null,
      firstName: given || full.split(' ')[0] || 'Classroom',
      lastName: family || full.split(' ').slice(1).join(' ') || 'User',
      grade: null,
      dateOfBirth: null,
      schoolExternalIds: [school.externalId],
      agentExternalIds: [],
    });
    return id;
  };
  for (const c of courses) {
    if (!c.id) continue;
    if (c.courseState && c.courseState !== 'ACTIVE') continue;
    snap.classes.push({
      externalId: c.id,
      title: c.name || `Course ${c.id}`,
      classCode: c.section || null,
      courseExternalId: null,
      schoolExternalId: school.externalId,
      termExternalIds: [],
      period: null,
      grade: null,
      active: true,
    });
    const roster = rosters.get(c.id) ?? { teachers: [], students: [] };
    let primary = true;
    for (const t of roster.teachers) {
      const id = member(t, 'teacher');
      if (!id) continue;
      snap.enrollments.push({
        externalId: `${c.id}:${id}`,
        classExternalId: c.id,
        userExternalId: id,
        role: 'teacher',
        primary,
        active: true,
      });
      primary = false;
    }
    for (const s of roster.students) {
      const id = member(s, 'student');
      if (!id) continue;
      snap.enrollments.push({
        externalId: `${c.id}:${id}`,
        classExternalId: c.id,
        userExternalId: id,
        role: 'student',
        primary: false,
        active: true,
      });
    }
  }
  snap.users.push(...users.values());
  return snap;
}

/** Which of a class's grades can be written to Classroom: the ones whose student is a known Google user. */
export function gradesToPush(
  grades: Array<{
    studentId: string;
    score: number;
    externalUserId: string | null;
  }>,
  submissions: ClassroomSubmission[],
): Array<{ studentId: string; submissionId: string; score: number }> {
  const byUser = new Map(submissions.map((s) => [s.userId, s.id]));
  const out: Array<{ studentId: string; submissionId: string; score: number }> =
    [];
  for (const g of grades) {
    if (!g.externalUserId) continue;
    const submissionId = byUser.get(g.externalUserId);
    if (!submissionId) continue;
    out.push({ studentId: g.studentId, submissionId, score: g.score });
  }
  return out;
}

export class GoogleClassroomClient {
  private readonly base: string;
  private readonly tokenUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: GoogleClassroomConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = (
      config.baseUrl ?? 'https://classroom.googleapis.com/v1'
    ).replace(/\/$/, '');
    this.tokenUrl = config.tokenUrl ?? 'https://oauth2.googleapis.com/token';
  }

  async snapshot(school: {
    externalId: string;
    name: string;
  }): Promise<RosterSnapshot> {
    const courses = await this.list<ClassroomCourse>(
      '/courses?courseStates=ACTIVE',
      'courses',
    );
    const rosters = new Map<
      string,
      { teachers: ClassroomMember[]; students: ClassroomMember[] }
    >();
    for (const c of courses) {
      rosters.set(c.id, {
        teachers: await this.list<ClassroomMember>(
          `/courses/${encodeURIComponent(c.id)}/teachers`,
          'teachers',
        ),
        students: await this.list<ClassroomMember>(
          `/courses/${encodeURIComponent(c.id)}/students`,
          'students',
        ),
      });
    }
    return classroomSnapshot(courses, rosters, school);
  }

  async courseWork(courseId: string): Promise<ClassroomCourseWork[]> {
    return this.list<ClassroomCourseWork>(
      `/courses/${encodeURIComponent(courseId)}/courseWork?courseWorkStates=PUBLISHED&courseWorkStates=DRAFT`,
      'courseWork',
    );
  }

  async createCourseWork(
    courseId: string,
    input: { title: string; maxPoints: number; description?: string },
  ): Promise<ClassroomCourseWork> {
    return this.call<ClassroomCourseWork>(
      `/courses/${encodeURIComponent(courseId)}/courseWork`,
      'POST',
      {
        title: input.title.slice(0, 3000),
        description: input.description?.slice(0, 30000),
        maxPoints: input.maxPoints,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
      },
    );
  }

  async submissions(
    courseId: string,
    courseWorkId: string,
  ): Promise<ClassroomSubmission[]> {
    return this.list<ClassroomSubmission>(
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions`,
      'studentSubmissions',
    );
  }

  async patchGrade(
    courseId: string,
    courseWorkId: string,
    submissionId: string,
    grade: number,
  ): Promise<void> {
    await this.call(
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions/${encodeURIComponent(submissionId)}?updateMask=assignedGrade,draftGrade`,
      'PATCH',
      { assignedGrade: grade, draftGrade: grade },
    );
  }

  // ---------------------------------------------------------------------------

  private async list<T>(path: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const token: string | null = pageToken;
      const body: Record<string, unknown> = await this.call<
        Record<string, unknown>
      >(
        `${path}${sep}pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
        'GET',
      );
      out.push(...((body[key] as T[] | undefined) ?? []));
      pageToken =
        typeof body.nextPageToken === 'string' && body.nextPageToken
          ? body.nextPageToken
          : null;
      if (!pageToken) break;
    }
    return out;
  }

  private async call<T>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: unknown,
  ): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok)
      throw new Error(
        `Classroom ${method} ${path.split('?')[0]} answered ${res.status}`,
      );
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** The service-account JWT (acting as the administrator) exchanged for a one-hour access token. */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt > now + 60) return this.token.value;
    const account = serviceAccountFrom(this.config.serviceAccountJson);
    if (!account) throw new Error('The service account JSON is not valid.');
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: account.clientEmail,
        sub: this.config.adminEmail,
        scope: CLASSROOM_SCOPES,
        aud: this.tokenUrl,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64url(signer.sign(account.privateKey))}`;
    const res = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google token ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.token = {
      value: body.access_token,
      expiresAt: now + (body.expires_in ?? 3600),
    };
    return body.access_token;
  }
}
