# SmartSchool Feature Catalog

**Version:** 1.2, 2 October 2026 (full-product scope and US exclusions, ADR-024)
**How to read:** one section per bounded context. Each states the purpose, the roles involved, the capabilities, the main workflows, the entities, the route bases (counts from the endpoint inventory), the AI dependencies, and an honest status of the previous implementation. **Real** means it exercised the database or the model; **Partial** means it worked with a named gap; **Stub** means hard-coded output that must not be ported (ADR-008). The target behaviour is stated wherever it differs.

Endpoint totals: 1,126 LMS routes in 77 controllers (19 in three test controllers are dropped), 155 AI service routes.

## Release assignment (ADR-018)

| Release | Domains |
|---|---|
| 1 Core | 1 Identity and access, 2 Organisation and permissions, 3 Students and guardians, 4 Curriculum, 5 Classes and enrolment, 6 Attendance, 7 Assignments and submissions, 8 Grades, 9 Announcements, 10 Files (library in Release 3), 11 Notifications, 12 Messaging, 18 AI tutor and AI content, 23 H5P (player, results, AI generation), 35 Platform health |
| 2 US school readiness and depth | 36 Rostering and sign-in (new), 5 and 6 with terms, periods and district attendance codes, 7 and 8 with categories, standards and report cards, 13 Calendar, 14 Gamification (private), 15 Parent portal with Spanish, 16 Analytics, 17 Mobile API, 19 Teacher AI assistant, 24 xAPI, 25 Learning science, 27 Accessibility adaptations, 37 Support and safety (new: accommodations, counselor, wellness routing, consent) |
| 3 Platform and breadth | 10 Digital library, 20 District management (reports, not an AI persona), 22 Recommendations and learning paths, 27 Accessibility audits, 28 Career and college readiness, 29 Integrated learning profile, 30 Content library and collections, 31 Community and forums with moderation, 32 Multi-tenant hosting and billing, 33 Webhooks and audit export, 34 Portfolio and skills (no stakes, no recruiting), plus LTI 1.3, Google Classroom and Canvas export |
| Not built | 26 Emotion detection and emotion-based SEL analytics; leaderboards from 14; stakes and recruiting from 34; 21 the old agent hub (replaced by docs/10). Reasons in [13-US-SCHOOL-READINESS.md](13-US-SCHOOL-READINESS.md) section 11 and ADR-024. |
Route paths in this catalog describe the previous implementation; the target routes follow [09-API-DESIGN.md](09-API-DESIGN.md).

---

## 1. Identity and access

**Purpose.** Accounts, sessions, second factor, and the audit trail behind every other feature.
**Roles.** Everyone authenticates; SuperAdmin and Superintendent manage security settings.
**Capabilities.** Email and password registration with optional reCAPTCHA; role assignment at registration and organisation linking (Admins table for Superintendent and Principal, AppUsers for the rest); login with 15-minute access tokens or 30-day remember-me tokens; refresh-token rotation and revocation; current-user profile; forgot and reset password by emailed token; TOTP two-factor enrolment, verification and backup codes; session listing and revocation; audit log query.
**Workflows.** Register → (optional) organisation link → login → refresh → revoke. Enable 2FA: request secret and QR → confirm code → receive backup codes.
**Entities.** `AspNetUsers` (+ `FirstName`, `LastName`, `Role`, `IsActive`, `RefreshToken`, `TwoFactorSecret`, `BackupCodes`), `AspNetRoles`, `AspNetUserTokens`, `AuditLogs`.
**Routes.** `/api/v1/Auth` (7), `/api/v2/Auth` (5, enhanced error envelope), `/api/v1/Security` (8).
**Status.** Real. The reset token is emailed and returned in the response only in development.

## 2. Organisation, feature permissions and flags

**Purpose.** The school-level container and the fine-grained permission system.
**Roles.** SuperAdmin administers features; Superintendent and Principal manage organisations.
**Capabilities.** Organisation CRUD with soft delete; a catalogue of about 200 feature codes across dashboard, users, students, courses, classes, assignments, grades, attendance, analytics, reports, messaging, announcements, notifications, gamification, SEL, AI (85 codes covering tutor, content, grading, assessment, plagiarism, learning paths, analytics, multimodal, images, RAG, accessibility, pedagogy, agents, superintendent, emotion), administration and parent portal; role-to-feature assignment and bulk assignment; per-user grants and revocations with reasons and expiry; a `/me/features` style read for the client; global feature flags that gate endpoints with a 404 when off.
**Entities.** `Organizations`, `Admins`, `AppUsers`, `Features`, `RoleFeatures`, `UserFeatureOverrides`, `FeatureFlags`.
**Routes.** `/api/v1/Organization` (5), `/api/admin/features` (7), `/api/admin/roles` (8), `/api/admin/users` (6), `/api/features` (3).
**Status.** Real. Seeded with default assignments per role.

## 3. Students and guardians

**Purpose.** The student record and its links to parents.
**Roles.** Principal and above create and edit; teachers view; students and parents view their own.
**Capabilities.** Student profile (name, contact, date of birth, gender, grade level, enrolment status and date, GPA, attendance rate, preferred learning style, accessibility needs, goals); unique student number; parent links with relationship, primary contact and notification preferences; bulk import and export; paginated search.
**Entities.** `Students`, `StudentParents`, `StudentProfiles` (AI-owned learning profile), `PerformanceRecords`.
**Routes.** `/api/Student` (6).
**Status.** Real.

## 4. Curriculum: courses, modules, lessons

**Purpose.** What is taught.
**Roles.** Teacher and above create; everyone enrolled reads.
**Capabilities.** Course catalogue with code, subject, grade level, credit hours, status (Draft, Active, Archived, UnderReview), instructor, publication and estimated hours; modules with ordering; lessons with content; prerequisites between courses; cloning and templates.
**Entities.** `Courses`, `Modules`, `Lessons`, `CoursePrerequisites`.
**Routes.** `/api/Course` (6).
**Status.** Real.

## 5. Classes and enrolment

