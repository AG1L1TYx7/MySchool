import {
  emptySnapshot,
  normalizeEmail,
  normalizeGrade,
  type RosterSnapshot,
} from './roster-model';

/**
 * Clever Data API v3.0 client with a district token. Sections carry their students and teachers, so
 * enrollments are derived from sections; contacts carry the students they are linked to.
 */
export interface CleverConfig {
  districtToken: string;
  baseUrl?: string;
  schoolExternalId?: string | null;
}

type Json = Record<string, unknown>;

export class CleverClient {
  private readonly base: string;

  constructor(
    private readonly config: CleverConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = (config.baseUrl ?? 'https://api.clever.com/v3.0').replace(
      /\/$/,
      '',
    );
  }

  private async all(path: string): Promise<Json[]> {
    const out: Json[] = [];
    let url: string | null =
      `${this.base}${path}${path.includes('?') ? '&' : '?'}limit=1000`;
    while (url) {
      const res = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${this.config.districtToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Clever ${path} answered ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{ data: Json }>;
        links?: Array<{ rel: string; uri: string }>;
      };
      out.push(...(body.data ?? []).map((d) => d.data));
      const next = (body.links ?? []).find((l) => l.rel === 'next');
      url = next
        ? next.uri.startsWith('http')
          ? next.uri
          : `${this.base.replace(/\/v3\.0$/, '')}${next.uri}`
        : null;
    }
    return out;
  }

  async snapshot(): Promise<RosterSnapshot> {
    const snap = emptySnapshot();
    const str = (v: unknown): string =>
      typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : '';
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(str).filter(Boolean) : [];
    const school = this.config.schoolExternalId ?? null;

    for (const s of await this.all('/schools'))
      snap.schools.push({ externalId: str(s.id), name: str(s.name) });
    for (const t of await this.all('/terms'))
      snap.terms.push({
        externalId: str(t.id),
        title: str(t.name),
        type: 'term',
        startDate: str(t.start_date) || null,
        endDate: str(t.end_date) || null,
        schoolYear: null,
      });

    for (const u of await this.all('/users')) {
      const roles = (u.roles ?? {}) as Record<string, Json>;
      const name = (u.name ?? {}) as Json;
      const base = {
        externalId: str(u.id),
        active: true,
        email: normalizeEmail(str(u.email)),
        username: null,
        firstName: str(name.first),
        lastName: str(name.last),
        dateOfBirth: null,
      };
      if (roles.student) {
        const r = roles.student;
        const schools = list(r.schools).length
          ? list(r.schools)
          : [str(r.school)].filter(Boolean);
        if (!school || schools.includes(school))
          snap.users.push({
            ...base,
            role: 'student',
            identifier: str(r.student_number) || str(r.sis_id) || null,
            grade: normalizeGrade(str(r.grade) || null),
            dateOfBirth: str(r.dob) || null,
            schoolExternalIds: schools,
            agentExternalIds: [],
          });
      }
      if (roles.teacher) {
        const r = roles.teacher;
        const schools = list(r.schools).length
          ? list(r.schools)
          : [str(r.school)].filter(Boolean);
        if (!school || schools.includes(school))
          snap.users.push({
            ...base,
            role: 'teacher',
            identifier: str(r.teacher_number) || null,
            grade: null,
            schoolExternalIds: schools,
            agentExternalIds: [],
          });
      }
      if (roles.contact) {
        const r = roles.contact;
        snap.users.push({
          ...base,
          role: 'parent',
          identifier: null,
          grade: null,
          schoolExternalIds: [],
          agentExternalIds: list(r.students),
        });
      }
      if (roles.staff && !roles.teacher) {
        const r = roles.staff;
        snap.users.push({
          ...base,
          role: 'staff',
          identifier: null,
          grade: null,
          schoolExternalIds: list(r.schools),
          agentExternalIds: [],
        });
      }
    }

    const courses = new Map<string, { title: string }>();
    for (const c of await this.all('/courses'))
      courses.set(str(c.id), { title: str(c.name) || str(c.number) });
    for (const [id, c] of courses)
      snap.courses.push({
        externalId: id,
        title: c.title,
        courseCode: null,
        subject: null,
        grade: null,
        schoolExternalId: null,
      });

    for (const s of await this.all('/sections')) {
      if (school && str(s.school) !== school) continue;
      const id = str(s.id);
      snap.classes.push({
        externalId: id,
        title: str(s.name),
        classCode: str(s.section_number) || null,
        courseExternalId: str(s.course) || null,
        schoolExternalId: str(s.school) || null,
        termExternalIds: [str(s.term_id)].filter(Boolean),
        period: str(s.period) || null,
        grade: normalizeGrade(str(s.grade) || null),
        active: true,
      });
      const teachers = list(s.teachers).length
        ? list(s.teachers)
        : [str(s.teacher)].filter(Boolean);
      teachers.forEach((t, i) =>
        snap.enrollments.push({
          externalId: `${id}:teacher:${t}`,
          classExternalId: id,
          userExternalId: t,
          role: 'teacher',
          primary: i === 0,
          active: true,
        }),
      );
      for (const st of list(s.students))
        snap.enrollments.push({
          externalId: `${id}:student:${st}`,
          classExternalId: id,
          userExternalId: st,
          role: 'student',
          primary: false,
          active: true,
        });
    }
    return snap;
  }
}
