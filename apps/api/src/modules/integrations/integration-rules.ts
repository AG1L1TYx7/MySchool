import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Role } from '../../generated/prisma/client';

/**
 * Integrations (slice 21, docs/02 section 33, docs/04 section 5): pure rules for webhooks, API keys,
 * exports to other platforms and LTI 1.3. No I/O; the services do the reading and writing.
 */

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Event types a subscription may ask for; every domain event of the API is in this list (docs/04 section 6). */
export const WEBHOOK_EVENT_TYPES = [
  'student.enrolled',
  'student.updated',
  'enrollment.changed',
  'course.created',
  'assignment.created',
  'assignment.published',
  'assignment.submitted',
  'grade.posted',
  'attendance.marked',
  'report_card.published',
  'announcement.published',
  'message.sent',
  'lesson.completed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Minutes to wait before each retry: 1, 2, 4, 8, 16, then 16 again. */
export const RETRY_BACKOFF_MINUTES = [1, 2, 4, 8, 16] as const;

export const WEBHOOK_STATUSES = ['pending', 'delivered', 'failed'] as const;

export function parseEventFilter(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

/** An empty filter means every event; otherwise exact types or a prefix with a trailing dot ("assignment."). */
export function eventMatches(filter: string[], eventType: string): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) =>
    f.endsWith('.') ? eventType.startsWith(f) : f === eventType,
  );
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

/** The signature the receiver checks: sha256 HMAC of "<timestamp>.<body>" with the subscription secret. */
export function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface DeliveryOutcome {
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
}

/** After an attempt: delivered on a 2xx, retried with backoff until the limit, failed after that. */
export function nextDeliveryState(
  attempts: number,
  ok: boolean,
  retryLimit: number,
  now: Date,
): DeliveryOutcome {
  const made = attempts + 1;
  if (ok) return { status: 'delivered', attempts: made, nextAttemptAt: now };
  if (made > retryLimit)
    return { status: 'failed', attempts: made, nextAttemptAt: now };
  const minutes =
    RETRY_BACKOFF_MINUTES[Math.min(made - 1, RETRY_BACKOFF_MINUTES.length - 1)];
  return {
    status: 'pending',
    attempts: made,
    nextAttemptAt: new Date(now.getTime() + minutes * 60_000),
  };
}

export interface WebhookEnvelope {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  organizationId: string | null;
  occurredAt: string;
  data: Record<string, unknown>;
}

/** Only https endpoints, except plain http on localhost for development and tests. */
export function isAllowedWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return (
      u.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/** Features an API key may be scoped to: read and export only, plus webhook management for IT tooling. */
export const API_KEY_SCOPES = [
  'students.view',
  'students.export',
  'classes.view',
  'courses.view',
  'assignments.view',
  'grades.view.all',
  'grades.export',
  'attendance.view',
  'calendar.view',
  'standards.view',
  'reports.view',
  'audit.logs.view',
  'organizations.view',
  'district.view',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_PREFIX = 'ssk';

export interface GeneratedApiKey {
  /** The whole key, shown once: ssk_<prefix>_<secret>. */
  plain: string;
  prefix: string;
  hash: string;
}

export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const plain = `${API_KEY_PREFIX}_${prefix}_${secret}`;
  return { plain, prefix, hash: hashApiKey(plain) };
}

/** The lookup prefix inside a presented key, or null when the shape is wrong. */
export function parseApiKey(
  presented: string | undefined,
): { prefix: string; plain: string } | null {
  if (!presented) return null;
  const m = /^ssk_([0-9a-f]{12})_([A-Za-z0-9_-]{20,64})$/.exec(
    presented.trim(),
  );
  return m ? { prefix: m[1], plain: presented.trim() } : null;
}

export function apiKeyMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(presented));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseScopes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter(
          (x): x is string =>
            typeof x === 'string' &&
            (API_KEY_SCOPES as readonly string[]).includes(x),
        )
      : [];
  } catch {
    return [];
  }
}

export function scopesAllow(
  scopes: readonly string[],
  feature: string,
): boolean {
  return scopes.includes(feature);
}

/** Fixed-window rate limiting for a key: one counter per minute. */
export interface RateWindow {
  minute: number;
  count: number;
}
export function takeRateToken(
  window: RateWindow | undefined,
  limit: number,
  now: Date,
): { allowed: boolean; window: RateWindow } {
  const minute = Math.floor(now.getTime() / 60_000);
  const w =
    window && window.minute === minute ? { ...window } : { minute, count: 0 };
  if (w.count >= limit) return { allowed: false, window: w };
  w.count += 1;
  return { allowed: true, window: w };
}

// ---------------------------------------------------------------------------
// Exports to other platforms
// ---------------------------------------------------------------------------