**Purpose.** A course delivered to a group in a term.
**Roles.** Principal creates; teachers manage rosters; students are enrolled.
**Capabilities.** Class with section, term, dates, meeting times, room, capacity and status (Scheduled, InProgress, Completed, Cancelled); primary and co-teacher assignment; enrolment with status and current grade; roster and waitlist; schedule management.
**Entities.** `Classes`, `TeacherClassAssignments`, `ClassEnrollments`.
**Routes.** `/api/Class` (6).
**Status.** Real.

## 6. Attendance

**Purpose.** Daily presence per class.
**Capabilities.** Mark one or many students with the school's attendance codes (default P, T, AE, AU, R, FT, S; each code has a category and whether it counts as present) per period or for the day, with notes; the plain statuses (Present, Absent, Late, Excused, Tardy, LeftEarly) remain for schools without codes; edit; per-class and per-student summaries by date range; office status per day (classes meeting that day that have and have not taken attendance) with a daily deadline alert to principals and teachers; average daily attendance and chronic absenteeism CSV exports; pattern detection feeds analytics and parent notifications.
**Entities.** `Attendances`.
**Routes.** `/api/Attendance` (5). Job: daily-attendance-report.
**Status.** Real.

## 7. Assignments and submissions

**Purpose.** Work set and handed in.
**Capabilities.** Assignment types Homework, Quiz, Test, Project, Essay, Presentation, Lab, Discussion, Practice; submission types Online, Paper, InPerson, External, NoSubmission; points, category, dates, publication, rubric attachment, H5P content attachment; student submissions with attempts, files and text; grading with feedback; late policy; draft saving.
**Workflows.** Teacher creates → publishes → students submit → teacher (or AI-assisted) grades → grade posted event → notifications, XP, webhooks.
**Entities.** `Assignments`, `AssignmentSubmissions`, `Rubrics`, `GradingTasks`, `H5PContentAssignments`.
**Routes.** `/api/Assignment` (7).
**AI.** Essay and code grading suggestions through Teacher AI (section 19).
**Status.** Real.

## 8. Grades and gradebook

**Capabilities.** Grades per student and assignment with percentage, letter and comments; weighted categories per class with drop-lowest and extra credit; Google Classroom style marks (Assigned, Missing, Turned in, Returned, Excused, Late, Incomplete); district letter and GPA scales; standards-based grading per class with proficiency scales and a level per tagged standard; standards tagging on lessons and assignments from shared and district sets imported from 1EdTech CASE; report cards and progress reports per grading period with teacher comments, attendance, GPA, publication to students and parents and a PDF; class summary and distribution; export to CSV.
**Entities.** `Grades`, `GradeCategories`, `AssignmentMarks`, `StandardSets`, `Standards`, `AssignmentStandards`, `LessonStandards`, `ProficiencyScales`, `StandardScores`, `ReportCards`, `ReportCardLines`.
**Routes.** `/api/v1/classes/{id}/grading`, `/gradebook`, `/assignments/{id}/marks`, `/standards`, `/report-cards`, `/organizations/{id}/proficiency-scales`.
**Status.** Real.

## 9. Announcements

**Capabilities.** Organisation-wide or class announcements with type (General, Academic, Event, Emergency, Administrative, Social), priority (Low, Normal, High, Urgent), scheduling, publication and read tracking.
**Entities.** `Announcements`.
**Routes.** `/api/Announcement` (5).
**Status.** Real.

## 10. Files and digital library

**Purpose.** Uploads and a curated resource library.
**Capabilities.** Upload with size (10 MB) and extension limits, categories, organisation scoping, soft delete and scheduled purge; digital resources with type, category, access level, featured flag, class access grants, ratings, download and view counts, search.
**Entities.** `FileUploads`, `DigitalResources`, `ResourceClassAccess`, `ResourceRatings`.
**Routes.** `/api/File` (5), `/api/v1/library` (13).
**Status.** Real; storage is local disk.
**Release 3 (slice 22).** Library rebuilt as `LibraryItems` (kind h5p | document | link | lesson_plan; subject, grade, topics, standards, keywords; visibility private | school | district | public; status draft | pending_review | published | rejected | archived; version, featured, view, download and copy counts, rating sum and count, source item for copies, reviewer and note) with `LibraryItemVersions` (a snapshot per content change, restorable), `LibraryRatings` (one per person), `LibraryFlags` (reports with a resolution), `LibraryCollections`, `LibraryCollectionItems` and `LibraryCollectionFollowers`. Documents are existing uploads; `GET /library/items/{id}/download` serves the file to anyone who may see the item and counts it. Not rebuilt: class access grants and the featured flag as a separate list (featured is a field).

## 11. Notifications and push

**Capabilities.** In-app notifications with read state, expiry, categories and per-category preferences; summary and unread count; bulk creation; device registration for FCM and APNS; push logs; cleanup of inactive devices; real-time delivery over `/hubs/notifications`.
**Entities.** `Notifications`, `NotificationPreferences`, `PushNotificationDevices`, `PushNotificationLogs`.
**Routes.** `/api/Notification` (9), `/api/PushNotification` (4). Jobs: delete-expired-notifications, push-notification-cleanup.
**Status.** Real for in-app; push is disabled until a Firebase key exists.

**Release 2 (slice 18).** Push rebuilt on `PushDevices` and `PushLogs`: a phone or browser registers its Firebase token at `POST /me/devices` (the same token again is a check-in; a token that moves to another account follows the person who signed in last), lists and removes its devices, and can send itself a test. Every notification fan-out also pushes to the recipient's active devices when the category's in-app and push switches are on (`NotificationPreferences.push`, on by default, editable under Notifications > Preferences). Delivery uses the Firebase Cloud Messaging v1 API with a service-account JWT signed in process, so no Firebase SDK is needed; without `FIREBASE_SERVICE_ACCOUNT_JSON` every push is logged as simulated and the interface says so. Dead tokens are switched off on the first failure, silent devices after ninety days, logs are kept sixty. Administrators see device and delivery counts at `GET /organizations/{id}/push/status`. Not built: APNS direct, web push through a service worker in the web app.

## 12. Messaging (real-time)

