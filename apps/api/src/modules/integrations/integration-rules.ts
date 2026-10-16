import { escapeCell } from '../../common/utils/csv';
import { sanitizeParameters } from '../h5p/h5p-rules';
import { checkOutboundUrl } from '../../common/outbound-url';
import { safeRedirect } from '../sso/sso-rules';
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
  'practice.reviewed',
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

/**
 * Only public https endpoints, except plain http on localhost for development and tests; the service
 * applies the same check without the localhost exception in production and resolves the name before
 * every delivery (docs/21 F08).
 */
export function isAllowedWebhookUrl(url: string): boolean {
  return checkOutboundUrl(url, { allowLoopback: true }).ok;
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

// The shared writer also neutralises cells that would run as spreadsheet formulas (docs/21 F21).
const csvCell = escapeCell;
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
${a.description ? `<div>${sanitizeParameters(a.description)}</div>` : ''}
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
export const LTI_DEEP_LINK_REQUEST = 'LtiDeepLinkingRequest';
export const LTI_DEEP_LINK_RESPONSE = 'LtiDeepLinkingResponse';
export const LTI_AGS_CLAIM =
  'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
export const LTI_NRPS_CLAIM =
  'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice';
export const LTI_DL_CLAIM = 'https://purl.imsglobal.org/spec/lti-dl/claim/';
/** The service scopes SmartSchool asks a platform for (IMS AGS 2.0 and NRPS 2.0). */
export const LTI_SCOPE = {
  lineItem: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
  lineItemRead:
    'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
  result: 'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
  score: 'https://purl.imsglobal.org/spec/lti-ags/scope/score',
  memberships:
    'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
} as const;
/** How long a deep-linking picker stays open after the launch. */
export const DEEP_LINK_TTL_MS = 10 * 60_000;

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

/** The service endpoints a launch offers (slice 30). */
export interface LaunchServices {
  membershipsUrl: string | null;
  lineItemsUrl: string | null;
  lineItemUrl: string | null;
  scopes: string[];
}

/** What a deep-linking request asks for (IMS Deep Linking 2.0). */
export interface DeepLinkingSettings {
  returnUrl: string;
  data: string | null;
  acceptTypes: string[];
  acceptMultiple: boolean;
}

export interface LaunchCheck {
  ok: boolean;
  reason?: string;
  messageType: string;
  deploymentId?: string;
  targetLinkUri?: string;
  resourceLinkId: string | null;
  roles: string[];
  email: string | null;
  name: { given: string; family: string };
  context: { id: string | null; title: string | null };
  services: LaunchServices;
  deepLinking: DeepLinkingSettings | null;
}

const NO_SERVICES: LaunchServices = {
  membershipsUrl: null,
  lineItemsUrl: null,
  lineItemUrl: null,
  scopes: [],
};

function urlClaim(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? v : null;
  } catch {
    return null;
  }
}

