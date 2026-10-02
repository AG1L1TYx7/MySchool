# SmartSchool Build Plan

**Written:** 30 September 2026 (revision 5: three releases as vertical slices, clean API, web client from Release 1)
**Scope:** build SmartSchool as `apps/api` (NestJS 11, Prisma 6) on XAMPP MySQL, `apps/web` (Next.js), and the retained Python AI service `apps/ai`, to the standard in [08-PRODUCT-STRATEGY.md](08-PRODUCT-STRATEGY.md), covering every capability in [02-FEATURE-CATALOG.md](02-FEATURE-CATALOG.md).
**Design context:** [01-SYSTEM-ARCHITECTURE.md](01-SYSTEM-ARCHITECTURE.md), [03-DATA-MODEL.md](03-DATA-MODEL.md), [04-INTEGRATION-CONTRACTS.md](04-INTEGRATION-CONTRACTS.md), [05-ADR.md](05-ADR.md), [09-API-DESIGN.md](09-API-DESIGN.md).

---

## 0. Decisions in one page

| Decision | Choice | Reference |
|---|---|---|
| Workspace | `smartschool/` pnpm workspace: `apps/api`, `apps/web`, `apps/ai`, `packages/*` | ADR-016 |
| Backend | NestJS 11, TypeScript strict, Prisma 6, Node 22+ | ADR-002, ADR-003 |
| Client | Next.js 14, React, TypeScript, shadcn/ui, TanStack Query, `socket.io-client`, `h5p-standalone`; WCAG 2.2 AA | 08 section 4 |
| Database | XAMPP MariaDB 10.4 in development; MySQL 8 or MariaDB 10.11 in production; CI on both | ADR-004 |
| AI service | Python, rebuilt fresh as `apps/ai` in Release 1 slice 5 | ADR-021 |
| API | Clean `/api/v1` design; RFC 9457 errors; three legacy callback routes kept | ADR-017, ADR-020 |
| Delivery | Three releases (Core, Depth, Platform), vertical slices of one to two weeks | ADR-018 |
| Scoping | Organisation in Releases 1 and 2; tenancy in Release 3 | ADR-019 |
| Honesty | No fake AI; teacher review before AI grades post | ADR-008 |
| Ports | api 5000, web 3000, ai 8000, MariaDB 3306, Ollama 11434 | |

---

## 1. Starting point (30 September 2026)

Phase 0 is complete and committed: workspace, `apps/api` foundation (config validation, Prisma service, health, metrics, logging, error handling, versioning, Swagger), bootstrap schema for identity, organisation, features, audit and `JobRuns`, seed skeleton, unit and e2e tests, CI on both engines, and the design set in `docs/`.

Not yet done on this machine: XAMPP's MariaDB is not started (the `MySQL800` service holds port 3306), so no migration has run. The previous implementation exists only in the old GitHub repository; its EF snapshot, `database.py` and the whole Python service are recovered from there when their slices start.

---

## 2. Environment (XAMPP and MariaDB)

### 2.1 Port 3306 is taken

Resolved on 1 Oct 2026 without touching the MySQL 8 service: XAMPP MariaDB 10.4.32 runs on **port 3307** (`C:\xampp\mysql\bin\my.ini`, `port=3307` under both `[client]` and `[mysqld]`), while the `MySQL800` service (MySQL Server 8.0) keeps 3306. `DATABASE_URL` therefore points at `127.0.0.1:3307`; the `smartschool` user and both databases exist. The steps below remain the way to reclaim 3306 if that is ever wanted.

`MySQL800` (MySQL 8) owns 3306; XAMPP's MariaDB wants it. Stop and disable both MySQL services, let XAMPP own 3306. Alternative: XAMPP on 3307 and `DATABASE_URL` on 3307.

```powershell
# Run as Administrator
Stop-Service MySQL800; Set-Service MySQL800 -StartupType Disabled
Set-Service MySQL80 -StartupType Disabled
C:\xampp\mysql_start.bat
```

### 2.2 MariaDB 10.4 is not MySQL 8

