# SmartSchool API Design

**Version:** 1.0, 30 September 2026
**Scope:** conventions for the LMS API (`apps/api`) and the Release 1 resource map. Supersedes route preservation (ADR-010) per ADR-017. The endpoint inventory of the previous implementation remains the checklist of *capabilities*, not of paths.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1`. The version is in the path; breaking changes create `/api/v2` and the old version stays for at least one release. |
| Resource names | Plural, lowercase, kebab-case: `/students`, `/class-enrollments`, `/spaced-repetition-cards`. Sub-resources express ownership: `/classes/{classId}/enrollments`. |
| Identifiers | UUID v7 strings (time-ordered, index-friendly). Human-readable codes (`studentNumber`, `courseCode`) are separate fields. |
| Verbs | `GET` list and read, `POST` create and actions, `PUT` full replace (rare), `PATCH` partial update, `DELETE` soft delete. Actions that are not CRUD are `POST /resource/{id}/verb`: `/assignments/{id}/publish`, `/classes/{id}/archive`. |
| JSON | camelCase keys; ISO-8601 UTC timestamps with `Z`; booleans not 0/1; enums as stable lowercase strings in the API (`"status": "active"`) mapped to the integer columns in the database. |
| Reads | `GET /students/{id}` returns the resource. Lists return `{ data: [...], meta: { page, pageSize, totalItems, totalPages } }` or, for feeds, `{ data, meta: { nextCursor } }`. |
| Filtering and sorting | `?search=`, `?status=active`, `?classId=`, `?sort=-createdAt,lastName`, `?fields=id,firstName` (sparse fields on large resources). |
| Pagination | `?page=1&pageSize=20` (max 200) for tables; `?cursor=` for feeds and message history. |
| Errors | RFC 9457 `application/problem+json`: `{ type, title, status, detail, instance, code, errors?, traceId }`. `code` is a stable machine string (`auth.invalid_credentials`, `validation.failed`, `feature.disabled`). `errors` lists field problems for validation. `traceId` matches the log line. |
| Success envelopes | None. A created resource returns `201` with the resource and a `Location` header. Deletes return `204`. Actions return `200` with the updated resource or `202` with a job reference. |
| Authentication | `Authorization: Bearer <access token>` (JWT, 15 minutes; 30 days with remember-me). Refresh with `POST /auth/refresh` using the rotating opaque refresh token. Service callbacks use `Authorization: Bearer <service token>`. |
| Authorisation | Three layers: role level, feature code, ownership. `403` with `code: authz.forbidden` and the missing feature code in `detail` when applicable. |
| Idempotency | `Idempotency-Key` header honoured on `POST` for payments, bulk imports and webhook replays; replays return the original response. |
| Rate limits | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; `429` with `Retry-After`. |
| Concurrency | `ETag` on single resources; `If-Match` on `PATCH` for grades and settings to prevent lost updates. |
| Bulk | `POST /attendance/bulk`, `POST /students/import` accept arrays or CSV and return per-row results, never all-or-nothing unless `?atomic=true`. |
| Long operations | Return `202` with `{ jobId }`; poll `GET /jobs/{jobId}`; AI generation and report building use this. |
| Versioning of AI outputs | Every AI-produced resource carries `ai: { model, promptVersion, generatedAt, reviewedBy? }`. |
| OpenAPI | Generated from decorators; published at `/swagger` and `/openapi.json`; every route has a summary, tags and examples. |
| Deprecation | `Deprecation` and `Sunset` headers on retired routes for one release. |

---

## 2. Cross-cutting endpoints

| Route | Purpose |
|---|---|
| `GET /health`, `/health/live`, `/health/ready` | Liveness and readiness (outside `/api`) |
| `GET /metrics` | Prometheus |
| `GET /api/v1/health` | Detailed dependency health |
| `GET /api/v1/jobs/{jobId}` | Status of an asynchronous operation |
| `GET /openapi.json`, `/swagger` | API description |

---

## 3. Release 1 resource map

### Auth and identity

Security model (docs/11 section 3): the access token is a 15-minute JWT the browser keeps in memory; the refresh token is an `HttpOnly`, `SameSite=Strict`, `Secure` cookie (`ss_refresh`, path `/api/v1/auth`) rotated on every use with family revocation on reuse and an absolute lifetime (30 days, 90 with remember-me). Native clients send `X-SmartSchool-Client: native` and receive the refresh token in the body instead. Browsers must send `X-Requested-With: SmartSchool` when refreshing with the cookie.

```
POST   /auth/register                 email, password, firstName, lastName, role? (student|parent), joinCode?, captchaToken?
                                      -> 202 { message, verificationRequired, devToken? (development only) }
                                      never issues tokens; identical response whether or not the email exists;
                                      password checked against policy, common-password list and the user's name/email
POST   /auth/verify-email             token -> 204
POST   /auth/resend-verification      email, captchaToken? -> 202 (always)
POST   /auth/login                    email, password, rememberMe -> accessToken, expiresAt, refreshExpiresAt, user, mfaSetupRequired
                                      + Set-Cookie ss_refresh; or { mfaRequired: true, mfaToken } when 2FA is on;
                                      403 auth.email_unverified when verification is required; 5 failures lock for 15 min