**Capabilities.** Direct, group and class-group conversations; participants with roles, mute, leave; messages with replies, edits, deletes, read receipts, typing indicators; presence (online, away, busy, offline); file sharing through Files.
**Entities.** `Conversations`, `ConversationParticipants`, `Messages`, `MessageReadReceipts`.
**Routes.** `/api/Messaging` (29) plus the `/hubs/messaging` socket contract.
**Status.** Real.

## 13. Calendar

**Capabilities.** Events with attendees, recurrence, reminders, RSVP; user calendar settings; class and organisation calendars; conference scheduling.
**Entities.** `CalendarEvents`, `CalendarEventAttendees`, `UserCalendarSettings`.
**Routes.** `/api/Calendar` (25).
**Status.** Real since Release 2 slice 10 (reduced scope): school-wide and class events (day off, early release, school event, class event), published assignment due dates and term boundaries merged into one feed per user, and a private iCal subscription per user. Attendees, recurrence, RSVP and conference scheduling are not built; meeting links stay 501 until a provider adapter exists.

## 14. Gamification

**Scope decision (ADR-024).** No leaderboards or rankings visible to other students; progress is private to the student, their guardians and their teachers. Class quests show the class total, never individual positions.

**Capabilities.** Points and XP with levels and streaks; achievements with categories, rarity and unlock criteria; multi-level badges; titles with prestige and display colour; reward transactions ledger; automatic awards from domain events (grade posted, assignment completed, perfect score, path milestones).
**Entities.** `StudentPoints`, `RewardTransactions`, `Achievements`, `StudentAchievements`, `Badges`, `StudentBadges`, `Titles`, `StudentTitles`.
**Routes.** `/api/Gamification` (15).
**AI.** The Gamification agent in the AI service can propose quests and awards.
**Status.** Real; seeded catalogue.
**Release 2 (slice 14).** Rebuilt as private motivation on `StudentPoints`, `RewardTransactions`, `Badges`, `StudentBadges`, `LessonCompletions`, `Quests` and `QuestProgress` (titles derive from level): XP and levels, streaks with freeze tokens, sixteen badges (three teacher-awarded), personal weekly quests generated each Monday, class quests with a shared total, lesson completion with progress maps, a teacher console and the family view. No rankings anywhere (ADR-024); the AI quest proposer is deferred to the teacher-assistant slice.

## 15. Parent portal

**Capabilities.** Parent access grants per student with permissions; dashboard; student summaries, progress reports and per-course progress; AI-generated insights with read and dismiss; communication preferences.
**Entities.** `ParentAccesses`, `ParentInsights`, `ParentCommunicationPreferences`.
**Routes.** `/api/organizations/{organizationId}/ParentPortal` (20) and `/api/v1/organizations/{organizationId}/ParentPortal` (20).
**AI.** Insight generation calls the AI service.
**Status.** Real.
**Release 2 (slice 13).** Rebuilt as the family home: `/family/home` and `/family/digest`, a multi-child switcher, missing-work alerts each school day and a weekly digest email in the guardian's language, a Spanish interface (every family-facing string externalised in `apps/web/src/locales`), family-language lesson summaries (`LessonSummaries`, AI-drafted, teacher-released) and conference talking points for teachers (`ConferenceNotes`, AI-drafted from the student's own records). Staff-only screens stay English until the next language pass.

## 16. Analytics and reports

**Capabilities.** Student performance and engagement; class summary, grade distribution, at-risk list; organisation and teacher analytics; dashboard widgets; report definitions with schedules (daily, weekly, monthly) emailed with CSV or Excel attachments; PDF transcript, progress, attendance and roster reports; ETag caching on analytics.
**Entities.** `ClassAnalytics`, `TeacherInsights`, `DashboardWidgets`, `AnalyticsReports`, `ReportSchedules`.
**Routes.** `/api/v1/Analytics` (7), `/api/analytics/student` (2), `/api/analytics/class` (3), `/api/analytics/organization` (2), `/api/v1/reports` (5). Jobs: scheduled-reports-processor, warm-analytics-cache, analytics-aggregation.
**Status.** Real.

**Release 2 (slice 17).** Rebuilt as Insight, computed on request from the records the school keeps rather than from aggregate tables: the school overview for administrators and counselors (attendance taken today and the present rate, missing work in the last 14 days by grade level, students failing by class under 60%, gradebook completeness per class over 30 days, AI conversations, messages, refusals and capabilities over 7 days, sign-ins and activity by role), one picture per class (grade distribution in five bands, 30-day attendance, missing work, an alphabetical at-risk list with the reasons, assignment averages) and one per student (current grades, 90-day attendance, missing items, submissions and lessons per week for eight weeks, AI and practice counts). Seven report kinds download as CSV now or go out by email on a daily, weekly or monthly schedule (`ReportSchedules`, `ReportRuns`; recipients must be staff accounts at the school; an hourly job sends what is due; each run records whether a mail transport delivered it). A PDF transcript builds from published report cards with per-year and cumulative unweighted GPA. Not built: dashboard widgets, Excel attachments, analytics caching, credits on transcripts.

## 17. Mobile API

**Capabilities.** Compact dashboard, offline sync payload, paginated classes, assignments, grades and attendance for mobile clients; response compression.
**Routes.** `/api/v1/mobile` (6).
**Status.** Real.