| Difference | Rule |
|---|---|
| No `utf8mb4_0900_ai_ci` | `utf8mb4` / `utf8mb4_unicode_ci` everywhere; migrations never name a collation |
| `JSON` is `LONGTEXT` with a check | Prisma `Json` works; no JSON-path indexes |
| 65,535-byte row limit | Strings over 1,000 chars are `@db.Text`/`@db.LongText`; never index `TEXT` without a prefix |
| No reliable UUID expression defaults | UUID v7 generated in the application; `Id` stays `char(36)` |
| `lower_case_table_names=1` on Windows | Keep exact PascalCase names; same flag on the Linux server |
| Older optimizer | Explicit composite indexes on every list query's filter and sort columns |
| No vector type | Vectors stay in the AI service (ADR-015) |

### 2.3 `my.ini` for development

```ini
[mysqld]
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
default-time-zone='+00:00'
sql_mode=STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION
innodb_buffer_pool_size=1G
innodb_default_row_format=DYNAMIC
max_allowed_packet=64M
max_connections=200
```

### 2.4 Users and databases

```sql
CREATE DATABASE smartschooldb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE smartschooldb_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartschool'@'localhost' IDENTIFIED BY '<choose-a-password>';
GRANT ALL PRIVILEGES ON smartschooldb.* TO 'smartschool'@'localhost';
GRANT ALL PRIVILEGES ON smartschooldb_test.* TO 'smartschool'@'localhost';
FLUSH PRIVILEGES;
```

Both services use the `smartschool` user. `.env` is never committed. Nightly `mysqldump` via Task Scheduler with 14-day retention; `pnpm db:backup` and `pnpm db:restore` scripts wrap it.

---

## 3. Release 1: Core (weeks 1 to 12)

Goal: a school can run a class on SmartSchool. Exit: a pilot class completes a full unit (plan, assign AI-generated practice, students complete it, grades post, parents notified) using the web client.

| Slice | Weeks | User outcome | API (docs/09) | Data | Client | AI |
|---|---|---|---|---|---|---|
| 1 Sign in | 1–2 | A teacher and a student can register, sign in, refresh, sign out, reset a password, enable 2FA | `/auth/*`, `/users`, `/roles`, `/features`, `/feature-flags`, `/audit-logs` | `Users`, `AuthSessions`, `PasswordResetTokens`, `Features`, `RoleFeatures`, `UserFeatureOverrides`, `FeatureFlags`, `AuditLogs`, `Organizations` | Next.js app: login, register, reset, 2FA, protected layout, feature-driven nav, users and audit pages | |

Status (2 Oct 2026, slice 7): communication is live. Tables `Announcements`, `Notifications`, `NotificationPreferences`, `Conversations`, `ConversationParticipants`, `Messages`, `MessageFiles`. Announcements: teachers post to classes they teach, administrators school-wide; drafts, publish, pin, priority, expiry; the feed orders pinned, then urgent, then newest; learners see only published items for their school and classes. Notifications: a `NotificationsService.notify()` fan-out that honours per-category in-app and email preferences (urgent announcements and security notices always deliver), with listeners on `assignment.published` (new event), `assignment.submitted`, `grade.posted`, `announcement.published` and `message.sent`; list, summary, read, read-all, preferences. Messaging: direct, group (staff) and class (teacher-opened) conversations with a safety policy in `messaging-rules.ts` (students and parents reach staff only), unread counts, read marks, replies, one-hour edits, deletes with staff moderation, attachments readable by participants. Realtime: Socket.IO gateways on `/hubs/notifications` and `/hubs/messaging` at path `/api/socket.io` (carried by the web proxy), handshake authenticated with the same token and session checks as HTTP (`WsAuthService`), rooms per user and per conversation, events per docs/04 section 3. 92 unit and 63 e2e tests (the e2e suite connects real sockets and asserts live delivery). Web: header bell with a live badge and dropdown, notifications page with preferences, announcements feed with posting and a dashboard card, messages view with a live thread, typing indicator and replies. Next: slice 8 (ship).

