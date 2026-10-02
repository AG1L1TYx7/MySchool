import {
  emptySnapshot,
  isActiveStatus,
  normalizeEmail,
  normalizeGrade,
  roleFrom,
  type RosterSnapshot,
} from './roster-model';

/**
 * OneRoster 1.1 REST client (also what ClassLink's Roster Server speaks). OAuth 2 client credentials,
 * then paged GETs under /ims/oneroster/v1p1. Only the fields the snapshot needs are read.
 */
export interface OneRosterApiConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Restrict to one school's sourcedId when the tenant covers a district. */
  schoolExternalId?: string | null;
}

type Json = Record<string, unknown>;
const PAGE = 1000;

export class OneRosterApiClient {
  private token: string | null = null;

  constructor(
    private readonly config: OneRosterApiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope:
        'https://purl.imsglobal.org/spec/or/v1p1/scope/roster-core.readonly',
    });
    const res = await this.fetchImpl(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok)
      throw new Error(`OneRoster token endpoint answered ${res.status}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token)
      throw new Error('OneRoster token endpoint returned no access_token');
    this.token = data.access_token;
    return this.token;
  }

  private async page<T>(
    path: string,
    key: string,
    filter?: string,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const url = new URL(
        `${this.config.baseUrl.replace(/\/$/, '')}/ims/oneroster/v1p1/${path}`,
      );
      url.searchParams.set('limit', String(PAGE));
      url.searchParams.set('offset', String(offset));
      if (filter) url.searchParams.set('filter', filter);
      const res = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`OneRoster ${path} answered ${res.status}`);
      const data = (await res.json()) as Record<string, T[]>;
      const items = data[key] ?? [];
      out.push(...items);
      if (items.length < PAGE) break;
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
    const ref = (v: unknown): string | null =>
      v && typeof v === 'object' && 'sourcedId' in (v as Json)
        ? str((v as Json).sourcedId)
        : null;
    const refs = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(ref).filter((x): x is string => !!x) : [];
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(str).filter(Boolean) : [];

    for (const o of await this.page<Json>('orgs', 'orgs'))
      if (str(o.type).toLowerCase() === 'school')
        snap.schools.push({ externalId: str(o.sourcedId), name: str(o.name) });
    for (const s of await this.page<Json>(
      'academicSessions',
      'academicSessions',
    )) {
      const type = str(s.type).toLowerCase();
      snap.terms.push({
        externalId: str(s.sourcedId),
        title: str(s.title),
        type:
          type === 'schoolyear'
            ? 'schoolYear'
            : type === 'term'
              ? 'term'
              : type === 'semester'
                ? 'semester'
                : type === 'gradingperiod'
                  ? 'gradingPeriod'
                  : 'other',
        startDate: str(s.startDate) || null,
        endDate: str(s.endDate) || null,
        schoolYear: str(s.schoolYear) || null,
      });
    }
    for (const u of await this.page<Json>('users', 'users')) {
      const role = roleFrom(str(u.role));
      if (role === 'ignored') continue;
      const ids = Array.isArray(u.userIds) ? (u.userIds as Json[]) : [];
      snap.users.push({
        externalId: str(u.sourcedId),
        role,
        active:
          isActiveStatus(str(u.status)) &&
          u.enabledUser !== false &&
          str(u.enabledUser).toLowerCase() !== 'false',
        email: normalizeEmail(str(u.email)),
        username: str(u.username) || null,
        identifier: str(u.identifier) || str(ids[0]?.identifier) || null,
        firstName: str(u.givenName),
        lastName: str(u.familyName),
        grade: normalizeGrade(list(u.grades)[0] ?? null),
        dateOfBirth: null,
        schoolExternalIds: refs(u.orgs),
        agentExternalIds: refs(u.agents),
      });
    }
    for (const c of await this.page<Json>('courses', 'courses'))
      snap.courses.push({
        externalId: str(c.sourcedId),
        title: str(c.title),
        courseCode: str(c.courseCode) || null,
        subject: list(c.subjects)[0] ?? null,
        grade: normalizeGrade(list(c.grades)[0] ?? null),
        schoolExternalId: ref(c.org),
      });
    for (const k of await this.page<Json>('classes', 'classes'))
      snap.classes.push({
        externalId: str(k.sourcedId),
        title: str(k.title),
        classCode: str(k.classCode) || null,
        courseExternalId: ref(k.course),
        schoolExternalId: ref(k.school),
        termExternalIds: refs(k.terms),
        period: list(k.periods)[0] ?? null,
        grade: normalizeGrade(list(k.grades)[0] ?? null),
        active: isActiveStatus(str(k.status)),
      });
    for (const e of await this.page<Json>('enrollments', 'enrollments')) {
      const role = roleFrom(str(e.role));
      snap.enrollments.push({
        externalId: str(e.sourcedId),
        classExternalId: ref(e.class) ?? '',
        userExternalId: ref(e.user) ?? '',
        role:
          role === 'student'
            ? 'student'
            : role === 'teacher'
              ? 'teacher'
              : 'ignored',
        primary: e.primary === true || str(e.primary).toLowerCase() === 'true',
        active: isActiveStatus(str(e.status)),
      });
    }
    if (this.config.schoolExternalId)
      restrictToSchool(snap, this.config.schoolExternalId);
    return snap;
  }
}

/** Keeps only the records that belong to one school (district-wide tenants). */
export function restrictToSchool(
  snap: RosterSnapshot,
  schoolExternalId: string,
): void {
  snap.classes = snap.classes.filter(
    (c) => !c.schoolExternalId || c.schoolExternalId === schoolExternalId,
  );
  const classIds = new Set(snap.classes.map((c) => c.externalId));
  snap.enrollments = snap.enrollments.filter((e) =>
    classIds.has(e.classExternalId),
  );
  const userIds = new Set(snap.enrollments.map((e) => e.userExternalId));
  snap.users = snap.users.filter(
    (u) =>
      u.schoolExternalIds.length === 0 ||
      u.schoolExternalIds.includes(schoolExternalId) ||
      userIds.has(u.externalId) ||
      u.role === 'parent',
  );
  snap.schools = snap.schools.filter((s) => s.externalId === schoolExternalId);
}