export interface ExportStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  sisId: string | null;
}
export interface ExportAssignment {
  id: string;
  title: string;
  maxPoints: number;
  dueAt: Date | null;
  description: string | null;
  isExtraCredit: boolean;
}
export type ExportCell = {
  score: number | null;
  mark: 'missing' | 'excused' | 'incomplete' | null;
};
export interface ExportBook {
  className: string;
  section: string | null;
  students: ExportStudent[];
  assignments: ExportAssignment[];
  cell: (studentId: string, assignmentId: string) => ExportCell;
  overall: (studentId: string) => number | null;
}

const csvCell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const csvLines = (
  rows: Array<Array<string | number | null | undefined>>,
): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/**
 * Canvas gradebook import format: "Student, ID, SIS User ID, SIS Login ID, Section, <Assignment (id)>…",
 * a "Points Possible" row, then one row per student. Excused cells are "EX"; missing cells stay empty.
 */
export function canvasGradebookCsv(book: ExportBook): string {
  const header = [
    'Student',
    'ID',
    'SIS User ID',
    'SIS Login ID',
    'Section',
    ...book.assignments.map((a) => `${a.title} (${a.id})`),
  ];
  const points = [
    '    Points Possible',
    '',
    '',
    '',
    '',
    ...book.assignments.map((a) => a.maxPoints),
  ];
  const rows = book.students.map((s) => [
    `${s.lastName}, ${s.firstName}`,
    s.id,
    s.sisId ?? s.studentNumber,
    s.email ?? '',
    book.section ?? book.className,
    ...book.assignments.map((a) => {
      const c = book.cell(s.id, a.id);
      return c.mark === 'excused' ? 'EX' : (c.score ?? '');
    }),
  ]);
  return csvLines([header, points, ...rows]);
}

/** Google Classroom's grade sheet layout: one row per student with the overall grade first, then each assignment. */
export function googleClassroomCsv(book: ExportBook): string {
  const header = [
    'Last Name',
    'First Name',
    'Email',
    'Overall Grade',
    ...book.assignments.map((a) => `${a.title} (${a.maxPoints} points)`),
  ];
  const rows = book.students.map((s) => [
    s.lastName,
    s.firstName,
    s.email ?? '',
    book.overall(s.id) ?? '',
    ...book.assignments.map((a) => {
      const c = book.cell(s.id, a.id);
      return c.mark === 'excused'
        ? 'Excused'
        : c.mark === 'missing'
          ? 'Missing'
          : (c.score ?? '');
    }),
  ]);
  return csvLines([header, ...rows]);
}

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface CartridgeItem {
  id: string;
  title: string;
  html: string;
}

/** IMS Common Cartridge 1.3 manifest with one web-content resource per item, importable by Canvas, Schoology and Moodle. */
export function commonCartridgeManifest(
  courseTitle: string,
  items: CartridgeItem[],
): string {
  const org = items
    .map(
      (i) =>
        `      <item identifier="ITEM_${i.id}" identifierref="RES_${i.id}">\n        <title>${xml(i.title)}</title>\n      </item>`,
    )
    .join('\n');
  const res = items
    .map(
      (i) =>
        `    <resource identifier="RES_${i.id}" type="webcontent" href="resources/${i.id}.html">\n      <file href="resources/${i.id}.html"/>\n    </resource>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST_SMARTSCHOOL" xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1"
  xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p3/LOM/resource" xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p3/LOM/manifest"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p3/ccv1p3_imscp_v1p2_v1p0.xsd">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.3.0</schemaversion>
    <lomimscc:lom>
      <lomimscc:general>
        <lomimscc:title><lomimscc:string language="en-US">${xml(courseTitle)}</lomimscc:string></lomimscc:title>
      </lomimscc:general>
    </lomimscc:lom>
  </metadata>
  <organizations>
    <organization identifier="ORG_1" structure="rooted-hierarchy">
      <item identifier="ROOT">
${org}
      </item>
    </organization>
  </organizations>
  <resources>
${res}
  </resources>
</manifest>
`;
}

export function cartridgeItemHtml(
  a: ExportAssignment,
  classTitle: string,
): string {
  const due = a.dueAt
    ? `<p><strong>Due:</strong> ${xml(a.dueAt.toISOString().slice(0, 10))}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${xml(a.title)}</title></head>
<body>
<h1>${xml(a.title)}</h1>
<p><em>${xml(classTitle)}</em></p>
${due}
<p><strong>Points:</strong> ${a.maxPoints}${a.isExtraCredit ? ' (extra credit)' : ''}</p>
${a.description ? `<div>${a.description}</div>` : ''}
</body></html>
`;
}

// ---------------------------------------------------------------------------
// LTI 1.3
// ---------------------------------------------------------------------------

export const LTI_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
export const LTI_ROLE_PREFIX =
  'http://purl.imsglobal.org/vocab/lis/v2/membership#';
export const LTI_VERSION = '1.3.0';
export const LTI_RESOURCE_LINK = 'LtiResourceLinkRequest';

/** Our role for a launch: the first recognised LTI membership role wins; everything else is a student. */
export function roleFromLtiRoles(roles: readonly string[]): Role {
  const names = roles.map((r) => r.split('#').pop() ?? r);
  if (names.includes('Administrator')) return 'PRINCIPAL';
  if (
    names.includes('Instructor') ||
    names.includes('ContentDeveloper') ||
    names.includes('TeachingAssistant')
  )
    return 'TEACHER';
  if (names.includes('Mentor')) return 'PARENT';
  return 'STUDENT';
}

/** LTI roles SmartSchool sends when it launches a tool as a platform. */
export function ltiRolesFor(role: Role): string[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'SUPERINTENDENT':
    case 'PRINCIPAL':
      return [
        `${LTI_ROLE_PREFIX}Administrator`,
        `${LTI_ROLE_PREFIX}Instructor`,
      ];
    case 'TEACHER':
    case 'COUNSELOR':
      return [`${LTI_ROLE_PREFIX}Instructor`];
    case 'ASSISTANT':
      return [`${LTI_ROLE_PREFIX}TeachingAssistant`];
    case 'PARENT':
      return [`${LTI_ROLE_PREFIX}Mentor`];
    default:
      return [`${LTI_ROLE_PREFIX}Learner`];
  }
}