Status (2 Oct 2026, slice 6): AI content to H5P is live end to end. The AI service has a ContentAuthor agent (`POST /v1/content/generate` -> 202 job, `GET /v1/jobs/{id}`): JSON-mode generation against the `content.quiz@1` and `content.flashcards@1` prompts, strict draft validation with one repair pass through `shared.json_repair@1`, conversion to `H5P.QuestionSet 1.20` (Multiple Choice, True/False, Fill in the Blanks sub-content) or `H5P.Dialogcards 1.9`, structural H5P validation, a 180 s job timeout, a 24-hour per-organisation cache, and safety screening of the topic; 32 tests. Live on the RTX 5070: a 5-question quiz in about 7 s, a 5-card deck in about 3 s, both valid without repair. The API gained `H5PLibraries` (seeded from the pinned catalogue), `H5PContents` (draft -> published -> archived, AI or manual source, the AI draft kept beside the parameters), `H5PContentResults`, `AiJobs`; `/ai/content/quizzes|flashcards` (202), `/ai/content/{id}/regenerate` with teacher feedback, `/ai/jobs/{id}` (persists the draft exactly once when the job finishes), `/h5p/libraries`, `/h5p/contents` CRUD with publish/unpublish and parameter validation, `/h5p/contents/{id}/play` minting a 15-minute HMAC play ticket, the ticketed package routes `/h5p/play/{ticket}/h5p.json` and `content/content.json`, and `/h5p/contents/{id}/results` which, with an assignment, becomes a submission and an auto-posted scaled grade (late rules and attempt limits apply); 82 unit and 57 e2e tests. The web client serves the standalone H5P player and hub libraries from `/h5p` (`pnpm --filter @smartschool/web h5p:setup`, git-ignored), has the Interactive content home (generate with progress, drafts and published list), the review page (edit items in place, remove, preview as a student, regenerate with feedback, publish), a content picker on the assignment form, and plays the activity on the assignment page with a progress bar, a one-time result post and a celebration. Next: slice 7 (communication).

Status (1 Oct 2026, slice 5): the AI tutor is live end to end. `apps/ai` is a fresh Python 3.12+ FastAPI service (ADR-021) with the Context and Result Envelopes from docs/10, the prompt library, a rule-based safety classifier for minors, an AST-safe math tool, a SQLite vector store for lesson retrieval, pseudonymised JSONL traces, and streaming; 25 tests and ruff green. The API gained `AiConversations` and `AiMessages`, the `/ai/tutor/*` routes (status, conversations, messages with JSON or SSE, feedback), `/ai/rag/reindex` plus a nightly re-index, a daily per-user message quota, an age band derived from the student record, and the read-only internal tool API under `/internal/ai/*` behind the service token; 77 unit and 48 e2e tests green (the e2e suite runs against a stub AI service on a fixed port). The web client has the tutor home (mode pills, lesson picker, recent chats) and the chat page (streamed replies with a typing indicator, every AI turn labelled, citations or an honest "general knowledge" note, refusal and outage states, thumbs feedback) plus "Ask the tutor" links on published lessons. Live check on the RTX 5070: a homework-help reply through API, AI service and Ollama (llama3.1:8b) returns in about 2 s, streamed first token well under 1 s once the model is warm; the service warms the model at start so the first student does not hit a cold load. CI has an `ai` job (ruff, pytest with the fake provider). Next: slice 6.