POST   /auth/2fa/challenge            mfaToken, code (authenticator or backup; TOTP codes cannot be replayed) -> same as login
POST   /auth/refresh                  cookie (+ X-Requested-With) or { refreshToken } for native -> new access token, rotated cookie
POST   /auth/logout                   revokes the session and clears the cookie
GET    /auth/me                       current user with roles, mfaSetupRequired and effective feature codes
PATCH  /auth/me                       first name, last name, phone, preferences
POST   /auth/change-password          current + new password (same checks as registration); other sessions signed out
POST   /auth/forgot-password          email, captchaToken? -> always 202
POST   /auth/reset-password           token (reset or invitation code), newPassword; all sessions signed out; marks the email verified
POST   /auth/2fa/setup                -> secret, otpauth URL, QR
POST   /auth/2fa/verify               enables 2FA, returns backup codes once
POST   /auth/2fa/disable              password + code; refused (403 auth.mfa_required_for_role) for roles that must use 2FA
POST   /auth/2fa/backup-codes         regenerate
GET    /auth/sessions                 active refresh sessions (device, last seen, absolute expiry)
DELETE /auth/sessions/{id}
```

While a user in `AUTH_MFA_REQUIRED_ROLES` has no second factor, every route outside `/auth/*` answers 403 `auth.mfa_setup_required`.
### Single sign-on (Release 2 slice 9, docs/13 section 2)

```
GET    /auth/sso/providers                  providers configured on this server: [{ id, label }]
GET    /auth/sso/{provider}/start?redirect= 302 to the provider; signed state in a short-lived cookie; PKCE
GET    /auth/sso/{provider}/callback        302 into the web app with the refresh cookie set, or /login?error=sso_<code>; two-factor still applies
```

Providers: google, microsoft, clever, classlink. A person signs in when their provider identity is already linked, or their rostered email belongs to an organisation that enabled the provider for that email domain. Nobody is created by sign-in; rostering or invitations create accounts.

### Rostering (Release 2 slice 9)

```
GET    /organizations/{id}/roster/sources              connected sources with their last run
POST   /organizations/{id}/roster/sources              { provider: oneroster_api|classlink|clever, name, config } (secrets encrypted, never returned)
PATCH  /organizations/{id}/roster/sources/{sourceId}   name, config (blank secret keeps the stored one), isEnabled
DELETE /organizations/{id}/roster/sources/{sourceId}
POST   /organizations/{id}/roster/sources/{sourceId}/run   { dryRun? } -> 202 run; poll it
POST   /organizations/{id}/roster/import?dryRun=        multipart "files": a OneRoster 1.1 zip or CSVs -> 202 run
GET    /organizations/{id}/roster/runs
GET    /organizations/{id}/roster/runs/{runId}          status, counts per entity, up to 200 errors
GET    /organizations/{id}/roster/sso                   { providers, allowedDomains, passwordOptional, schoolExternalId }
PUT    /organizations/{id}/roster/sso
```

Synced records carry `externalId`, `source` and `managedBySis`; edits to managed fields answer `409 record.managed`. Enabled API sources sync nightly at 02:30 server time. Feature: `organizations.roster` (principal and district roles).

### School structure and calendar (Release 2 slice 10)
```
GET    /organizations/{id}/structure                    gradeLevels, attendanceDeadlineTime, timezone, years[terms[gradingPeriods]], bellSchedules[periods], attendanceCodes; classes.view
PUT    /organizations/{id}/structure/settings           gradeLevels[], attendanceDeadlineTime (HH:MM or empty), timezone; organizations.structure (all writes below too)
POST   /organizations/{id}/structure/years              name, startDate, endDate, isCurrent
PATCH  /organizations/{id}/structure/years/{yearId}     DELETE refuses 409 school.in_use while classes use its terms
POST   /organizations/{id}/structure/years/{yearId}/terms           name, type semester|trimester|quarter|term, startDate, endDate (inside the year), sortOrder
PATCH  /organizations/{id}/structure/terms/{termId}     DELETE 409 school.in_use while classes use it
POST   /organizations/{id}/structure/terms/{termId}/grading-periods  name, startDate, endDate (inside the term)
DELETE /organizations/{id}/structure/grading-periods/{gpId}
POST   /organizations/{id}/structure/bell-schedules     name, isDefault
DELETE /organizations/{id}/structure/bell-schedules/{scheduleId}
POST   /organizations/{id}/structure/bell-schedules/{scheduleId}/periods  name, startTime, endTime (HH:MM, start before end), days (letters MTWRFSU), sortOrder
PATCH  /organizations/{id}/structure/periods/{periodId} DELETE 409 school.in_use while classes meet in it
GET    /organizations/{id}/structure/attendance-codes   classes.view
POST   /organizations/{id}/structure/attendance-codes   code, label, category present|tardy|excused|unexcused|remote|other, countsAsPresent, isActive, sortOrder; 409 school.code_exists
PATCH  /organizations/{id}/structure/attendance-codes/{codeId}
GET    /calendar                      from, to (at most 400 days), classId; events, published due dates and term boundaries for my classes; calendar.view
POST   /calendar/events               title, type day_off|early_release|school_event|class_event, startsAt, endsAt, allDay, description, classId (class events: a class I teach; school-wide: administrators); calendar.manage
PATCH  /calendar/events/{id}          DELETE too; the creator or an administrator
GET    /calendar/subscription         rotate=true issues a new token -> { path: /api/v1/calendar/ical/{token}.ics }
GET    /calendar/ical/{token}.ics     public by token, text/calendar, 30 per minute
```
### Users, roles, permissions
```
GET    /users                         admin list with search, role, status filters
GET    /users/{id}
POST   /users                         create; without a password an invitation code is emailed (72 h)
PATCH  /users/{id}                    name, status (activate, deactivate), role, organisation (SuperAdmin)
POST   /users/{id}/reset-password     admin-triggered reset email
GET    /roles                         role names and levels
GET    /features                      the catalogue, grouped by category
GET    /roles/{role}/features
PUT    /roles/{role}/features         replace the role's feature set
GET    /users/{id}/feature-overrides
PUT    /users/{id}/feature-overrides/{code}   grant or revoke with reason and expiry
DELETE /users/{id}/feature-overrides/{code}
GET    /feature-flags                 global switches (unknown flag = off)
PATCH  /feature-flags/{name}          isEnabled
GET    /feature-flags
PATCH  /feature-flags/{name}
GET    /audit-logs                    filters: userId, action, entityType, from, to
```

### Organisations
```
GET    /organizations                 SuperAdmin and Superintendent
POST   /organizations
GET    /organizations/{id}
PATCH  /organizations/{id}
DELETE /organizations/{id}            soft delete
GET    /organizations/{id}/members    admins and app users with roles
POST   /organizations/{id}/members    link an existing user
GET    /organizations/{id}/join-code  current self-registration join code (organizations.manage)
POST   /organizations/{id}/join-code  rotate it; the old code stops working
```

### Students and guardians
```
GET    /students                      search, gradeLevel, status, organizationId (district roles); classId from slice 3
GET    /students/mine                 own record (students) or linked children (parents)
GET    /students/export               CSV, same columns as the import template
GET    /students/import/template      CSV template
POST   /students/import               { csv, dryRun?, organizationId? } or a text/csv body; upsert by studentNumber,
                                      links or invites guardians, per-line errors; 5,000 rows per file
POST   /students                      studentNumber generated when omitted; createAccount invites a student login
GET    /students/{id}
PATCH  /students/{id}
DELETE /students/{id}                 soft delete (status withdrawn)
GET    /students/{id}/guardians       staff, the student, or their guardians
POST   /students/{id}/guardians       guardianUserId or email (unknown email -> parent account + invitation),
                                      relationship, isPrimary, receivesNotifications, canViewGrades, canViewAttendance
PATCH  /students/{id}/guardians/{guardianId}
DELETE /students/{id}/guardians/{guardianId}
DELETE /students/{id}/guardians/{guardianId}
POST   /students/import               CSV, per-row results
GET    /students/export               CSV
```

### Curriculum
```
GET    /courses                       subject, gradeLevel, status, instructorId
POST   /courses
GET    /courses/{id}                  with modules and lessons
PATCH  /courses/{id}
DELETE /courses/{id}
POST   /courses/{id}/publish          needs at least one published lesson; status active
POST   /courses/{id}/unpublish
POST   /courses/{id}/clone            copies modules, lessons, prerequisites as a draft "<code>-COPY"
GET    /courses/{id}/modules
POST   /courses/{id}/modules
PUT    /courses/{id}/modules/order    ids[] (every current module exactly once)
PATCH  /modules/{id}
DELETE /modules/{id}
POST   /modules/{id}/lessons
PUT    /modules/{id}/lessons/order
PATCH  /lessons/{id}
DELETE /lessons/{id}
PUT    /courses/{id}/prerequisites    array of course ids
```

### Classes and enrolment
```
GET    /classes                       term, courseId, teacherId, status, search; students and parents see only their own
GET    /classes/mine                  classes I teach or attend (parents: my children attend)
POST   /classes                       courseId, name, termId (or a term label), academicYearId, periodId, gradeLevel, dates, room, maxStudents, teacherId (primary)
GET    /classes/{id}
PATCH  /classes/{id}
DELETE /classes/{id}
POST   /classes/{id}/teachers         teacherId, isPrimary
DELETE /classes/{id}/teachers/{teacherId}
GET    /classes/{id}/enrollments
POST   /classes/{id}/enrollments      studentIds[] -> { enrolled, waitlisted, skipped, notFound }; beyond maxStudents = waitlisted
PATCH  /classes/{id}/enrollments/{studentId}   status
DELETE /classes/{id}/enrollments/{studentId}
GET    /students/{id}/classes
```

### Support and safety (Release 2 slice 12)
```
GET    /students/{id}/accommodations        plan iep|section_504|other, extendedTimePercent, readAloud, largeText, reducedMotion, reducedDistraction, notes, dates; the student's own teachers, counselors, administrators and family
PUT    /students/{id}/accommodations        same fields; support.accommodations.manage (teachers of the student, counselors, administrators); DELETE removes the plan
GET    /me/accommodations                   the flags a student's screens apply; everyone else gets zeros
GET    /counselor/caseload                  counselors: their students with open alert counts; administrators pass counselorId; POST { studentId, reason }; DELETE /counselor/caseload/{studentId}
GET    /students/{id}/counselor-notes       counselors only; POST { body }; PATCH and DELETE /counselor-notes/{id} by the author
GET    /wellness/alerts                     status, organizationId; counselors and administrators (wellness.alerts)
PATCH  /wellness/alerts/{id}                status open|acknowledged|resolved, assignedToId (a counselor or principal), resolution
GET    /students/{id}/behavior              staff see everything; families see what the school rule or the record allows
POST   /students/{id}/behavior              kind positive|concern|incident, title, description, occurredAt, location, actionTaken, parentVisible; staff and counselors; PATCH and DELETE /behavior/{id} by the reporter or an administrator
GET    /students/{id}/ai-consent            under13, schoolDefault, status, decidedBy, allowed, reason
PUT    /students/{id}/ai-consent            status granted|declined, note; a guardian of the student or an administrator
GET    /organizations/{id}/support/settings behaviorVisibility ALL|POSITIVE_ONLY|NONE, aiConsentDefault SCHOOL|PARENT, studentMessaging; PUT under organizations.structure
```
Errors: `403 ai.consent_required` from the tutor and content routes when a student under 13 lacks consent. The tutor escalation path (`ai.safety.escalated` audit) now also raises a wellness alert; the student still sees only the caring refusal.

### Compliance (Release 3 slice 19)
```
GET    /organizations/{id}/compliance/data-map        compliance.view: entries (table, holds, subject, purpose, basis, retention, location, rows, retentionDays), retention, bounds
GET    /organizations/{id}/compliance/retention       PUT { aiConversations?, notifications?, auditLogs?, learningRecords?, pushLogs?, withdrawnStudents? } days, clamped to bounds (compliance.manage)
POST   /organizations/{id}/compliance/retention/run   apply now -> { removed: { aiConversations, notifications, ... } }
GET    /organizations/{id}/compliance/deletion-requests   { data, plan: { graceDays, removes[] } }
POST   /students/{id}/deletion-requests               { reason? } -> 201 pending; guardian, the student or an administrator; compliance.request_exists when one is open
GET    /students/{id}/deletion-requests               the student's own requests and the plan (family, administrators)
POST   /deletion-requests/{id}/decide                 { decision approve|reject, note? }; approve schedules the erasure 30 days out and tells the requester
POST   /deletion-requests/{id}/execute                erase now; compliance.not_approved, compliance.legal_hold
PUT    /students/{id}/legal-hold                      { legalHold } (compliance.manage, audited)
GET    /students/{id}/records-export.zip              FERPA copy: zip of JSON files per section plus manifest.json and README.txt; family, counselors, administrators; audited
GET    /compliance/incidents?organizationId=          administrators (district roles see every school); POST { title, severity, summary, detectedAt?, affectedCount?, dataCategories?, organizationId? } -> 201
PATCH  /compliance/incidents/{id}                     { status?, severity?, affectedCount?, dataCategories?, note? }; status moves forward only (compliance.incident_status)
POST   /compliance/incidents/{id}/notify              every administrator and district role, notification plus forced email; stamps notifiedAt
```
Nightly jobs: retention at 03:40, due erasures at 03:50. Everything here writes the audit log.

### District and tenants (Release 3 slice 20)

```
GET    /branding?tenant=                     public: { tenant: { id, slug, name, status } | null, displayName, primaryColor, logoUrl, supportEmail } for this host (TENANT_BASE_DOMAIN) or the named slug
GET    /tenants                              tenants.manage: paged { id, name, slug, status, customDomain, domainVerifiedAt, verification: { name, value } | null, branding, policies, schools, createdAt }
POST   /tenants                              { name, slug?, status?, branding? } -> 201 (tenants.manage); slug made from the name; www, api, admin refused
GET    /tenants/{id}                         district.view: own tenant for a superintendent, any for the platform administrator
PATCH  /tenants/{id}                         { name?, slug?, status?, customDomain? ("" removes), branding? } (district.manage; a superintendent may change only name and branding of their own tenant)
POST   /tenants/{id}/domain/verify           looks up the TXT record _smartschool.<domain> -> { verified, expected, found[] } (tenants.manage)
GET    /tenants/{id}/policies                district.view -> { tenantId, policies: { aiEnabled, aiDisabledSchools[], studentMessagingAllowed, disabledFeatures[], retention{} } }
PUT    /tenants/{id}/policies                partial update (district.manage); every aiDisabledSchools id must belong to the tenant
GET    /district/overview?tenantId=          district.view: { tenant, generatedAt, totals, schools[] } (tenantId only for the platform administrator)
GET    /district/reports/{kind}.csv          schools | enrollment_by_grade | attendance_daily | ai_usage (district.view, audited)
GET    /district/state-exports/{kind}.csv    enrollment | attendance | discipline | grades (?year=) (district.manage, audited district.state_export)
Errors: feature.disabled_by_district (403) from any route whose feature the district switched off; ai.disabled_by_district (403) from AI routes
```

### Integrations (Release 3 slice 21)

```
GET    /organizations/{id}/webhooks                     integrations.manage: subscriptions (never the secret)
GET    /organizations/{id}/webhooks/event-types         the thirteen event types a filter may name (a trailing dot is a prefix)
POST   /organizations/{id}/webhooks                     { name, url (https; http on localhost only), events?, retryLimit? } -> 201 with secret, once
PATCH  /organizations/{id}/webhooks/{wid}               { name?, url?, events?, isActive?, retryLimit? }
DELETE /organizations/{id}/webhooks/{wid}               204
POST   /organizations/{id}/webhooks/{wid}/rotate-secret -> new secret, once
POST   /organizations/{id}/webhooks/{wid}/test          posts webhook.test now -> { status, responseCode, lastError, attempts }
GET    /organizations/{id}/webhooks/{wid}/deliveries    paged { eventId, eventType, status pending|delivered|failed, attempts, responseCode, lastError, nextAttemptAt, deliveredAt }
GET    /organizations/{id}/api-keys                     keys with prefix, scopes, budget, creator, last use, expiry, revocation
GET    /organizations/{id}/api-keys/scopes              the allowed read-only scopes
POST   /organizations/{id}/api-keys                     { name, scopes[], rateLimitPerMinute?, expiresInDays? } -> 201 with key (ssk_<prefix>_<secret>), once
DELETE /organizations/{id}/api-keys/{kid}               revoke (row kept)
Header X-Api-Key: <key>   runs as the creating administrator, scoped; 401 auth.api_key_invalid | auth.api_key_revoked, 403 apikey.scope, 429 rate_limited
GET    /organizations/{id}/lti/platforms                POST { name, issuer, clientId, deploymentId?, authorizationUrl, jwksUrl, tokenUrl? }; PATCH/DELETE /{pid}
GET    /organizations/{id}/lti/tools                    POST { name, loginUrl, launchUrl, jwksUrl?, customParams? } -> tool with platform { issuer, authorizationUrl, jwksUrl, clientId, deploymentId }; PATCH/DELETE /{tid}
GET    /organizations/{id}/lti/tools/{tid}/launch?classId=   lti.launch: HTML page that posts the OIDC initiation to the tool
GET    /classes/{id}/lti-tools                          tools a person in the class may open
GET    /lti/jwks | /lti/config.json?organizationId=     public
GET|POST /lti/login                                     public OIDC initiation -> 302 to the platform; state cookie ss_lti
POST   /lti/launch                                      public; id_token + state -> 302 /sso/complete?next= (or /login?error=lti_<reason>)
GET|POST /lti/platform/auth                             public; answers a tool with an auto-posted id_token
GET    /classes/{id}/exports/canvas-gradebook.csv       grades.export (audited)
GET    /classes/{id}/exports/google-classroom.csv       grades.export (audited)
GET    /classes/{id}/exports/common-cartridge.imscc     assignments.view + class teacher or administrator (audited)
GET    /audit-logs/export.csv                           audit.logs.view: same filters as the list, 50,000 rows at most (audited audit.export)
```

### Library (Release 3 slice 22)

```
GET    /library/meta                                  kinds, visibilities, flag reasons
GET    /library/items                                 library.view: paged, filters q | kind | subject | gradeLevel | featured | collectionId; mine=true (+status) for your own in any state
GET    /library/items/search?q=&kind=&limit=          { query, semantic, data: items with score } (meaning through the AI service, merged with keyword matches)
POST   /library/items                                 library.create: { kind, title, description?, subject?, gradeLevel?, topics[]?, standards[]?, keywords?, visibility?, h5pContentId | fileId | url | lessonPlanId } -> 201 draft
GET    /library/items/{id}                            item with versions, myRating, collections; counts a view
PATCH  /library/items/{id}                            fields above + parameters? (interactive) + versionNote?; content changes add a version; widening reach may set pending_review
DELETE /library/items/{id}                            204 (soft delete, removed from the index)
POST   /library/items/{id}/publish | unpublish | archive
POST   /library/items/{id}/review                     library.moderate: { decision: approve | reject, note? } (district reach: school administrator; public reach: district role)
POST   /library/items/{id}/flag                       { reason: inaccurate | inappropriate | copyright | broken | other, details? }
POST   /library/items/{id}/rate                       { stars 1..5, comment? }; library.own_item (400) for the creator
POST   /library/items/{id}/copy                       library.create: private draft copy in your school (interactive content duplicated)
GET    /library/items/{id}/versions                   newest first, with snapshots
POST   /library/items/{id}/versions/{n}/restore       the old version becomes the newest
GET    /library/items/{id}/download                   the document behind the item
GET    /library/collections                           POST { title, description?, visibility? }; GET/PATCH/DELETE /{id}; POST /{id}/items { itemId }; DELETE /{id}/items/{itemId}; POST|DELETE /{id}/follow
GET    /library/moderation                            library.moderate: { pending[], flags[] }
POST   /library/flags/{id}/resolve                    { action: dismiss | unpublish, note? }
```

### Learning paths (Release 3 slice 23)

```
GET    /me/learning/profile                       learning.view (students): { student, health { score, band, parts[] }, mastery, attendance, work, practice, ai, flags, gaps[], recommendations[], paths[] }
GET    /students/{id}/learning/profile            the same for family, the student's teachers and school staff
GET    /me/learning/paths | /students/{id}/learning/paths   paths with steps, progress and hrefs
POST   /students/{id}/learning/paths/generate     learning.records: { subject? } -> 201 path built from gaps; paths.no_gaps | paths.no_content (400)
POST   /students/{id}/learning/paths              { title, goal?, steps: [{ kind, refId?, title, reason?, standardCode? }] } -> 201
GET    /learning/paths/{id}                       PATCH { title?, goal?, status? } (learning.records); DELETE 204
POST   /learning/paths/{id}/steps                 learning.records: add a step at the end
PATCH  /learning/paths/{id}/steps/{sid}           { status?, position?, title?, reason? }; students may send status done | skipped only
DELETE /learning/paths/{id}/steps/{sid}           learning.records
GET    /classes/{id}/learning/paths               learning.records: every active and completed path in the class with progress
Event  practice.reviewed                          emitted after a practice card review (also available to webhooks)
```

### Careers and portfolio (Release 3 slice 24)

```
GET    /me/portfolio                               portfolio.view (students): portfolio, every project, skills; PATCH { headline?, about?, visibility?, slug? }
GET    /me/portfolio/evidence                      my submissions a project may cite
POST   /me/portfolio/projects                      { title, summary?, description?, kind?, skills[]?, reflection?, externalUrl?, completedOn?, sourceSubmissionId?, fileIds[]?, featured?, status? } -> 201 draft
PATCH  /me/portfolio/projects/{id}                 same fields; DELETE 204; POST /reviews/{rid}/hide
GET    /students/{id}/portfolio                    family and the student's teachers always; counselors and administrators of the school; others by visibility (403 otherwise)
POST   /portfolio/projects/{id}/reviews            portfolio.review: { comment, stars? }; portfolio.own_project (400); parents 403
GET    /p/{slug}                                   public; published projects and skills of a public portfolio
GET    /skills                                     catalogue; POST { name, category, description? } (portfolio.skills.manage)
PUT    /me/skills                                  { skillId, level 1..4, note? }; DELETE /me/skills/{skillId}
POST   /students/{id}/skills/{skillId}/endorse     portfolio.review: { comment? } once per person
GET    /career/inventory | /career/clusters        the statements and the sixteen clusters
GET    /me/career | /students/{id}/career          career.view: goals, interests (scores, top, code, clusters), pathways, collegePlans, checklist, readiness, canCounsel
POST   /me/career/inventory                        { answers: { id: 1..5 } } (all eighteen)
PATCH  /students/{id}/career                       { goals?, pathways[]?, collegePlans[]? } (the student or their counselor)
POST   /students/{id}/career/checklist             { key, done } (students their own items, counselors any)
GET    /students/{id}/resume | /resume.pdf         resume data | PDF (audited resume.pdf)
GET    /code/lessons                               code.learn: { available, lessons[] with best result }; POST (code.manage) { title, description, level?, starter, tests: [{ expr, expected }] }
GET    /code/lessons/{id}                          starter, tests (label, expected), last submission
POST   /code/lessons/{id}/run                      { source } -> { status, passed, total, outcomes[], output, error, runtimeMs }; code.sandbox_unavailable when off
GET    /students/{id}/code/progress                solved, attempted, per lesson
```

### Mobile and push (Release 2 slice 18)
```
GET    /mobile/home                         one call for the first screen: todayClasses, work { overdue, dueSoon, recentlyGraded }, unread, attendance (teachers), motivation (students), children (families), announcements
GET    /mobile/sync?since=                  classes, assignments, grades, announcements, notifications, conversations changed since the cursor; next = the cursor to send next time
GET    /mobile/classes | /mobile/assignments?page&pageSize | /mobile/grades | /mobile/attendance?days=   slim lists; assignments sorted overdue first with state graded|submitted|missing|due|open
GET    /me/devices                          { data, configured }; POST { platform ios|android|web, token, name?, appVersion?, locale? } -> 201 (same token = check-in); DELETE /me/devices/{id}
POST   /me/devices/test                     { configured, devices, sent, simulated, failed }
GET    /organizations/{id}/push/status      organizations.view: configured, devices, activeDevices, last7Days by status
PUT    /notifications/preferences           each row now carries push (default true); push follows the in-app switch
POST   /ai/tutor/conversations/{id}/messages   { content, stream?, clientMessageId? }; a known clientMessageId returns { userMessage, assistantMessage, replayed: true } as JSON even when stream was asked
GET    /ai/tutor/conversations/{id}/messages?since=   messages after a time, oldest first, plus serverTime
```
Responses over 1 KB are gzip-compressed when the client accepts it. Push needs `FIREBASE_SERVICE_ACCOUNT_JSON` (docs/04); without it the API reports `configured: false` and logs pushes as simulated.

### Insight (Release 2 slice 17)
```
GET    /organizations/{id}/insight/overview?date=    reports.view + administrator or counselor: attendance today, missing work by grade level, failing by class, gradebook completeness, AI usage, activity
GET    /organizations/{id}/insight/reports/{kind}.csv?classId=   kinds school_overview | attendance_today | missing_work | failing_students | gradebook_completeness | ai_usage | class_summary (class teachers may pull their own class)
GET    /organizations/{id}/report-schedules         reports.schedule; POST { name, kind, frequency daily|weekly|monthly, dayOfWeek?, dayOfMonth?, hour (UTC), classId?, recipients[] staff emails } -> 201
PATCH  /report-schedules/{id}                       { name?, frequency?, dayOfWeek?, dayOfMonth?, hour?, recipients?, active? }; DELETE -> 204
GET    /report-schedules/{id}/runs                  the last 50 runs; POST /report-schedules/{id}/run -> the run now (delivered false when no mail transport is configured)
GET    /classes/{id}/insight                        reports.view, class teachers, counselors, administrators: distribution, attendance, missing, atRisk with flags, roster, assignments
GET    /students/{id}/insight                       reports.view or family.view: classes with current grades, attendance, missing, weekly series, AI and practice counts, flags
GET    /students/{id}/transcript.pdf                reports.view or the family's report-card features: published report cards by year, per-year and cumulative GPA; audited
```
Reports carry student data, so recipients are checked against staff accounts at the school (`insight.recipient_not_staff`). Nothing here ranks students; at-risk lists are alphabetical.

### Learning records and science (Release 2 slice 16)
```
GET    /practice/queue?limit=20             due cards (oldest first) then new ones for the signed-in student; due, newCards, reviewedToday
GET    /practice/cards?status=              all of the student's cards with status new|learning|mastered|struggling; POST { front, back, hint? } -> 201
POST   /practice/cards/from-content/{contentId}   every card of a published Dialogcards set, once per card -> 201 { created, skipped, title }
POST   /practice/cards/{id}/review          { quality 0..5, durationMs? } -> card after SM-2, reviewedToday, sessionGoal 10, reward (practice XP on the tenth review of the day)
POST   /practice/cards/{id}/suspend         { suspended } ; DELETE /practice/cards/{id} -> 204
GET    /me/practice | /me/mastery | /me/learning/curve        the student's own statistics, mastery per standard (bands, strongest, weakest), twelve weekly points
GET    /students/{id}/mastery | learning/curve | learning/records?limit= | practice   family, the student's teachers, counselors and administrators
GET    /courses/{id}/mastery?studentId=     mastery rings per module (the signed-in student, or a child or taught student)
GET    /classes/{id}/mastery                learning.records: per standard the class average, band counts and who needs help; /classes/{id}/learning/curve
GET    /h5p/contents/{id}/analytics         attempts, completion and pass rates, average score and time, distinct students
GET    /xapi/statements?studentId&objectId&objectType&verb&since&until&limit   learning.records, own school
GET    /organizations/{id}/xapi/export?since&limit    organizations.structure, audited: full xAPI statements oldest first; next is the last stored time
```
Events: `h5p.result.recorded` (new), `lesson.completed`, `assignment.submitted`, `grade.posted` feed the listener. Statements use `https://smartschool.local` as the actor account home page and the activity IRI base until a public hostname is configured.

### Teacher assistant (Release 2 slice 15)
```
GET    /assistant/lesson-plans              mine (administrators: the school's); POST { topic, classId?, courseId?, lessonId?, durationMinutes, standard?, language? } -> 202 AI job, resultId is the plan
GET    /lesson-plans/{id}                   PATCH { title?, content?, status draft|published, scheduledOn?, classId? }; DELETE
POST   /assistant/grading/assignments/{id}/suggest      one grading job per ungraded text submission (latest attempt); RUBRIC block from the rubric or an overall criterion
GET    /assistant/grading/assignments/{id}  suggestions with excerpt, criterion scores, evidence, confidence, needsHumanReview, suggestedPoints scaled to the assignment
POST   /grading-suggestions/{id}/approve    { score?, feedback? } posts the grade through the normal grade route; /reject; POST .../approve-all posts only confident ones
GET    /assistant/drafts?kind=&studentId=   my drafts; POST /assistant/drafts/parent-email { studentId, purpose, tone?, topic?, language? }, /narrative { studentId, classId }, /narratives { classId }, /differentiation { lessonId } -> 202 jobs
GET    /drafts/{id}                         PATCH { title?, content?, status? }; DELETE; POST /drafts/{id}/send (message to the guardians); /apply-to-report-card (draft card line comment); /create-lessons (three unpublished lessons)
GET    /assistant/classes/{id}/insight      latest briefing; POST builds this week's numbers (tutor traces, missing work, scores, attendance, lessons finished) and narrates them -> 202 { insight, job }
POST   /assistant/insights/{id}/practice-set { topic?, count? } -> the quiz job; PATCH /assistant/insights/{id} { practiceContentId }
GET    /classes/{id}/substitutes            POST { userId, startsAt, endsAt, note? } (classes.substitutes); DELETE /substitutes/{id}; access becomes a co-teacher row inside the window and is removed when it ends
GET    /planner?week=YYYY-MM-DD             the teacher's week: due dates, scheduled plans, events, term boundaries (planner.view)
```
Rules: every draft is labelled, private to its author, and reaches a student, a family or the gradebook only through an explicit action; grading suggestions with any criterion below 0.6 confidence are never bulk-approved; data blocks carry one student's numbers only. Errors: `403 assistant.already_reviewed`, `403 assistant.no_content`, `403 assistant.already_teacher`, `404 assistant.no_report_card`.

### Motivation (Release 2 slice 14)
```
GET    /me/motivation                       the signed-in student only: xp, level, title, levelStartXp, nextLevelXp, todayXp, streak { days, longest, alive, freezeTokens }, badges, quests (own progress; class quests add classTotal), recent rewards
GET    /students/{id}/motivation            the same for the student's family, teachers, counselors and administrators (motivation.view)
POST   /students/{id}/motivation/awards     { kind xp, amount 1..100, reason } or { kind badge, badgeCode kindness|helper|leader, reason }; the student's teachers and administrators (motivation.award); 403 motivation.already_awarded
GET    /classes/{id}/motivation             teacher console: students alphabetically with level, streak, badges, on-time count and nearMilestone; class quests with totals and participant counts; never a ranking
GET    /classes/{id}/quests                 class quests for a member: class total plus the caller's own count; POST { title, metric lessons|submissions|on_time|xp, goal, rewardXp, endsAt? } by the class teachers; DELETE /quests/{id}
POST   /lessons/{id}/complete               a student marks a published lesson finished; XP once per lesson; { completed, alreadyCompleted, reward }
GET    /courses/{id}/progress               progress map: modules and lessons with completion and nextLessonId; students see their own, others pass studentId
GET    /badges                              the badge catalogue
GET    /organizations/{id}/motivation/settings  { motivationEnabled }; PUT under organizations.structure
```
Rules (`modules/motivation/motivation-rules.ts`): XP 10 per lesson, 20 per first submission plus 10 on time, 15 when a score beats the previous one, 25 for a perfect score, quest rewards and teacher awards on top; automatic XP is capped at 200 a day and granted once per entity; levels need 100, 250, 475, 813... cumulative XP and never go down; titles follow levels; a streak counts consecutive school days with a learning action, a freeze token (earned every five days, two at most) covers one missed day; badges have fixed criteria except the three teacher-awarded ones. Events: `assignment.submitted` and `grade.posted` feed rewards; `lesson.completed` is emitted. Jobs: Monday 06:00 personal weekly quests from what the student has ahead; 00:10 daily expiry. Notifications use category `motivation` (in-app only by default).

### Families and Spanish (Release 2 slice 13)
```
GET    /family/home                         parents and students (family.view): every linked child with classes and current grades, attendance (30 days), missing work, work due in seven days, grades from the last seven days, behaviour notes and report cards
GET    /family/digest                       the weekly digest email as it would be sent today, in the caller's language ({ subject, text })
GET    /lessons/{id}/summaries              family-language lesson summaries; staff see drafts and released, families only released
POST   /lessons/{id}/summaries              { language en|es } -> 202 AI job (ai.content.summary); poll /ai/jobs/{id}, resultId is the summary
PATCH  /lesson-summaries/{id}               title, summary, keyIdeas[], questions[], tryAtHome[], status draft|released (release records the reviewer)
DELETE /lesson-summaries/{id}
GET    /students/{id}/conference-notes      the student's teachers, counselors and administrators (ai.content.conference); never families
POST   /students/{id}/conference-notes      { language } -> 202 AI job drafted from this student's own records only
DELETE /conference-notes/{id}
PATCH  /auth/me                             locale en|es sets the interface language and the language of alerts and emails
```
Errors: `403 summaries.released` when drafting over a released summary, `403 summaries.no_content` for a lesson with no text. Jobs: weekdays at 16:30 guardians are told about work that became missing in the last day (category `assignment`, link `/family`); Sundays at 17:00 the weekly digest goes out (category `digest`, email on by default) in each guardian's language.

### Grading, standards and report cards (Release 2 slice 11)
```
GET    /classes/{id}/grading                     gradingMode points|standards, proficiencyScaleId, scale, latePolicy, syllabus, categories[], weightWarning; members and staff
PUT    /classes/{id}/grading                     gradingMode, proficiencyScaleId, latePolicy, syllabus; grades.edit and canManage
POST   /classes/{id}/grading/categories          name, weight (percent), dropLowest, sortOrder; 409 grading.category_exists
PATCH  /classes/{id}/grading/categories/{catId}  DELETE too; assignments keep their label and count by points
GET    /classes/{id}/gradebook                   mode categories|points, categories[], assignments[] (categoryId, isExtraCredit), rows[] { cells { score, percentage, mark graded|missing|excused|incomplete|none, dropped, extraCredit }, categories[] { percentage }, percentage, letter, missing }, standards { levels, standards[], rows[] } for standards-based classes
GET    /classes/{id}/gradebook/export            CSV with category columns; M, EX and I for marks
PUT    /assignments/{id}/marks/{studentId}       mark missing|excused|incomplete or null to clear, note; assignments.grade
GET    /organizations/{id}/proficiency-scales    POST/PATCH/DELETE under organizations.structure; levels[] { level, label, minPercent }; a default is created on first read
GET    /standards/sets                           shared sets plus my district's; standards.view
POST   /standards/sets                           code, name, subject, jurisdiction, sourceUri, version, organizationId (super admin omits it for a shared set); standards.manage
POST   /standards/sets/import                    multipart "file": a 1EdTech CASE JSON package; code; -> set with imported and skipped counts
POST   /standards/sets/{id}/standards            code, description, gradeLevels, parentCode, sortOrder
DELETE /standards/sets/{id}                      409 school.in_use while assignments are tagged
GET    /standards                                setId, gradeLevel, search, page
POST   /report-cards/generate                    gradingPeriodId, kind report_card|progress, classId (required for teachers) -> drafts from the current gradebooks (published cards untouched); report-cards.manage
GET    /report-cards                             studentId, gradingPeriodId, classId, status, kind; students and parents see published ones; teachers their classes
GET    /report-cards/{id}                        lines[] { className, percentage, letter, gpaPoints, categories[], standards[], comment, canComment }, gpa, attendance, canPublish
GET    /report-cards/{id}/pdf                    application/pdf
PATCH  /report-cards/{id}/lines/{lineId}         comment (class teacher, while draft; 409 report-cards.published after)
POST   /report-cards/{id}/publish                administrators, or the teacher of a one-class card; notifies the student and guardians; updates Students.GPA
POST   /report-cards/publish                     gradingPeriodId, kind -> every draft in the school; report-cards.publish
```
### Assignments, submissions, grades
```
GET    /assignments                   classId, type, status, dueBefore, dueAfter, search; students and parents see
                                      published work in their classes with mySubmission and myGrade
POST   /assignments                   classId, title, type, submissionType, category, maxPoints, weight, availableFrom,
                                      dueAt, allowLateUntil, latePenaltyPercent, maxAttempts, rubricId, h5pContentId -> draft
GET    /assignments/{id}              students: with mySubmissions
PATCH  /assignments/{id}
DELETE /assignments/{id}              only while ungraded
POST   /assignments/{id}/publish
POST   /assignments/{id}/close
GET    /assignments/{id}/submissions  every enrolled student with latest submission and grade (class teachers)
POST   /assignments/{id}/submissions  textContent, fileIds[] (own uploads) -> attempt number; late flag; window and attempt limits enforced
GET    /submissions/{id}              the student, their guardians, or staff managing the class
POST   /submissions/{id}/grade        score (raw), feedback, rubricScores[], waiveLatePenalty, standardScores[] { standardId, level } -> grade with percentage, letter and standardScores;
                                      late penalty applied from the assignment; ClassEnrollments.currentGrade refreshed
GET    /grades                        studentId, classId, assignmentId; grades.view.all | grades.view.own | grades.view.child
GET    /classes/{id}/gradebook        weighted points matrix, per-student totals and letters, class and per-assignment averages
GET    /classes/{id}/gradebook/export CSV
GET    /rubrics, POST /rubrics, GET/PATCH/DELETE /rubrics/{id}   criteria[] { id, title, maxPoints, levels[] }
```

### Attendance
```
GET    /attendance                    classId, studentId, date, from, to; attendance.view | attendance.view.own | attendance.view.child
POST   /attendance                    classId, studentId, date, codeId or status, periodId, notes (upsert; the code's category sets the status)
POST   /attendance/bulk               classId, date, periodId, records[] { studentId, codeId or status, notes }
PATCH  /attendance/{id}               codeId or status, notes
GET    /organizations/{id}/attendance/status   date -> classes meeting that day: taken[], missing[], deadline; attendance.view
GET    /organizations/{id}/attendance/export   from, to, type ada|chronic -> CSV per student (days enrolled, present, absent, rate, chronically absent); attendance.report
GET    /classes/{id}/attendance/summary        from, to -> per-student counts and rates, class rate, days recorded
GET    /students/{id}/attendance/summary       from, to -> overall and per-class counts
```
### Announcements, notifications, files

Announcements are drafts until published; publishing notifies the class (teachers, students, guardians) or the whole school. Teachers post to classes they teach; school-wide posts need an administrator. Learners see only published, unexpired items for their school and classes.

```
GET    /announcements                 classId, type, priority, status, page; pinned first, then urgency, then newest
POST   /announcements                 { title, content, classId?, type?, priority?, pinned?, expiresAt?, publish? } -> 201
GET    /announcements/{id}
PATCH  /announcements/{id}            author or administrator
DELETE /announcements/{id}
POST   /announcements/{id}/publish    -> notifications; urgent or emergency items are also emailed

GET    /notifications                 unreadOnly, category, page
GET    /notifications/summary         { unread, byCategory, latest[8] } for the bell
POST   /notifications/{id}/read
POST   /notifications/read-all
GET    /notifications/preferences     every category with in-app and email switches (defaults: in-app on; email on for security only)
PUT    /notifications/preferences     { preferences: [{ category, inApp, email }] }

POST   /files?category=               multipart field "file"; extension allowlist (ALLOWED_EXTENSIONS or the default list, never executables),
                                      MAX_FILE_SIZE_MB; stored under UPLOAD_DIR/<org>/<yyyy>/<mm>/<id>.<ext>; sha256 recorded
GET    /files/{id}                    metadata (uploader, staff of the organisation, file managers, guardians via submissions, participants of a conversation the file was sent in)
GET    /files/{id}/download           bytes with a safe Content-Disposition
DELETE /files/{id}                    uploader or files.manage; refused while attached to a submission
```

Notification categories: announcement, assignment, grade, message, attendance, system, ai. Producers: `assignment.published`, `assignment.submitted`, `grade.posted`, `announcement.published`, `message.sent` (docs/04 section 6). The actor of an event is never notified about it.
### Messaging

Who may message whom (`messaging-rules.ts`): staff reach everyone in their school; students and parents reach school staff only; classmates meet in class conversations a teacher opens. Nobody reaches outside their organisation.

```
GET    /conversations                 mine, newest activity first, with unreadCount, lastMessage, participants
GET    /conversations/contacts        people I may message (search)
POST   /conversations                 { type: direct|group|class, participantIds? | classId?, title? } -> 201 (an existing direct or class conversation is returned)
GET    /conversations/{id}
PATCH  /conversations/{id}            title (creator or staff), muted (for me)
POST   /conversations/{id}/participants    { userIds } (staff)
DELETE /conversations/{id}/participants/{userId}
POST   /conversations/{id}/leave
GET    /conversations/{id}/messages   oldest first; before=<messageId>, limit
POST   /conversations/{id}/messages   { content, replyToMessageId?, fileIds? } -> 201; participants get it live and a `message` notification
POST   /conversations/{id}/read       moves my read mark
PATCH  /messages/{id}                 sender, within an hour
DELETE /messages/{id}                 sender, or staff with messages.delete (audited)
```

Socket namespaces `/hubs/notifications` and `/hubs/messaging` are served at path `/api/socket.io` (no trailing slash) so the web client reaches them through its same-origin proxy, polling first with a WebSocket upgrade where the proxy forwards it. The handshake carries the access token in `auth.token` (or `Authorization` / `access_token`) and is checked against the session like any HTTP call. Events follow docs/04 section 3: `NewNotification`, `SummaryChanged`; `JoinConversation`, `LeaveConversation`, `SendMessage`, `Typing`, `StopTyping`, `MarkConversationAsRead`, `GetOnlineUsers`; `ReceiveMessage` (plus `ReceiveMessage:list` to every participant for list updates), `MessageEdited`, `MessageDeleted`, `ConversationRead`, `UserTyping`, `UserStoppedTyping`, `ParticipantAdded`, `ParticipantRemoved`, `AddedToConversation`, `RemovedFromConversation`, `MessageError`.
### AI tutor and AI content

The tutor is a conversation the LMS owns; the AI service (docs/10) only answers one turn at a time from a Context Envelope. Every assistant message is stored with its status (`ok`, `refused`, `degraded`, `unavailable`), prompt version, model, citations and safety labels, so a parent or teacher can later see exactly what the tutor said and why. All routes sit behind the `ai.tutor` feature flag and the `ai.tutor.chat` feature; a per-user daily message quota (`AI_TUTOR_DAILY_LIMIT`, default 150) answers `403 ai.quota_exceeded`; when the AI service is down the API answers `503 ai.unavailable` and stores an `unavailable` turn rather than inventing an answer.

```
GET    /ai/tutor/status                         { available, status, models, promptVersions } from the AI service health
GET    /ai/tutor/conversations                  my conversations (newest first)
POST   /ai/tutor/conversations                  { mode: explain|socratic|homework, courseId?, lessonId?, classId?, title? } -> 201
GET    /ai/tutor/conversations/{id}             conversation with messages (own only; others 404)
DELETE /ai/tutor/conversations/{id}
POST   /ai/tutor/conversations/{id}/messages    { content, stream? } -> { userMessage, assistantMessage }
                                                stream=true -> text/event-stream: user, token*, assistant events
POST   /ai/tutor/messages/{id}/feedback         { rating: 1|-1, comment? } -> 204 (audited with the trace id)
POST   /ai/rag/reindex                          { organizationId? } push published lesson text to the AI index (system.health.view; nightly cron too)

POST   /ai/content/quizzes                      { topic, subject?, gradeLevel?, count?, difficulty?, questionTypes?, standard?, lessonId?, courseId? } -> 202 job
POST   /ai/content/flashcards                   same body -> 202 job
POST   /ai/content/{id}/regenerate              { feedback } -> 202 job (new draft; original kept)
GET    /ai/jobs/{jobId}                         { id, status, progress, contentId, content?, error? }
```

Internal tool API for the AI service (not for browsers; header `X-Service-Token` = `AI_CALLBACK_TOKEN`, never a user token; excluded from Swagger):

```
GET    /internal/ai/lessons/{id}                published lesson text (max 6000 chars), module and course titles
GET    /internal/ai/courses/{id}/outline        published modules and lesson titles
GET    /internal/ai/students/{id}/context       first name, grade, age band, learning style, accessibility needs, enrolled classes (never contact details)
GET    /internal/ai/organizations/{id}/lessons  every published text lesson as { docId, lessonId, courseId, title, text } for indexing
```

What the API puts in the Context Envelope: the actor (role, age band from date of birth or grade), the lesson text as block `C1` when the conversation is on a lesson, a short "about the student" block, the last 10 turns, and the capability for the mode (`tutor.chat`, `tutor.socratic`, `tutor.homework_help`). Emails, guardians and other students are never sent.
### H5P (interactive content)

Content is a library name plus parameters, exactly what the H5P player consumes. Teachers create it by hand or from an AI job; it stays a draft until a teacher publishes it. The browser player cannot send our bearer token, so an authorised call mints a 15-minute signed play ticket and the package routes accept only that ticket.

```
GET    /h5p/libraries                         libraries the player serves (pinned versions, seeded)
GET    /h5p/contents                          search, status, contentType, organizationId; learners see published only
POST   /h5p/contents                          { title, library: "H5P.QuestionSet 1.20", parameters, subject?, gradeLevel?, topic?, courseId?, lessonId? } -> 201 (validated)
GET    /h5p/contents/{id}                     with parameters, the AI draft and validation { valid, errors }
PATCH  /h5p/contents/{id}                     title, parameters (validated; maxScore recomputed), subject, gradeLevel, topic
POST   /h5p/contents/{id}/publish             refuses unplayable parameters
POST   /h5p/contents/{id}/unpublish
DELETE /h5p/contents/{id}                     refused while an assignment uses it (h5p.in_use)
GET    /h5p/contents/{id}/play?assignmentId=  { ticket, h5pJsonPath, title, library, maxScore, expiresAt }
GET    /h5p/play/{ticket}/h5p.json            package manifest (public route, ticket only)
GET    /h5p/play/{ticket}/content/content.json
POST   /h5p/contents/{id}/results             { score, maxScore, completed?, timeSpentSeconds?, assignmentId?, detail? } -> 201
                                              with assignmentId (students): a submission plus an auto-posted grade scaled to the assignment points
GET    /h5p/contents/{id}/results             staff: everyone; learners: their own
```

AI content generation lives under `/ai/content/*` (previous section): `POST /ai/content/quizzes|flashcards` returns `202 { id, status: queued|running|done|failed, progress, contentId, content?, error? }`; `GET /ai/jobs/{id}` polls it and, on `done`, `contentId` points at the new draft. `POST /ai/content/{id}/regenerate { feedback }` starts a new job from the teacher's feedback and the previous draft; the original stays.
### Service callbacks (unchanged contract, ADR-001)
```
POST   /api/ai/h5p/content
POST   /api/ai/h5p/validate
GET    /api/ai/h5p/libraries
```
These three keep their exact previous paths outside `/api/v1` because the retained Python service calls them.

---

## 4. Example error

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://docs.smartschool.local/errors/authz.forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "This action requires the feature 'students.create'.",
  "instance": "/api/v1/students",
  "code": "authz.forbidden",
  "traceId": "0f6d1d2e-6d9a-4c8a-9c1e-2b7f3b1a9e11"
}
```

## 5. Example list

```http
GET /api/v1/students?page=2&pageSize=20&sort=lastName&gradeLevel=9

{ "data": [ { "id": "...", "studentNumber": "STU2024001", "firstName": "Emma", "lastName": "Johnson", "gradeLevel": "9", "status": "active" } ],
  "meta": { "page": 2, "pageSize": 20, "totalItems": 143, "totalPages": 8 } }
```