/** The memberships and line-item URLs a platform offers in a launch, each only when it is a URL. */
export function launchServices(
  claims: Record<string, unknown>,
): LaunchServices {
  const nrps = (claims[LTI_NRPS_CLAIM] ?? {}) as Record<string, unknown>;
  const ags = (claims[LTI_AGS_CLAIM] ?? {}) as Record<string, unknown>;
  const scopes = Array.isArray(ags.scope)
    ? (ags.scope as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return {
    membershipsUrl: urlClaim(nrps.context_memberships_url),
    lineItemsUrl: urlClaim(ags.lineitems),
    lineItemUrl: urlClaim(ags.lineitem),
    scopes,
  };
}

/** The deep-linking settings claim, or null when it is missing or has no usable return URL. */
export function deepLinkingSettings(
  claims: Record<string, unknown>,
): DeepLinkingSettings | null {
  const dl = claims[`${LTI_DL_CLAIM}deep_linking_settings`] as
    Record<string, unknown> | undefined;
  if (!dl) return null;
  const returnUrl = urlClaim(dl.deep_link_return_url);
  if (!returnUrl) return null;
  return {
    returnUrl,
    data: typeof dl.data === 'string' ? dl.data : null,
    acceptTypes: Array.isArray(dl.accept_types)
      ? (dl.accept_types as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [],
    acceptMultiple: dl.accept_multiple !== false,
  };
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
    messageType: LTI_RESOURCE_LINK,
    resourceLinkId: null,
    roles: [],
    email: null,
    name: { given: '', family: '' },
    context: { id: null, title: null },
    services: NO_SERVICES,
    deepLinking: null,
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
  const messageType = claims[`${LTI_CLAIM}message_type`];
  if (
    messageType !== LTI_RESOURCE_LINK &&
    messageType !== LTI_DEEP_LINK_REQUEST
  )
    return fail('message_type');
  const deepLinking =
    messageType === LTI_DEEP_LINK_REQUEST ? deepLinkingSettings(claims) : null;
  if (messageType === LTI_DEEP_LINK_REQUEST && !deepLinking)
    return fail('deep_linking_settings');
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
  const resourceLink = (claims[`${LTI_CLAIM}resource_link`] ?? {}) as {
    id?: unknown;
  };
  return {
    ok: true,
    messageType,
    resourceLinkId:
      typeof resourceLink.id === 'string' ? resourceLink.id : null,
    services: launchServices(claims),
    deepLinking,
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
  // A platform's custom path and the path in the target link are both redirect targets: the same
  // in-app-only rule as SSO applies (docs/21 F20).
  const fromCustom =
    custom && typeof custom.path === 'string'
      ? safeRedirect(custom.path)
      : '/dashboard';
  if (fromCustom !== '/dashboard') return fromCustom;
  if (!targetLinkUri) return '/dashboard';
  try {
    const u = new URL(targetLinkUri);
    const api = new URL(apiPublicUrl);
    if (u.origin !== api.origin) return '/dashboard';
    return safeRedirect(u.searchParams.get('path'));
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
  /** Service endpoints SmartSchool offers the tool for this class (slice 30). */
  services?: {
    membershipsUrl: string;
    lineItemsUrl: string;
    lineItemUrl?: string | null;
  };
  /** When set, the launch is a deep-linking request instead of a resource link. */
  deepLinking?: { returnUrl: string; data: string };
}): Record<string, unknown> {
  const iat = Math.floor(input.now.getTime() / 1000);
  return {
    ...(input.services
      ? {
          [LTI_NRPS_CLAIM]: {
            context_memberships_url: input.services.membershipsUrl,
            service_versions: ['2.0'],
          },
          [LTI_AGS_CLAIM]: {
            scope: [
              LTI_SCOPE.lineItem,
              LTI_SCOPE.lineItemRead,
              LTI_SCOPE.result,
              LTI_SCOPE.score,
            ],
            lineitems: input.services.lineItemsUrl,
            ...(input.services.lineItemUrl
              ? { lineitem: input.services.lineItemUrl }
              : {}),
          },
        }
      : {}),
    ...(input.deepLinking
      ? {
          [`${LTI_DL_CLAIM}deep_linking_settings`]: {
            deep_link_return_url: input.deepLinking.returnUrl,
            accept_types: ['ltiResourceLink'],
            accept_presentation_document_targets: ['iframe', 'window'],
            accept_multiple: true,
            auto_create: true,
            data: input.deepLinking.data,
          },
        }
      : {}),
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
    [`${LTI_CLAIM}message_type`]: input.deepLinking
      ? LTI_DEEP_LINK_REQUEST
      : LTI_RESOURCE_LINK,
    [`${LTI_CLAIM}version`]: LTI_VERSION,
    [`${LTI_CLAIM}deployment_id`]: input.deploymentId,
    [`${LTI_CLAIM}target_link_uri`]: input.targetLinkUri,
    ...(input.deepLinking
      ? {}
      : { [`${LTI_CLAIM}resource_link`]: { id: input.resourceLinkId } }),
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
    scopes: [
      LTI_SCOPE.lineItem,
      LTI_SCOPE.lineItemRead,
      LTI_SCOPE.result,
      LTI_SCOPE.score,
      LTI_SCOPE.memberships,
    ],
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
              message_type: 'LtiDeepLinkingRequest',
              target_link_uri: `${base}/api/v1/lti/launch`,
              text: 'SmartSchool assignment',
            },
            {
              placement: 'link_selection',
              message_type: 'LtiDeepLinkingRequest',
              target_link_uri: `${base}/api/v1/lti/launch`,
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
// ---------------------------------------------------------------------------
// LTI services (slice 30): client assertions, Names and Roles, scores, Deep Linking
// ---------------------------------------------------------------------------

/** The JWT a tool presents to a platform's token endpoint (client_credentials with private_key_jwt). */
export function clientAssertionClaims(
  clientId: string,
  tokenUrl: string,
  now: Date,
  jti: string,
): Record<string, unknown> {
  const sec = Math.floor(now.getTime() / 1000);
  return {
    iss: clientId,
    sub: clientId,
    aud: tokenUrl,
    iat: sec,
    exp: sec + 300,
    jti,
  };
}

/** One member of a Names and Roles container (the fields SmartSchool reads). */
export interface NrpsMember {
  user_id: string;
  roles?: string[];
  status?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
}

export interface RosterMember {
  subject: string;
  roles: string[];
  email: string | null;
  name: { given: string; family: string };
  isTeacher: boolean;
  /** Learners and instructors are enrolled; mentors, administrators and inactive members are left alone. */
  enrollable: boolean;
}

/** Members as the class sync wants them: active learners and instructors, with their names split. */
export function membersToRoster(members: NrpsMember[]): RosterMember[] {
  const out: RosterMember[] = [];
  for (const m of members) {
    if (!m || typeof m.user_id !== 'string' || !m.user_id) continue;
    const roles = Array.isArray(m.roles)
      ? m.roles.filter((r): r is string => typeof r === 'string')
      : [];
    const role = roleFromLtiRoles(roles);
    const active = (m.status ?? 'Active').toLowerCase() !== 'inactive';
    const given =
      typeof m.given_name === 'string'
        ? m.given_name
        : typeof m.name === 'string'
          ? m.name.split(' ')[0]
          : '';
    const family =
      typeof m.family_name === 'string'
        ? m.family_name
        : typeof m.name === 'string'
          ? m.name.split(' ').slice(1).join(' ')
          : '';
    out.push({
      subject: m.user_id,
      roles,
      email: typeof m.email === 'string' ? m.email.toLowerCase() : null,
      name: { given, family },
      isTeacher: role === 'TEACHER',
      enrollable: active && (role === 'TEACHER' || role === 'STUDENT'),
    });
  }
  return out;
}

/** The next page of a paginated service answer, from its Link header. */
export function nextPageFrom(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (m) return m[1];
  }
  return null;
}

/** Where scores are posted: the line item URL with "/scores" before any query string (AGS 2.0 section 3.3). */
export function scoreUrl(lineItemUrl: string): string {
  const q = lineItemUrl.indexOf('?');
  const base = q >= 0 ? lineItemUrl.slice(0, q) : lineItemUrl;
  const query = q >= 0 ? lineItemUrl.slice(q) : '';
  return `${base.replace(/\/$/, '')}/scores${query}`;
}

/** A fully graded score for one learner. */
export function scorePayload(
  subject: string,
  score: number,
  max: number,
  now: Date,
): Record<string, unknown> {
  return {
    userId: subject,
    scoreGiven: score,
    scoreMaximum: max,
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    timestamp: now.toISOString(),
  };
}

/** A SmartSchool assignment as a deep-linking content item: a resource link with its own line item. */
export function deepLinkContentItem(a: {
  id: string;
  title: string;
  maxPoints: number;
  launchUrl: string;
  path: string;
}): Record<string, unknown> {
  return {
    type: 'ltiResourceLink',
    title: a.title,
    url: a.launchUrl,
    custom: { smartschool_path: a.path, smartschool_assignment_id: a.id },
    lineItem: { scoreMaximum: a.maxPoints, label: a.title, resourceId: a.id },
  };
}

/** The claims of a deep-linking response JWT (IMS Deep Linking 2.0 section 3.5). */
export function deepLinkingResponseClaims(input: {
  clientId: string;
  issuer: string;
  deploymentId: string;
  data: string | null;
  items: Array<Record<string, unknown>>;
  now: Date;
}): Record<string, unknown> {
  const sec = Math.floor(input.now.getTime() / 1000);
  return {
    iss: input.clientId,
    aud: input.issuer,
    iat: sec,
    exp: sec + 300,
    nonce: `${sec}-${Math.random().toString(36).slice(2, 10)}`,
    [`${LTI_CLAIM}message_type`]: LTI_DEEP_LINK_RESPONSE,
    [`${LTI_CLAIM}version`]: LTI_VERSION,
    [`${LTI_CLAIM}deployment_id`]: input.deploymentId,
    [`${LTI_DL_CLAIM}content_items`]: input.items,
    ...(input.data ? { [`${LTI_DL_CLAIM}data`]: input.data } : {}),
  };
}

// ---------------------------------------------------------------------------
// LTI services with SmartSchool as the platform (slice 30)
// ---------------------------------------------------------------------------

/** What a tool sends to create or update a line item (AGS 2.0 section 3.2). */
export interface LineItemInput {
  label: string;
  scoreMaximum: number;
  resourceId?: string;
  resourceLinkId?: string;
  tag?: string;
}

/** A score a tool posts (AGS 2.0 section 3.3); userId is the SmartSchool user id the launch carried. */
export interface ScoreInput {
  userId: string;
  scoreGiven?: number;
  scoreMaximum?: number;
  activityProgress?: string;
  gradingProgress?: string;
  comment?: string;
  timestamp?: string;
}

export interface ServiceTokenPayload {
  tool: string;
  scopes: string[];
  exp: number;
}

/** The access token SmartSchool issues to a tool: an HMAC-signed payload naming the tool, its scopes and the expiry. */
export function signServiceToken(
  secret: string,
  payload: ServiceTokenPayload,
): string {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret)
    .update(`lti-service:${body}`)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyServiceToken(
  secret: string,
  token: string,
  nowMs: number,
): ServiceTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret)
    .update(`lti-service:${body}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as ServiceTokenPayload;
    if (
      typeof payload.tool !== 'string' ||
      !Array.isArray(payload.scopes) ||
      typeof payload.exp !== 'number' ||
      payload.exp < nowMs
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

/** A percentage with two decimals, never above 100 for extra credit beyond the maximum. */
export function scoreToPercentage(given: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.round((given / max) * 10000) / 100;
}

/** A line item as AGS describes it; `id` is its own URL. */
export function lineItemView(
  base: string,
  item: {
    id: string;
    label: string;
    scoreMaximum: unknown;
    resourceId: string | null;
    resourceLinkId: string | null;
    tag: string | null;
  },
): Record<string, unknown> {
  return {
    id: `${base}/${item.id}`,
    label: item.label,
    scoreMaximum: Number(item.scoreMaximum),
    ...(item.resourceId ? { resourceId: item.resourceId } : {}),
    ...(item.resourceLinkId ? { resourceLinkId: item.resourceLinkId } : {}),
    ...(item.tag ? { tag: item.tag } : {}),
  };
}

export function resultView(
  lineItemUrl: string,
  score: {
    id: string;
    userId: string;
    scoreGiven: unknown;
    scoreMaximum: unknown;
    comment: string | null;
    timestamp: Date;
  },
): Record<string, unknown> {
  return {
    id: `${lineItemUrl}/results/${score.id}`,
    scoreOf: lineItemUrl,
    userId: score.userId,
    ...(score.scoreGiven === null || score.scoreGiven === undefined
      ? {}
      : { resultScore: Number(score.scoreGiven) }),
    resultMaximum: Number(score.scoreMaximum),
    ...(score.comment ? { comment: score.comment } : {}),
    timestamp: score.timestamp.toISOString(),
  };
}

/** A Names and Roles membership container for a class (NRPS 2.0 section 4). */
export function membershipsView(
  id: string,
  context: { id: string; title: string; label: string },
  members: Array<{
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  }>,
): Record<string, unknown> {
  return {
    id,
    context,
    members: members.map((m) => ({
      status: 'Active',
      user_id: m.userId,
      roles: m.roles,
      email: m.email,
      given_name: m.firstName,
      family_name: m.lastName,
      name: `${m.firstName} ${m.lastName}`.trim(),
    })),
  };
}

export interface DeepLinkItem {
  title: string;
  url: string;
  custom: Record<string, string> | null;
  lineItem: {
    scoreMaximum: number;
    label?: string;
    resourceId?: string;
    tag?: string;
  } | null;
}

export interface DeepLinkResponseCheck {
  ok: boolean;
  reason?: string;
  data: string | null;
  items: DeepLinkItem[];
}

/** The checks on a tool's deep-linking response after its signature (Deep Linking 2.0 section 3.5). */
export function checkDeepLinkingResponse(
  claims: Record<string, unknown>,
  expected: {
    clientId: string;
    issuer: string;
    deploymentId: string;
    now: Date;
  },
): DeepLinkResponseCheck {
  const fail = (reason: string): DeepLinkResponseCheck => ({
    ok: false,
    reason,
    data: null,
    items: [],
  });
  if (claims.iss !== expected.clientId) return fail('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.issuer)) return fail('audience');
  const sec = expected.now.getTime() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < sec - 60)
    return fail('expired');
  if (claims[`${LTI_CLAIM}message_type`] !== LTI_DEEP_LINK_RESPONSE)
    return fail('message_type');
  if (claims[`${LTI_CLAIM}version`] !== LTI_VERSION) return fail('version');
  if (claims[`${LTI_CLAIM}deployment_id`] !== expected.deploymentId)
    return fail('deployment');
  const raw = claims[`${LTI_DL_CLAIM}content_items`];
  if (!Array.isArray(raw)) return fail('content_items');
  const items: DeepLinkItem[] = [];
  for (const entry of raw.slice(0, 50)) {
    const it = (entry ?? {}) as Record<string, unknown>;
    if (it.type !== 'ltiResourceLink') continue;
    const url = urlClaim(it.url);
    if (!url) continue;
    const title =
      typeof it.title === 'string' && it.title.trim()
        ? it.title.trim()
        : 'Tool content';
    const custom =
      it.custom && typeof it.custom === 'object'
        ? Object.fromEntries(
            Object.entries(it.custom as Record<string, unknown>)
              .filter(
                ([k, v]) =>
                  /^[A-Za-z0-9_]{1,64}$/.test(k) && typeof v === 'string',
              )
              .map(([k, v]) => [k, (v as string).slice(0, 500)]),
          )
        : null;
    const li = (it.lineItem ?? null) as Record<string, unknown> | null;
    const lineItem =
      li && typeof li.scoreMaximum === 'number' && li.scoreMaximum > 0
        ? {
            scoreMaximum: li.scoreMaximum,
            ...(typeof li.label === 'string' ? { label: li.label } : {}),
            ...(typeof li.resourceId === 'string'
              ? { resourceId: li.resourceId }
              : {}),
            ...(typeof li.tag === 'string' ? { tag: li.tag } : {}),
          }
        : null;
    items.push({ title, url, custom, lineItem });
  }
  return {
    ok: true,
    data:
      typeof claims[`${LTI_DL_CLAIM}data`] === 'string'
        ? (claims[`${LTI_DL_CLAIM}data`] as string)
        : null,
    items,
  };
}

/** The launch pages are self-submitting forms: only their own inline handler may run, and only a form post may leave. */
export const LAUNCH_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; form-action *; base-uri 'none'; frame-ancestors 'none'";

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