Status (1 Oct 2026, later): slice 4 is complete too (files, rubrics, assignments, submissions with attempts and late rules, grading with rubric scores and penalties, gradebook with export, attendance with bulk marking and summaries) with 75 unit and 41 e2e tests green. Earlier the same day: slices 1, 2 and 3 were completed and the sign-in system was hardened to docs/11 (ADR-023): cookie-based refresh, email verification, join codes, common-password checks, TOTP replay protection, absolute session lifetime, mandatory 2FA for administrators in production, security notifications, web CSP. Migrations and seed applied to XAMPP MariaDB (port 3307); 66 unit and 34 e2e tests green; web client built. The AI service is redesigned in docs/10 (ADR-021) with its prompt library in `apps/ai/prompts`. UX slice (docs/12) part 1 done the same evening: motion tokens and wrapper components (page transitions, staggered lists, skeletons, animated progress bars and rings, count-ups, celebrations, sliding pill selectors) applied to sign-in, dashboard (This week card with real assignment and attendance progress), courses, classes, assignments (submission and grade celebrations), gradebook, attendance and grades; reduced motion honoured in one place. Still open from docs/12: Playwright flows for reduced motion, shared-element transitions, age-aware variants (need the age band on the user). Next: slice 5 (AI tutor; Python 3.14 is now installed), then slices 6 to 8. Gamified mechanics (XP, streaks, badges, quests, progress maps, leaderboards) ship in the Release 2 gamification slice to the design in docs/12 and are a standing requirement on every screen from slice 5 onward.
| 2 School and people | 3 | An admin creates the school, invites staff, adds students and guardians | `/organizations/*`, `/students/*`, guardians, import and export | `Organizations`, `Students`, `StudentGuardians` (membership is `Users.OrganizationId`; the old `Admins`/`AppUsers` tables are not recreated) | Admin pages: organisations, students (table, detail, guardians, CSV import with dry run, export) | |
| 3 Courses and classes | 4 | A teacher creates a course with modules and lessons, opens a class, enrols students; a student sees their classes | `/courses/*`, `/modules`, `/lessons`, `/classes/*`, enrollments | `Courses`, `Modules`, `Lessons`, `CoursePrerequisites`, `Classes`, `ClassTeachers`, `ClassEnrollments` | Teacher: course builder (modules, lessons, reorder, publish, clone), class roster with capacity and waitlist; Student and parent: my classes, course outline and lesson content | |
| 4 Assignments and grades | 5–6 | A teacher sets an assignment with a rubric, students submit text and files, the teacher grades, the gradebook updates, attendance is taken | `/assignments/*`, `/submissions/*`, `/grades`, `/classes/{id}/gradebook`, `/rubrics`, `/attendance/*`, `/files/*` | `Assignments`, `AssignmentSubmissions`, `Grades`, `Rubrics`, `Attendances`, `FileUploads` | Teacher: assignment editor, grading view, gradebook, attendance sheet; Student: submit | |
| 5 AI tutor | 7–8 | A student asks the tutor and gets a real answer; the school sees AI usage | `/ai/tutor/*` (streamed), `/ai/jobs`; build `apps/ai` fresh to docs/10 (orchestrator, Tutor agent in three modes, safety classifier, `lms.*` tools, RAG index, tracing, golden sets) | `AiRequests`, tutor conversations | Student: tutor chat with streaming and labelled AI output | Ollama `llama3.1:8b` through the AI service |
| 6 AI content to H5P | 9–10 | A teacher generates a quiz or flashcards from a topic, previews it, attaches it to an assignment; students play it and results post | `/ai/content/*` (202 + job), `/h5p/*`; the AI service returns H5P JSON in the job result (callbacks retired, ADR-022) | `H5PContents`, `H5PLibraries`, `H5PContentResults`, `H5PFiles`, `H5PContentAssignments` | Teacher: generate and review; Student: `h5p-standalone` player | Generation and H5P conversion |
| 7 Communication | 11 | Announcements reach a class; notifications appear live; teacher and student message each other | `/announcements/*`, `/notifications/*`, `/conversations/*`, `/messages`, `/hubs/notifications`, `/hubs/messaging` | `Announcements`, `Notifications`, `NotificationPreferences`, `Conversations`, `Messages`, receipts | Announcement feed, notification bell, chat | |
| 8 Ship | 12 | The pilot school installs it from the guide | `pnpm db:backup` and `db:restore`, `docker compose up`, demo seed, getting-started guide, OpenAPI published, load test with 10,000 seeded students, security checklist | | Lighthouse 90+, WCAG 2.2 AA audit on every page | |

Release 1 covers catalog domains 1 to 12, 18 and 23 (player and results), and the platform domain 35. Roughly 150 routes.

---

## 4. Release 2: US school readiness and depth (weeks 13 to 30)

Goal: a US district can switch a school on without typing a student in, and the product teaches measurably better than the alternatives. Scope decision: the complete product, not a minimum (ADR-024); requirements in [13-US-SCHOOL-READINESS.md](13-US-SCHOOL-READINESS.md).