export interface LaunchClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nonce: string;
  [key: string]: unknown;
}

export interface LaunchCheck {
  ok: boolean;
  reason?: string;
  deploymentId?: string;
  targetLinkUri?: string;
  roles: string[];
  email: string | null;
  name: { given: string; family: string };
  context: { id: string | null; title: string | null };
}

/** The checks an LTI 1.3 tool must make on a launch id_token after the signature (IMS Security Framework 5.1.3). */
export function checkLaunchClaims(
  claims: LaunchClaims,
  expected: {
    issuer: string;
    clientId: string;
    nonce: string;
    deploymentId: string | null;
  },
  now: Date,
): LaunchCheck {
  const fail = (reason: string): LaunchCheck => ({
    ok: false,
    reason,
    roles: [],
    email: null,
    name: { given: '', family: '' },
    context: { id: null, title: null },
  });
  if (claims.iss !== expected.issuer) return fail('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) return fail('audience');
  if (aud.length > 1 && claims.azp !== expected.clientId)
    return fail('authorized_party');
  const sec = now.getTime() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < sec - 60)
    return fail('expired');
  if (typeof claims.iat !== 'number' || claims.iat > sec + 60)
    return fail('issued_in_future');
  if (claims.nonce !== expected.nonce) return fail('nonce');
  if (claims[`${LTI_CLAIM}message_type`] !== LTI_RESOURCE_LINK)
    return fail('message_type');
  if (claims[`${LTI_CLAIM}version`] !== LTI_VERSION) return fail('version');
  const deploymentId = claims[`${LTI_CLAIM}deployment_id`];
  if (typeof deploymentId !== 'string' || !deploymentId)
    return fail('deployment_id');
  if (expected.deploymentId && deploymentId !== expected.deploymentId)
    return fail('deployment_mismatch');
  if (typeof claims.sub !== 'string' || !claims.sub) return fail('subject');
  const roles = Array.isArray(claims[`${LTI_CLAIM}roles`])
    ? (claims[`${LTI_CLAIM}roles`] as unknown[]).filter(
        (r): r is string => typeof r === 'string',
      )
    : [];
  const context = (claims[`${LTI_CLAIM}context`] ?? {}) as {
    id?: unknown;
    title?: unknown;
  };
  return {
    ok: true,
    deploymentId,
    targetLinkUri:
      typeof claims[`${LTI_CLAIM}target_link_uri`] === 'string'
        ? (claims[`${LTI_CLAIM}target_link_uri`] as string)
        : undefined,
    roles,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    name: {
      given:
        typeof claims.given_name === 'string'
          ? claims.given_name
          : typeof claims.name === 'string'
            ? claims.name.split(' ')[0]
            : '',
      family:
        typeof claims.family_name === 'string'
          ? claims.family_name
          : typeof claims.name === 'string'
            ? claims.name.split(' ').slice(1).join(' ')
            : '',
    },
    context: {
      id: typeof context.id === 'string' ? context.id : null,
      title: typeof context.title === 'string' ? context.title : null,
    },
  };
}