**Release 2 (slice 18).** Rebuilt as six compact routes that compose the same services as the web, so permissions are identical and only the shapes are trimmed: `GET /mobile/home` (today's classes in period order, work split into overdue, due soon and recently graded, unread count, attendance still to take for teachers, XP and streak for students, children for families, three announcements), `GET /mobile/sync?since=` (classes, assignments, grades, announcements, notifications and tutor conversations changed since a cursor, with the next cursor set two seconds before now so nothing in flight is missed), `/mobile/classes`, `/mobile/assignments` (paged, sorted overdue first), `/mobile/grades`, `/mobile/attendance?days=`. Every response over a kilobyte is gzip-compressed. The tutor is offline-tolerant: a message carries a client id, a replay with the same id returns the stored answer instead of asking twice, and `GET /ai/tutor/conversations/{id}/messages?since=` fills in what a phone missed; the web client caches the transcript per conversation, queues messages written offline and replays them when the network returns.

## 18. AI tutor and AI content

**Purpose.** Student-facing tutoring and teacher-facing generation, proxied to the AI service.
**Capabilities.** Tutor chat (with conversation history), homework help, Socratic dialogue, concept explanation, similar examples, prerequisite checks, gap analysis, learning path generation and progress; structured quiz, flashcards, fill-in-blanks, video script, lesson plan, regenerate with feedback; conversion to H5P.
**Routes.** `/api/AI` (4), `/api/AIContent` (6). AI service: `/api/ai/tutor/*` (16), `/api/ai/generate/*` (16), `/api/ai/content/*` (4), `/api/ai/convert/h5p`.
**Status.** Real end to end when Ollama is running.

## 19. Teacher AI assistant

**Capabilities.** Teacher dashboard and usage stats; class analytics generation, history and comparison; AI insights with read and action-taken; lesson plan generation, edit, publish, regenerate; grading tasks: start, list, suggestions, review, bulk approve, cancel, complete; communication helpers: parent emails, progress-report narratives, bulk reports, conference talking points.
**Entities.** `LessonPlans`, `GradingTasks`, `TeacherInsights`, `ClassAnalytics`.
**Routes.** `/api/v1/teacher-ai` (29).
**AI.** `/api/ai/assessment/grade-essay`, `/api/ai/generate/content`, analytics endpoints.
**Status.** Real (grade suggestions call the model; unreadable submissions are flagged for manual review).
**Release 2 (slice 15).** Rebuilt as the teacher assistant: `LessonPlans`, `GradingSuggestions` (review, approve, bulk approve of confident ones), `TeacherDrafts` (parent emails sent as messages, narratives applied to draft report cards, three-level differentiation turned into unpublished lessons), `ClassInsights` (weekly numbers from tutor traces, work, scores and attendance, narrated, with a practice set), `SubstituteAccess` with an expiry, and the weekly planner. Six AI text capabilities ride the content job pipeline; prompts under `apps/ai/prompts`. Export to Google Classroom and Canvas and LTI 1.3 are the next slice.

## 20. Superintendent AI and district management

**Capabilities.** District chat, generated reports, insights, quick stats and chart data grounded in district data; schools with performance metrics; staff and job positions; budgets with categories, transactions and allocation history.
**Entities.** `Schools`, `SchoolPerformanceMetrics`, `StaffMembers`, `JobPositions`, `Budgets`, `BudgetCategories`, `BudgetTransactions`, `BudgetAllocationHistories`.
**Routes.** `/api/v1/superintendent/ai` (7), `/api/v1/district/schools` (7), `/api/v1/district/staff` (8), `/api/v1/district/budget` (9). AI service: `/api/superintendent/*` (5).
**Status.** Real.
**Release 3 (slice 20).** District management rebuilt on tenants (ADR-005): `GET /district/overview` puts every school of the district on one page (students, staff, attendance over 30 days and today, missing work, failing, gradebook completeness, AI conversations, open incidents) with student-weighted totals; `GET /district/reports/{schools|enrollment_by_grade|attendance_daily|ai_usage}.csv` are the cross-school reports; `GET /district/state-exports/{enrollment|attendance|discipline|grades}.csv` are student-level state reporting files in a state-neutral layout with each school's code (audited, district.manage). District policy switches live on the tenant (`GET/PUT /tenants/{id}/policies`): AI on or off for the district or for named schools (checked before consent), whether schools may allow student-to-student messaging, feature codes switched off district-wide (enforced in the access guard, platform administrator excepted), and retention defaults that apply where a school has not set its own. A superintendent reaches only the schools of their own tenant; the platform administrator may name a `tenantId`. Not rebuilt: district chat and generated narrative reports, staff and job positions, budgets (ADR-024).

## 21. AI agents

**Purpose.** Autonomous agents that watch learning signals and act.
**Capabilities.** Six agents (ContentCreator, LearningPath, Tutor, Assessment, SELMonitor, Gamification) plus ImageCreator; registry and status; message bus with request-response, broadcast and chaining; six predefined workflows (content generation, personalised learning, student intervention, assessment and feedback, daily engagement, batch content); real-time subscription to agent events, message types and workflows over `/hubs/agents`; guardrails and agent memory.
**Routes.** LMS `/api/Agent` (34) and `/hubs/agents`; AI service `/api/agents/*` (10).
**Status.** Partial. The Python runtime is real; the previous C# runtime duplicated it. Target: the AI service owns the agent runtime and the LMS is a client and event relay (ADR-009).

## 22. Content recommendations and learning paths (AI data)

**Capabilities.** Learner profiles, performance records, personalised learning paths with steps linked to H5P content, content recommendations, assessment results, intervention plans and actions; nightly recommendation refresh.
**Entities.** `StudentProfiles`, `PerformanceRecords`, `LearningPaths`, `LearningPathSteps`, `ContentRecommendations`, `AssessmentResults`, `InterventionPlans`, `InterventionActions` (written by the AI service, read by the LMS).
**Routes.** `/api/ContentRecommendations` (22). AI service: `/api/ai/profile/*`, `/api/ai/predict/*`, `/api/ai/analytics/*`, `/api/ai/path/*`, `/api/ai/personalize/*`, `/api/ai/recommend/*`.
**Status.** Real.
**Release 3 (slice 23).** Learning paths rebuilt on `LearningPaths` and `LearningPathSteps` (kind lesson | h5p | library | practice | assignment | tutor, order, reason, standard, status pending | in_progress | done | skipped, evidence). `POST /students/{id}/learning/paths/generate` builds a path from the student's weakest standards (below 60% with evidence) and the content that teaches them: published lessons of their courses carrying the standard, the lesson's activity, and library items naming the code; then a practice step per standard. Teachers also build paths by hand, add, reorder, retitle and remove steps; students tick steps done or skipped; lesson completions, passing activity results, submissions, grades and practice sessions finish matching steps on their own; a path completes when nothing is left. Recommendations (`GET /me/learning/profile`) are ranked without a model: missing work first, then content for the weakest gaps (or the tutor when nothing teaches the standard yet), due practice, the next lesson. Not rebuilt: the AI service's profile, prediction and personalisation endpoints, intervention plans (the counselor caseload covers interventions).

## 23. H5P interactive content

**Capabilities.** Content CRUD with slug, library version, parameters JSON, publication and history; library catalogue (21 types mapped: MultiChoice, TrueFalse, Blanks, DragQuestion, Flashcards, DialogCards, MemoryGame, Accordion, InteractiveVideo, CoursePresentation, Timeline, ImageHotspots, Essay, MarkTheWords, Summary, BranchingScenario, DocumentationTool, QuestionSet, SingleChoiceSet, InteractiveBook, AudioRecorder); upload, compatibility check; results per content and user; files; validation; fifteen server-side parameter generators; AI-generated H5P through the AI service with three callback endpoints.
**Entities.** `H5PContents`, `H5PLibraries`, `H5PContentResults`, `H5PFiles`, `H5PContentAssignments`, `H5PContentHistory`.
**Routes.** `/api/H5P` (36), `/api/h5p/content-types` (23), `/api/ai/h5p` (10). Dropped test routes: `/api/test/h5p` (6).
**Status.** Real. The player and editor are web-client concerns.

## 24. xAPI learning record store and H5P bridge

**Capabilities.** xAPI 1.0.3 statement storage and query (actor, verb, object, result, context, voiding); statement generation from H5P results (experienced, attempted, answered, completed, passed, failed, interacted; scaled score; ISO-8601 duration); learning analytics per content (completion, pass rate, time) and per user; activity timelines; bulk sync.
**Entities.** `xapi_statements`.
**Routes.** `/api/XAPI` (20), `/api/H5PxAPI` (17). Dropped: `/api/test/h5p-xapi` (11), `/api/test/h5p-auto-xapi` (2).
**Status.** Partial. Statements and analytics were real; the automatic hooks from completion to XP, spaced repetition and cognitive load were never wired and are scheduled in Phase 5.

**Release 2 (slice 16).** Rebuilt on `XapiStatements`: every H5P result, lesson completion, assignment submission, posted grade and practice review becomes an xAPI 1.0.3 statement (actor account on the school, verb IRI, object IRI, scaled score, success, completion, ISO-8601 duration, class and assignment context, registration). Query at `GET /xapi/statements` (own school; staff and counselors), a student timeline at `GET /students/{id}/learning/records`, per-content analytics at `GET /h5p/contents/{id}/analytics`, and a resumable full export for an external record store at `GET /organizations/{id}/xapi/export?since=` (administrators, audited). Statements are written by a listener after the action, so a failure never blocks the student. Voiding and external statement ingestion are not built.

## 25. Learning science

**Capabilities.** Spaced repetition with SM-2 (cards, batch creation from content, due queue, review with quality 0 to 5, preview, history, statistics, mastery, struggling and mastered lists); mastery levels per topic with prerequisite mapping; cognitive load metrics per session with break recommendations; learning curves with retention rate, trend and next review; AI card generation from content.
**Entities.** `SpacedRepetitionCards`, `ReviewSessions`, `MasteryLevels`, `CognitiveLoadMetrics`, `LearningCurves`.
**Routes.** `/api/v1/srs` (17), `/api/Mastery` (8), `/api/CognitiveLoad` (9), `/api/LearningCurve` (8).
**Status.** Real.

**Release 2 (slice 16).** Rebuilt as `SrsCards`, `SrsReviews` and `MasteryLevels`: SM-2 practice cards (own cards, or every card of a published Dialogcards set once), a due-then-new queue, reviews rated 0 to 5 with the next interval and easiness stored per review, pause and delete, statistics (mastered at interval 21 days and three repetitions, struggling at three lapses or easiness 1.5, retention over 30 days, practice days); mastery per standard recomputed from the evidence the school already holds (grades and standard scores weight 1, H5P practice 0.6, lesson completion 0.3, half-life 30 days, trend from the last two pieces against the rest; bands advanced, proficient, developing, beginning); learning curves per student and per class (weekly average scaled score and practice recall over twelve weeks). Ten reviews in a day and any completed H5P result award practice XP. Cognitive-load metrics, prerequisite mapping and AI card generation are not built.

## 26. Social-emotional learning and emotion detection

**Scope decision (ADR-024): not built.** Emotion detection from faces, voice or text, and emotion-based analytics, are excluded from every release. Student wellbeing is served by the tutor's safety escalation routed to the counselor (docs/13 section 6). SEL goals and journals are deferred until a pilot school asks for them. The description below is kept as the record of the previous implementation.

**Capabilities.** Emotion logs, mental-health check-ins, SEL goals with progress, self-assessments with growth analysis, coping strategies with usage and recommendations, empathy scenarios, reflection journals; counsellor alerts; AI emotion detection from images with GDPR and COPPA consent (facial and voice flags, parental consent, retention days, revoke), sessions with summaries, interventions, history and deletion.
**Entities.** `EmotionLogs`, `MentalHealthCheckIns`, `SELGoals`, `SelfAssessments`, `EmotionRegulationStrategies`, `EmpathyScenarios`, `ReflectionJournals`; AI-owned `EmotionConsents`, `EmotionReadings`, `EmotionSessions`, `EmotionInterventions`.
**Routes.** `/api/v1/sel` (26). AI service: `/api/ai/emotion/*` (9).
**Status.** Real for SEL; emotion detection is real only when DeepFace is installed, and voice analysis is a placeholder (501 in the target).

## 27. Accessibility and inclusion

**Capabilities.** Accessibility profiles; IEPs with accommodations, goals and progress; UDL profiles; assistive technology registry; accessibility audits; inclusion metrics; AI text simplification, chunking, extended explanations, screen-reader text and multimodal alternatives.
**Entities.** `AccessibilityProfiles`, `IEPs`, `Accommodations`, `UDLProfiles`, `AssistiveTechnologies`, `AccessibilityAudits`, `InclusionMetrics`.
**Routes.** `/api/v1/accessibility` (30). AI service: `/api/ai/accessibility/*` (5).
**Status.** Partial. The audit used a simulated checker (stub); target runs a real accessibility scan of stored content or returns 501.

**Release 3 (slice 19).** The accessibility audit is now real and covers the product itself rather than stored content: axe-core against every screen as every role at desktop and phone width, the reflow and 200% text-zoom checks, and a manual pass on the WCAG 2.2 criteria axe cannot judge, written up as the accessibility conformance report in docs/19 and repeated every slice. The interface gained a skip link and a focusable main landmark. Student accommodations (extended time, read aloud, large text, reduced motion, reduced distraction) shipped in slice 12. Not built: an accessibility scan of stored H5P or uploaded content, UDL profiles, an assistive-technology registry, inclusion metrics, and the AI simplification and alternative-format features; they stay in the catalogue for the content-library slice.

## 28. Career and college readiness

**Capabilities.** Career profile; interest inventory (Holland codes) and skill assessments with history and gap analysis; career matching and pathway recommendations; college applications; scholarships; industry trends; portfolio and recommendation letters; networking connections.
**Entities.** `CareerProfiles`, `InterestInventories`, `SkillAssessments`, `CollegeApplications`, `Scholarships`, `CareerPathways`, `IndustryTrends`, `Portfolios`, `Recommendations`, `NetworkConnections`.
**Routes.** `/api/v1/Career` (24).
**Status.** Partial. Career matching was a placeholder; target calls the AI service's recommendation and RAG endpoints.
**Release 3 (slice 24).** Career and college readiness rebuilt on `CareerProfiles`, worked on with the counselor: an eighteen-statement interest inventory scored into Holland codes (RIASEC) with the top three matched to the sixteen national career clusters by a documented weighting (no model, no placeholder); goals; up to six pathways to explore; a college and training list with a status per entry; and a readiness checklist whose items appear by grade (interests and skills from grade 6, a project from 7, pathways from 8, the four-year plan and an activity from 9, the college list and test plan from 10, the resume and recommenders from 11, FAFSA, applications and the decision from 12), with student items the student ticks and counselor items the counselor ticks, some ticked on their own (inventory taken, pathways chosen, list started, resume generated). Routes `GET/PATCH /students/{id}/career`, `POST /me/career/inventory`, `POST /students/{id}/career/checklist`, `GET /career/inventory`, `GET /career/clusters`. Not rebuilt: scholarships, industry trends, networking, recommendation letters (counselor notes and the conference notes cover the conversation).

## 29. Integrated learning profile

**Capabilities.** A holistic student view combining mastery, spaced repetition, cognitive load, SEL and accessibility into a learning health score with AI recommendations; cross-feature analytics.
**Routes.** `/api/v1/integrated` (29).
**Status.** Partial. Some insights were simulated and one metric was a constant; target computes from the underlying tables and calls the AI analytics endpoints.
**Release 3 (slice 23).** Rebuilt as the integrated learning profile at `GET /me/learning/profile` and `GET /students/{id}/learning/profile`: a learning health score out of 100 from five weighted parts (mastery 35%, attendance 20%, work 25%, practice 10%, engagement 10%), each with its score and a sentence saying what it counted; parts without evidence score a neutral 60 and say so, so nobody is "thriving" or "needs support" by accident. Around it: mastery summary, attendance, missing and late work, failing classes, practice due and reviews, AI conversations, risk flags, gaps, ranked next steps and active paths. Nothing is simulated; every number comes from the tables the other slices fill. Not rebuilt: SEL, cognitive load and accessibility signals inside the score (wellness stays with the counselor caseload).

## 30. Content library, collections and analytics

**Capabilities.** Content items (quiz, flashcards, lesson plan, video, worksheet and more) with subject, grade, topics, standards, keywords, visibility (Private, School, District, Public), versions, ratings, reviews, comments, bookmarks, tags, categories; AI generation and remixing; search, trending, featured, related, recommendations; collections with items and followers; creator profiles; embeddings for semantic search; usage events and effectiveness analytics; curated learning paths with enrolment and step progress.
**Entities.** the 20 `Content*` and `LearningPath*Curation` tables, `CreatorProfiles`.
**Routes.** `/api/ContentLibrary` (29), `/api/ContentCollections` (34), `/api/ContentAnalytics` (19).
**AI.** `/api/ai/search/semantic`, `/api/ai/embed/content`, `/api/ai/tag/auto`, generation endpoints.
**Status.** Real.
**Release 3 (slice 22).** The content library is the same `/library` catalogue (section 10): visibility and review (`library-rules.ts`: school items publish at once, district items need a school administrator, public items a district role; lowering reach never needs review; creators and school administrators always see their items), versions on every content change with restore, ratings, reports with a moderation queue (`GET /library/moderation`, approve or reject, dismiss or take down), copies into another school (interactive content is duplicated through the H5P service, documents and links point at the same source; the original counts the copy), collections with followers, and semantic search: published items are embedded through the AI service (`/v1/rag/index`) in a per-district namespace and, when public, a shared one; `GET /library/items/search` merges the nearest matches with keyword matches and says whether the AI service answered. Not rebuilt: comments, creator profiles, trending and effectiveness analytics, curated learning paths (slice 23).

## 31. Community and forums

**Capabilities.** Follow and unfollow, followers and suggestions; content sharing with recipients; reactions; activity feed and user activities; public profiles; groups with members and roles; community notifications; discussion forums with topics, posts, subscriptions, votes, moderators and reports.
**Entities.** `UserFollows`, `ContentShares`, `ContentShareRecipients`, `ContentReactions`, `UserActivities`, `UserPublicProfiles`, `CommunityGroups`, `CommunityGroupMembers`, `CommunityNotifications`, `DiscussionForums`, `DiscussionTopics`, `DiscussionPosts`, `ForumSubscriptions`, `TopicSubscriptions`, `TopicVotes`, `PostVotes`, `ForumModerators`, `PostReports`.
**Routes.** `/api/Community` (70).
**Status.** Real.

## 32. Multi-tenant SaaS platform

**Capabilities.** Tenants with status lifecycle, subdomain and custom domains with verification, branding (logo, favicon, colours, custom CSS, email templates), feature configuration, settings, tenant admins; subscription plans and subscriptions; usage records, API calls, API keys with scopes and rate limits; billing records and invoices (Stripe); platform admin dashboard, growth and revenue analytics, top tenants, export (JSON, CSV, package) and import with validation, health, resources, alerts and performance; tenant security policies and incidents, password history; compliance settings, user consents, data-subject requests; tenant webhooks with deliveries, event logs and subscriptions; notification templates, channels, logs, preferences and in-app notifications; dashboard widgets, reports, templates, scheduled reports and metrics; an internal API gateway with service aggregation and a BFF endpoint.
**Entities.** the 40 `Tenant*` tables and `SubscriptionPlans`.
**Routes.** `/api/Tenant` (45), `/api/TenantAdmin` (18), `/api/tenant/analytics` (16), `/api/tenant/billing` (20), `/api/tenant-security` (13), `/api/tenant-compliance` (39), `/api/TenantWebhook` (29), `/api/tenant/reports` (30), `/api/ApiGateway` (12).
**Status.** Partial. Structure and CRUD were real; billing usage metrics returned zeros and Stripe is disabled without keys.
**Release 3 (slice 20).** Tenancy rebuilt as `Tenants` (name, slug, status active | trial | suspended, custom domain with a DNS TXT verification record, branding, policies) with `Organizations.TenantId` added by an expand-migrate-contract migration that attached every existing school to the default tenant. `GET /branding` (public, by host or `?tenant=slug`) names and colours the sign-in page; `GET/POST /tenants`, `PATCH /tenants/{id}`, `POST /tenants/{id}/domain/verify` are platform-administrator routes (`tenants.manage`); a superintendent may read and rename their own tenant. Tokens carry `tenantId` and, for superintendents, the ids of the tenant's schools; organisation scoping, lists and every id-based route stop at the tenant boundary (two-tenant isolation test in `test/district.e2e-spec.ts` and a probe in the security spec). Not rebuilt: billing, Stripe, usage metering.
**Release 3 (slice 21).** API keys for district integrations on `ApiKeys`: created by an administrator with a name, read-only scopes (students, classes, courses, assignments, grades, attendance, calendar, standards, reports, audit log, school, district), a budget of requests per minute and an optional expiry; the key (`ssk_<prefix>_<secret>`) is shown once and only its hash is stored. Presented as `X-Api-Key`, a key runs as the administrator who created it, confined to that school and to its scopes (`apikey.scope` 403 elsewhere), stops when revoked, expired or when that administrator is deactivated, answers 429 `rate_limited` over budget, and is redacted from logs. Also LTI 1.3 (section 8 note below).

## 33. Organisation webhooks, IP whitelist and audit

**Capabilities.** Webhook subscriptions per organisation with event filters and secrets; event log; deliveries with retry and status; IP whitelist per organisation (middleware off by default); audit log query and export.
**Entities.** `WebhookSubscriptions`, `WebhookEvents`, `WebhookDeliveries`, `IPWhitelists`, `AuditLogs`.
**Routes.** `/api/v1/Webhooks` (14), `/api/v1/IPWhitelist` (5). Job: webhook-delivery-processor.
**Status.** Real.
**Release 3 (slice 21).** Webhooks rebuilt on `WebhookSubscriptions` and `WebhookDeliveries`: a school registers https endpoints with an event filter (exact types or a prefix such as `assignment.`), the secret is shown once, every domain event becomes one pending delivery per matching subscription, a pass every minute posts the rows that are due with `X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Timestamp` and `X-Webhook-Signature` (sha256 HMAC of `timestamp.body`), failures retry after 1, 2, 4, 8 and 16 minutes up to the retry limit, twenty dead deliveries in a row pause the subscription, and administrators see the delivery history, send a test event and rotate the secret (`/organizations/{id}/webhooks`). Audit export: `GET /audit-logs/export.csv` with the list filters (district roles; the export is itself audited). Not rebuilt: IP whitelist.
**LTI 1.3 and exports (slice 21).** SmartSchool is an LTI 1.3 tool (`LtiPlatforms`, `LtiUserLinks`, `LtiKeys`): a platform such as Canvas or Schoology is registered with its issuer, client id, authorization and JWKS URLs; `GET /lti/config.json` gives the tool configuration, `GET /lti/jwks` our key set, `GET|POST /lti/login` the OIDC initiation (state in an HttpOnly cookie, nonce in the state) and `POST /lti/launch` verifies the RS256 id_token against the platform's JWKS, checks issuer, audience, expiry, nonce (one use), message type, version and deployment, links the subject to the person (by email in that school, or creates the account and, for learners, the student record), opens a session and lands on the target path. SmartSchool is also an LTI 1.3 platform (`LtiTools`): an administrator registers a tool and hands it our issuer, authorization URL, JWKS, client id and deployment id; teachers and students open tools from a class page and `GET|POST /lti/platform/auth` answers the tool's request with a signed id_token carrying the person, roles, the class as context and custom parameters. Exports: `GET /classes/{id}/exports/canvas-gradebook.csv` (Canvas import layout with the Points Possible row), `GET /classes/{id}/exports/google-classroom.csv` (Classroom grade sheet) and `GET /classes/{id}/exports/common-cartridge.imscc` (IMS Common Cartridge 1.3 of the published assignments), each audited. Not built: Assignment and Grade Services, Names and Roles, Deep Linking, direct Google Classroom API sync.

## 34. Portfolio, skills, stakes, resume, code learning, recruiting

**Scope decision (ADR-024).** Portfolios, skills, resumes and sandboxed code learning are built in Release 3. Stakes (betting-style commitments) and recruiting (employer access to student data) are not built in any release.

**Capabilities.** Student portfolios with projects, media, members and peer reviews; skills with definitions, synonyms, badges and endorsements; public portfolio pages with custom URLs and subdomains; skill stakes (public commitments with accountability); resume generation to PDF from portfolio data; code lessons, challenges, progress, submissions and executions; recruiter profiles, job postings and candidate matching.
**Entities.** `StudentPortfolios`, `PortfolioProjects`, `ProjectMedia`, `ProjectMembers`, `PeerReviews`, `StudentSkills`, `SkillDefinitions`, `SkillSynonyms`, `SkillBadges`, `SkillEndorsements`, `SkillStakes`, `StudentResumes`, `PortfolioUrls`, `CodeLessons`, `CodeChallenges`, `LessonProgresses`, `CodeSubmissions`, `CodeExecutions`, `RecruiterProfiles`, `JobPostings`, `CandidateMatches`.
**Routes.** `/api/v1/portfolio` (20), `/api/PublicPortfolio` (7), `/api/Stakes` (9), `/api/Resume` (8), `/api/Code` (15), `/api/v1/recruiting` (12).
**AI.** `/api/ai/code/*`, `/api/ai/assessment/evaluate-code`.
**Status.** Partial. Stake assessment score was a constant (stub); code execution must move to a sandbox (ADR-013).
**Release 3 (slice 24).** Portfolios rebuilt on `Portfolios`, `PortfolioProjects`, `PortfolioMedia` and `PortfolioReviews`: one portfolio per student with a headline, an about and a visibility (private | family | school | public, where family and teachers always see it and a public address `/p/<slug>` shows published projects and skills only, never grades); projects of a kind (project, writing, art, code, science, service, other) with a summary, description, skills shown, reflection, link, date, files from the student's own uploads and a school submission as evidence; feedback from teachers, counselors and classmates (one per person, the owner may hide it). Skills on `Skills` (a platform catalogue of eighteen plus school additions), `StudentSkills` (level emerging | developing | proficient | advanced with a note) and `SkillEndorsements` (teachers, counselors, administrators and classmates, once each; never the owner or a parent). Resume: `GET /students/{id}/resume` and `resume.pdf` assemble the profile, education, published report-card courses, published projects, skills with endorsement counts, badges and chosen pathways (pdfkit; audited). Code learning on `CodeLessons` (six platform lessons plus school ones) and `CodeSubmissions`: the student's JavaScript runs in the ADR-013 isolate (a worker thread with a memory cap, a V8 context with no prototype and nothing from the host realm, no require, process, fetch or timers, code generation from strings off, terminated at the time limit) and each test expression is compared with its expected JSON value; attempts are recorded with the best result per lesson. Not built, by decision (ADR-024): stakes and recruiting.

## 36. Rostering and sign-in (new, Release 2)

**Purpose.** People and classes enter SmartSchool from the systems the school already runs. **Capabilities.** OneRoster 1.1 CSV and API import with nightly sync; Clever Instant Login and roster read; ClassLink OneRoster and LaunchPad SSO; Google and Microsoft OpenID Connect sign-in; managed records with `externalId`, `source` and `managedBySis`; organisation configuration with dry run and sync reports. **Entities.** `RosterSources`, `RosterSyncRuns`, `RosterSyncErrors`, external-id columns on users, students, guardians, classes and enrolments. **Status.** New; see [13-US-SCHOOL-READINESS.md](13-US-SCHOOL-READINESS.md) section 2.

## 37. Support and safety (new, Release 2)

**Purpose.** Accommodations, counseling and consent. **Capabilities.** IEP and 504 accommodations applied in the product (extended time on due dates, read-aloud, larger text, reduced motion, reduced distraction); counselor role with caseloads and private notes; wellness queue fed by tutor escalations with counselor and principal notification; behaviour records with a school-level family-visibility rule and per-record override; under-13 AI consent with a school default and parent opt-out; student-to-student messaging as a school switch. **Entities.** `Accommodations`, `CounselorCaseloads`, `CounselorNotes`, `WellnessAlerts`, `BehaviorRecords`, `AiConsents`. **Status.** Real since Release 2 slice 12; see docs/13 sections 6 and 10.

## 35. Platform health

**Capabilities.** Basic and detailed health (database, AI service, Redis, circuit breakers), liveness and readiness, Swagger per version, Prometheus metrics.
**Routes.** `/health`, `/health/live`, `/health/ready`, `/api/Health`, `/swagger`, `/metrics`. AI service: `/health`, `/health/live`, `/health/ready`, `/metrics`, `/api/ai/metrics`.
**Status.** Real; implemented in Phase 0 of the rebuild.

---

## AI service capabilities not wrapped by the LMS

These 155 routes exist; the previous LMS called about 30 of them. The rest are reachable directly or through future LMS features: adaptive and differentiated generation, drag-and-drop, matching, timeline, case study, project-based, diagram labeling, vocabulary units, SEL content, spaced review; rubric creation, formative assessment, peer review, citation validation, improvement suggestions, math grading; plagiarism batch and reports; code syntax check and test runs; multimodal image analysis, math extraction, worksheet analysis, audio transcription, curriculum alignment, diagrams, infographics, charts; image generation (educational, H5P-ready), editing, background removal and replacement, transforms, variations; knowledge graph concepts; translation; auto-tagging; batch generation status; cache management; prompt catalogue.

---

## Role and feature matrix (defaults)

| Area | SuperAdmin | Superintendent | Principal | Teacher | Student | Parent |
|---|---|---|---|---|---|---|
| Dashboard | all | all | view | view, analytics | view | parent dashboard |
| Users and students | all | manage | view | view, documents, reports | own profile | own children |
| Courses and classes | all | manage | view | manage own, enrol, schedule | view enrolled | view |
| Assignments and grades | all | approve | view | create, grade, rubric | submit, view own | view child |
| Attendance | all | reports | view | mark, edit, report | view own | view child |
| Communication | all | all | announcements | messages, announcements | messages | messages |
| Analytics and reports | all | all | view | class analytics | own progress | child progress |
| AI tutor and content | all | all | view | tutor, content, grading, adaptive quiz, Socratic | tutor, homework help | insights |
| Gamification | all | manage | view | award points | view | view |
| SEL and wellness | all | all | dashboard | dashboard, check-ins | check-ins | child SEL |
| Administration | all | settings, audit, integrations, tenants | none | none | none | none |

The exact codes and assignments are seeded by `apps/api/prisma/seed.ts` from Phase 1 onward and are the source of truth; this table summarises them.