| Slice | Weeks | User outcome | Catalog domains and docs |
|---|---|---|---|
| 9 Rostering and sign-in | 13–15 | OneRoster import and nightly sync; Clever and ClassLink SSO and roster read; Google and Microsoft sign-in; managed records; organisation configuration screen with dry run and sync report | 1, 2, 3, 5; docs/13 section 2 (ADR-025) |
| 10 School structure and attendance | 16–17 | Academic years, terms, grading periods, bell schedule, grade levels, school calendar with iCal; period attendance with district codes, daily deadline, state exports | 5, 6, 13; docs/13 sections 3 and 5 |
| 11 Gradebook and standards | 18–19 | Weighted categories, drop-lowest, extra credit, Assigned/Missing/Turned in/Returned marks, standards-based option, standards tagging from CASE, report cards and progress reports to PDF | 7, 8; docs/13 section 4 |
| 12 Support and safety | 20 | Accommodations from IEP and 504 plans applied in the product; counselor role with caseloads and private notes; wellness routing from tutor escalations; behaviour records; under-13 AI consent with parent opt-out | 3, 18, 27; docs/13 sections 6 and 10 |
| 13 Parents | 21–22 | Multi-child switcher, missing-work alerts, weekly digest, Spanish interface and externalised strings, family-language lesson summaries, conference talking points | 15, 11; docs/13 section 7 |
| 14 Motivation | 23 | Private XP, levels, streaks, badges, titles and class quests awarded from domain events; progress maps; no public rankings | 14 (minus leaderboards), docs/12 |
| 15 Teacher assistant | 24–25 | Lesson plans, essay grading with review and bulk approve, parent emails, progress narratives; class insight from tutor traces with practice sets; differentiation at three levels; substitute access; weekly planner | 19, 18; docs/13 section 8 |
| 16 Learning records and science | 26–27 | xAPI statements from every H5P result; spaced repetition on flashcards; mastery per topic; learning curves on dashboards; completion hooks award XP | 24, 25 |
| 17 Insight | 28–29 | Student, class and school analytics; principal dashboard (attendance today, missing work, failing students, gradebook completeness, AI usage); scheduled reports by email; PDF transcripts | 16; docs/13 section 9 |
| 18 Mobile and push | 30 | Mobile-optimised API, push notifications with Firebase when configured, offline-tolerant tutor transcript | 17, 11 |

Release 2 ends with a second security review, the first WCAG 2.2 AA conformance report and the signed data-privacy agreement template (docs/13 section 10).

---

## 5. Release 3: Platform and breadth (weeks 31 to 48)

Goal: districts, ecosystems and the long tail of the catalogue, built in full.

| Slice | Weeks | User outcome | Catalog domains |
|---|---|---|---|
| 19 Accessibility and compliance | 31–32 | Full WCAG 2.2 AA audit and fixes on every screen; data map, retention and deletion jobs, FERPA record export, breach-notification runbook; penetration test | 27, docs/13 section 10 |
| 20 District | 33–35 | District dashboard and cross-school reports, state reporting exports, district policy switches (AI per school, roles, retention), tenant hosting for districts that want one deployment for many schools with branding and domains (expand-migrate-contract adding `TenantId`, two-tenant isolation test) | 20 (as reports), 32 (tenancy) |
| 21 Integrations | 36–37 | LTI 1.3 tool and platform; Google Classroom and Canvas export; webhooks for IT; audit export; API keys for district integrations | 33, 32 (part) |
| 22 Library and content ecosystem | 38–40 | Digital library; content library with versions, collections, semantic search through the AI service; sharing within and across schools with moderation | 10, 30 |
| 23 Learning paths | 41–42 | Recommendations and learning paths from results, mastery and the tutor; integrated learning profile | 22, 29 |
| 24 Careers and portfolio | 43–44 | Portfolios, skills and endorsements, resumes to PDF, career and college readiness with the counselor; code lessons through the sandboxed evaluator (ADR-013); no stakes, no recruiting | 28, 34 (part) |
| 25 Community | 45–46 | Groups and forums with staff moderation tools, reporting and audit; class discussion threads | 31 |
| 26 Billing and operations | 47–48 | Subscriptions and invoices with idempotency keys, usage metering, security policies and incident records, status page | 32 (rest), 35 |

