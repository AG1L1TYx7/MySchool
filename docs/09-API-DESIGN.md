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
```
POST   /auth/register                 email, password, firstName, lastName, role?, organizationId?, captchaToken?
POST   /auth/login                    email, password, rememberMe        -> accessToken, refreshToken, expiresAt, user
                                      or { mfaRequired: true, mfaToken } when 2FA is on (5 failures lock for 15 min)
POST   /auth/2fa/challenge            mfaToken, code (authenticator or backup) -> token pair
POST   /auth/refresh                  refreshToken                        -> new pair (rotation)
POST   /auth/logout                   revokes the refresh token
GET    /auth/me                       current user with roles and effective feature codes
PATCH  /auth/me                       first name, last name, phone, preferences
POST   /auth/change-password
POST   /auth/forgot-password          always 202
POST   /auth/reset-password           token, newPassword
POST   /auth/2fa/setup                -> secret, otpauth URL, QR
POST   /auth/2fa/verify               enables 2FA, returns backup codes
POST   /auth/2fa/disable
POST   /auth/2fa/backup-codes         regenerate
GET    /auth/sessions                 active refresh tokens (device, last seen)
DELETE /auth/sessions/{id}
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
```

### Students and guardians
```
GET    /students                      search, gradeLevel, status, classId
POST   /students
GET    /students/{id}
PATCH  /students/{id}
DELETE /students/{id}
GET    /students/{id}/guardians
POST   /students/{id}/guardians       parentUserId or invite by email, relationship, isPrimary, notifications
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
POST   /courses/{id}/publish
POST   /courses/{id}/clone
GET    /courses/{id}/modules
POST   /courses/{id}/modules
PATCH  /modules/{id}
DELETE /modules/{id}
POST   /modules/{id}/lessons
PATCH  /lessons/{id}
DELETE /lessons/{id}
PUT    /courses/{id}/prerequisites    array of course ids
```

### Classes and enrolment
```
GET    /classes                       term, courseId, teacherId, status
POST   /classes
GET    /classes/{id}
PATCH  /classes/{id}
DELETE /classes/{id}
POST   /classes/{id}/teachers         teacherId, isPrimary
DELETE /classes/{id}/teachers/{teacherId}
GET    /classes/{id}/enrollments
POST   /classes/{id}/enrollments      studentIds[]
PATCH  /classes/{id}/enrollments/{studentId}   status
DELETE /classes/{id}/enrollments/{studentId}
GET    /students/{id}/classes
```

### Assignments, submissions, grades
```
GET    /assignments                   classId, type, status, dueBefore, dueAfter
POST   /assignments                   supports h5pContentId, rubricId
GET    /assignments/{id}
PATCH  /assignments/{id}
DELETE /assignments/{id}
POST   /assignments/{id}/publish
GET    /assignments/{id}/submissions
POST   /assignments/{id}/submissions  student submits text and file ids; attempt number assigned
GET    /submissions/{id}
POST   /submissions/{id}/grade        score, feedback, rubric scores
GET    /grades                        studentId, classId, assignmentId
GET    /classes/{id}/gradebook        matrix with weights and averages
GET    /classes/{id}/gradebook/export CSV or XLSX
GET    /rubrics, POST /rubrics, GET/PATCH/DELETE /rubrics/{id}
```

### Attendance
```
GET    /attendance                    classId, studentId, date, from, to
POST   /attendance                    one record
POST   /attendance/bulk               a class on a date
PATCH  /attendance/{id}
GET    /classes/{id}/attendance/summary
GET    /students/{id}/attendance/summary
```

### Announcements, notifications, files
```
GET    /announcements                 classId, organizationId, type, priority
POST   /announcements
GET    /announcements/{id}
PATCH  /announcements/{id}
DELETE /announcements/{id}
POST   /announcements/{id}/publish
GET    /notifications                 unreadOnly, category, cursor
GET    /notifications/summary
POST   /notifications/{id}/read
POST   /notifications/read-all
GET    /notifications/preferences
PUT    /notifications/preferences
POST   /files                         multipart upload -> file resource
GET    /files/{id}                    metadata
GET    /files/{id}/download
DELETE /files/{id}
```

### Messaging
```
GET    /conversations                 cursor
POST   /conversations                 type direct|group|class, participantIds or classId
GET    /conversations/{id}
PATCH  /conversations/{id}            title, mute
POST   /conversations/{id}/participants
DELETE /conversations/{id}/participants/{userId}
POST   /conversations/{id}/leave
GET    /conversations/{id}/messages   cursor
POST   /conversations/{id}/messages   content, replyToMessageId, fileIds
PATCH  /messages/{id}
DELETE /messages/{id}
POST   /conversations/{id}/read
```
Socket namespace `/hubs/messaging` carries the same events as before (docs/04 section 3).

### AI tutor and AI content
```
POST   /ai/tutor/conversations                  start a tutoring conversation (subject, gradeLevel, courseId?)
GET    /ai/tutor/conversations                  history for the current student
GET    /ai/tutor/conversations/{id}
POST   /ai/tutor/conversations/{id}/messages    message -> answer (streamed when Accept: text/event-stream)
POST   /ai/tutor/homework-help
POST   /ai/tutor/explain
POST   /ai/content/quizzes                      topic, gradeLevel, count, difficulty -> 202 job; result includes h5pContentId
POST   /ai/content/flashcards
POST   /ai/content/fill-in-blanks
POST   /ai/content/lesson-plans
POST   /ai/content/{id}/regenerate               feedback
GET    /ai/jobs/{jobId}
```

### H5P
```
GET    /h5p/libraries
GET    /h5p/contents                  library, createdBy, search
POST   /h5p/contents
GET    /h5p/contents/{id}
PATCH  /h5p/contents/{id}
DELETE /h5p/contents/{id}
GET    /h5p/contents/{id}/play        parameters and library files for the player
POST   /h5p/contents/{id}/results     score, maxScore, timeSpent, detail -> result and xAPI statement id
GET    /h5p/contents/{id}/results
```

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