/** Where a launch lands in the web app: the target link's path when it is ours, else the dashboard. */
export function launchPathFor(
  targetLinkUri: string | undefined,
  apiPublicUrl: string,
  custom: Record<string, unknown> | undefined,
): string {
  const fromCustom =
    custom && typeof custom.path === 'string' && custom.path.startsWith('/')
      ? custom.path
      : null;
  if (fromCustom) return fromCustom;
  if (!targetLinkUri) return '/dashboard';
  try {
    const u = new URL(targetLinkUri);
    const api = new URL(apiPublicUrl);
    if (u.origin !== api.origin) return '/dashboard';
    const path = u.searchParams.get('path');
    return path && path.startsWith('/') && !path.startsWith('//')
      ? path
      : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

/** The id_token a platform sends a tool on a resource-link launch (LTI 1.3 core 5.3). */
export function platformLaunchClaims(input: {
  issuer: string;
  clientId: string;
  deploymentId: string;
  nonce: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
  };
  targetLinkUri: string;
  resourceLinkId: string;
  context: { id: string; title: string; label?: string } | null;
  custom: Record<string, string>;
  now: Date;
  ttlSeconds?: number;
}): Record<string, unknown> {
  const iat = Math.floor(input.now.getTime() / 1000);
  return {
    iss: input.issuer,
    sub: input.user.id,
    aud: input.clientId,
    iat,
    exp: iat + (input.ttlSeconds ?? 300),
    nonce: input.nonce,
    email: input.user.email,
    given_name: input.user.firstName,
    family_name: input.user.lastName,
    name: `${input.user.firstName} ${input.user.lastName}`.trim(),
    [`${LTI_CLAIM}message_type`]: LTI_RESOURCE_LINK,
    [`${LTI_CLAIM}version`]: LTI_VERSION,
    [`${LTI_CLAIM}deployment_id`]: input.deploymentId,
    [`${LTI_CLAIM}target_link_uri`]: input.targetLinkUri,
    [`${LTI_CLAIM}resource_link`]: { id: input.resourceLinkId },
    [`${LTI_CLAIM}roles`]: ltiRolesFor(input.user.role),
    ...(input.context
      ? {
          [`${LTI_CLAIM}context`]: {
            id: input.context.id,
            title: input.context.title,
            label: input.context.label ?? input.context.title,
            type: [
              'http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection',
            ],
          },
        }
      : {}),
    [`${LTI_CLAIM}tool_platform`]: {
      name: 'SmartSchool',
      product_family_code: 'smartschool',
    },
    [`${LTI_CLAIM}launch_presentation`]: { document_target: 'iframe' },
    [`${LTI_CLAIM}custom`]: input.custom,
  };
}

/** Canvas-style tool configuration JSON for registering SmartSchool as a tool (developer key, LTI 1.3). */
export function toolConfiguration(
  apiPublicUrl: string,
  webAppUrl: string,
  orgName: string,
): Record<string, unknown> {
  const base = apiPublicUrl.replace(/\/$/, '');
  return {
    title: `SmartSchool (${orgName})`,
    description:
      'AI-native K-12 learning: assignments, practice, tutor and insight inside your LMS.',
    oidc_initiation_url: `${base}/api/v1/lti/login`,
    target_link_uri: `${base}/api/v1/lti/launch`,
    public_jwk_url: `${base}/api/v1/lti/jwks`,
    scopes: [],
    extensions: [
      {
        platform: 'canvas.instructure.com',
        privacy_level: 'public',
        settings: {
          text: 'SmartSchool',
          icon_url: `${webAppUrl.replace(/\/$/, '')}/icon.svg`,
          placements: [
            {
              placement: 'course_navigation',
              message_type: 'LtiResourceLinkRequest',
              target_link_uri: `${base}/api/v1/lti/launch?path=%2Fdashboard`,
              text: 'SmartSchool',
            },
            {
              placement: 'assignment_selection',
              message_type: 'LtiResourceLinkRequest',
              target_link_uri: `${base}/api/v1/lti/launch?path=%2Fassignments`,
              text: 'SmartSchool assignment',
            },
          ],
        },
      },
    ],
    custom_fields: { path: '$Canvas.externalTool.url' },
  };
}

/** Form that posts itself: how both LTI redirects (login initiation and the id_token) travel through the browser. */
export function autoPostForm(
  action: string,
  fields: Record<string, string>,
): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${xml(k)}" value="${xml(v)}">`)
    .join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Opening…</title></head>
<body onload="document.forms[0].submit()">
<form method="post" action="${xml(action)}">
${inputs}
<noscript><button type="submit">Continue</button></noscript>
</form>
</body></html>`;
}

export const base64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64url');