Excluded from every release (ADR-024): emotion detection, public leaderboards, stakes, recruiting. The old multi-agent hub (21) is replaced by the AI service design (ADR-021).

---
## 6. Working agreement for every slice

1. Start with the user outcome and the acceptance test written as a scenario.
2. Design the routes in docs/09 style before coding; update the OpenAPI examples.
3. Schema change as a Prisma migration; seed data updated in the same slice.
4. Service logic with unit tests; controller with an e2e test on `smartschooldb_test`; client pages with component tests and one Playwright journey.
5. AI features: fixture test without Ollama plus a nightly live test; output labelled with model and prompt version; 501 if the AI service cannot serve it (ADR-008).
6. Definition of done: acceptance scenario passes end to end in the client; lint, typecheck, tests and CI green; docs and OpenAPI updated; demo seed exercises the feature.

---

## 7. Quality gates in CI

Lint, typecheck, unit, e2e on `mariadb:10.4` and `mysql:8.0`, contract fixtures against the AI service, Playwright smoke on the client, `pnpm audit --audit-level=high`, secret scanning, migration drift check, Lighthouse budget on the client. Coverage floor 80 percent for `apps/api` from Release 1.

---

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Port 3306 clash with `MySQL800` | Certain | Section 2.1, day one |
| MariaDB and MySQL 8 diverge | High | Section 2.2; CI on both engines |
| Old repository unreachable | Medium | Schema authored by hand from docs/03 domain by domain; AI service rebuilt in Python from docs/04 contracts |
| Ollama latency and quality | High | Streaming for tutor; queue for generation; response cache; review gates on grading; `qwen2.5:14b` for quality-sensitive generation when hardware allows |
| Scope creep inside a release | High | Release contents are fixed in docs/08; anything new goes to the next release |
| Frontend and backend drift | Medium | OpenAPI-generated client; contract tests; slices always end in the client |
| Secrets | Medium | ADR-012; new credentials only |
| Code execution RCE | Medium | Sandbox or 501 (ADR-013) |
| XAMPP in production | Medium | Dev-only; Docker Compose in slice 8 |

---

## 9. Week 1 checklist

```powershell
# 1. Database (Administrator)
Stop-Service MySQL800; Set-Service MySQL800 -StartupType Disabled; Set-Service MySQL80 -StartupType Disabled
# edit C:\xampp\mysql\bin\my.ini per section 2.3, then:
C:\xampp\mysql_start.bat
# run the SQL in section 2.4 in phpMyAdmin

# 2. API (already scaffolded)
cd C:\Users\bishw\OneDrive\Desktop\SmartSchool\smartschool
pnpm install
copy apps\api\.env.example apps\api\.env      # DATABASE_URL password, JWT_SECRET, AI_CALLBACK_TOKEN
pnpm --filter @smartschool/api prisma:generate
pnpm --filter @smartschool/api prisma:migrate -- --name release1_slice1_identity
pnpm --filter @smartschool/api db:seed
pnpm --filter @smartschool/api dev            # http://localhost:5000/swagger

# 3. Web client (already scaffolded, proxies /api/* to the API)
copy appsweb.env.example appsweb.env      # API_URL=http://localhost:5000
pnpm dev:web                                  # http://localhost:3000 -> sign in as teacher@smartschool.local

# Demo accounts from db:seed (development only): superadmin@, superintendent@, principal@,
# teacher@, student@, parent@, assistant@smartschool.local, password SmartSchool!Demo2026

# 4. Old repository (needed from slice 5)
git clone <old-repo-url> C:\src\smartschool-previous
```

Deliverable at the end of week 2 (slice 1): a teacher and a student register and sign in through the web client against the XAMPP database; 2FA and password reset work; CI green.

---

## 10. Port and service map

| Service | Port | Started by |
|---|---|---|
| XAMPP Apache and phpMyAdmin | 80 | XAMPP control panel |
| XAMPP MariaDB | 3306 | XAMPP control panel |
| apps/api | 5000 | `pnpm dev` |
| apps/web | 3000 | `pnpm --filter @smartschool/web dev` |
| apps/ai | 8000 | `uvicorn main:app` |
| Ollama | 11434 | Ollama service |
| Redis (optional) | 6379 | Memurai or Docker |
