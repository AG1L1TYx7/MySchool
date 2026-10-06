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

## 11. Notifications and push

**Capabilities.** In-app notifications with read state, expiry, categories and per-category preferences; summary and unread count; bulk creation; device registration for FCM and APNS; push logs; cleanup of inactive devices; real-time delivery over `/hubs/notifications`.
**Entities.** `Notifications`, `NotificationPreferences`, `PushNotificationDevices`, `PushNotificationLogs`.
**Routes.** `/api/Notification` (9), `/api/PushNotification` (4). Jobs: delete-expired-notifications, push-notification-cleanup.
**Status.** Real for in-app; push is disabled until a Firebase key exists.

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

## 17. Mobile API

**Capabilities.** Compact dashboard, offline sync payload, paginated classes, assignments, grades and attendance for mobile clients; response compression.
**Routes.** `/api/v1/mobile` (6).
**Status.** Real.

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

## 25. Learning science

**Capabilities.** Spaced repetition with SM-2 (cards, batch creation from content, due queue, review with quality 0 to 5, preview, history, statistics, mastery, struggling and mastered lists); mastery levels per topic with prerequisite mapping; cognitive load metrics per session with break recommendations; learning curves with retention rate, trend and next review; AI card generation from content.
**Entities.** `SpacedRepetitionCards`, `ReviewSessions`, `MasteryLevels`, `CognitiveLoadMetrics`, `LearningCurves`.
**Routes.** `/api/v1/srs` (17), `/api/Mastery` (8), `/api/CognitiveLoad` (9), `/api/LearningCurve` (8).
**Status.** Real.

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

## 28. Career and college readiness

**Capabilities.** Career profile; interest inventory (Holland codes) and skill assessments with history and gap analysis; career matching and pathway recommendations; college applications; scholarships; industry trends; portfolio and recommendation letters; networking connections.
**Entities.** `CareerProfiles`, `InterestInventories`, `SkillAssessments`, `CollegeApplications`, `Scholarships`, `CareerPathways`, `IndustryTrends`, `Portfolios`, `Recommendations`, `NetworkConnections`.
**Routes.** `/api/v1/Career` (24).
**Status.** Partial. Career matching was a placeholder; target calls the AI service's recommendation and RAG endpoints.

## 29. Integrated learning profile

**Capabilities.** A holistic student view combining mastery, spaced repetition, cognitive load, SEL and accessibility into a learning health score with AI recommendations; cross-feature analytics.
**Routes.** `/api/v1/integrated` (29).
**Status.** Partial. Some insights were simulated and one metric was a constant; target computes from the underlying tables and calls the AI analytics endpoints.

## 30. Content library, collections and analytics

**Capabilities.** Content items (quiz, flashcards, lesson plan, video, worksheet and more) with subject, grade, topics, standards, keywords, visibility (Private, School, District, Public), versions, ratings, reviews, comments, bookmarks, tags, categories; AI generation and remixing; search, trending, featured, related, recommendations; collections with items and followers; creator profiles; embeddings for semantic search; usage events and effectiveness analytics; curated learning paths with enrolment and step progress.
**Entities.** the 20 `Content*` and `LearningPath*Curation` tables, `CreatorProfiles`.
**Routes.** `/api/ContentLibrary` (29), `/api/ContentCollections` (34), `/api/ContentAnalytics` (19).
**AI.** `/api/ai/search/semantic`, `/api/ai/embed/content`, `/api/ai/tag/auto`, generation endpoints.
**Status.** Real.

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

## 33. Organisation webhooks, IP whitelist and audit

**Capabilities.** Webhook subscriptions per organisation with event filters and secrets; event log; deliveries with retry and status; IP whitelist per organisation (middleware off by default); audit log query and export.
**Entities.** `WebhookSubscriptions`, `WebhookEvents`, `WebhookDeliveries`, `IPWhitelists`, `AuditLogs`.
**Routes.** `/api/v1/Webhooks` (14), `/api/v1/IPWhitelist` (5). Job: webhook-delivery-processor.
**Status.** Real.

## 34. Portfolio, skills, stakes, resume, code learning, recruiting

**Scope decision (ADR-024).** Portfolios, skills, resumes and sandboxed code learning are built in Release 3. Stakes (betting-style commitments) and recruiting (employer access to student data) are not built in any release.

**Capabilities.** Student portfolios with projects, media, members and peer reviews; skills with definitions, synonyms, badges and endorsements; public portfolio pages with custom URLs and subdomains; skill stakes (public commitments with accountability); resume generation to PDF from portfolio data; code lessons, challenges, progress, submissions and executions; recruiter profiles, job postings and candidate matching.
**Entities.** `StudentPortfolios`, `PortfolioProjects`, `ProjectMedia`, `ProjectMembers`, `PeerReviews`, `StudentSkills`, `SkillDefinitions`, `SkillSynonyms`, `SkillBadges`, `SkillEndorsements`, `SkillStakes`, `StudentResumes`, `PortfolioUrls`, `CodeLessons`, `CodeChallenges`, `LessonProgresses`, `CodeSubmissions`, `CodeExecutions`, `RecruiterProfiles`, `JobPostings`, `CandidateMatches`.
**Routes.** `/api/v1/portfolio` (20), `/api/PublicPortfolio` (7), `/api/Stakes` (9), `/api/Resume` (8), `/api/Code` (15), `/api/v1/recruiting` (12).
**AI.** `/api/ai/code/*`, `/api/ai/assessment/evaluate-code`.
**Status.** Partial. Stake assessment score was a constant (stub); code execution must move to a sandbox (ADR-013).

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
