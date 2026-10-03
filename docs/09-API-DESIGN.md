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
