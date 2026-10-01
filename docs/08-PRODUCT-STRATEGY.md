# SmartSchool Product Strategy: What Makes It Outstanding

**Version:** 1.0, 30 September 2026
**Purpose:** the standard every release is measured against, the competitors it is measured against, and the order in which value reaches users. Engineering decisions that follow from this are recorded in ADR-017 to ADR-020.

---

## 1. Positioning in one paragraph

SmartSchool is the K-12 platform that gives every student a private, always-available tutor and every teacher an assistant that drafts, grades and explains, without a single student record leaving the school's own hardware. It combines what schools today buy from four vendors (an LMS, an AI tutoring product, an interactive-content tool, and analytics) into one system with one login, one data model and no per-student AI fees.

---

## 2. Who we are measured against

| Competitor | What they do well | Where SmartSchool is different |
|---|---|---|
| Google Classroom | Free, simple, universal SSO, deep Workspace integration | Classroom has no gradebook depth, no AI tutor, no interactive content authoring, no learning science. We match its simplicity and add all four. Google SSO is table stakes and is in Release 2. |
| Canvas, Schoology, Blackboard | Mature LMS: gradebook, LTI ecosystem, SIS integration, mobile apps | Cloud-hosted, per-seat pricing, AI bolted on through partners that see student data. We are local-first with AI native to the data model. LTI 1.3 and OneRoster import (Release 3) let us coexist with them rather than demand a rip-and-replace. |
| Moodle | Open source, self-hostable, huge plugin ecosystem | Dated UX, no built-in AI, plugin quality varies. We keep self-hosting and open APIs, with a modern client and AI that is part of the core. |
| Khanmigo, Magic School AI, Brisk | Strong AI tutoring and teacher tools | They are AI layers over someone else's LMS and send prompts with student context to cloud models. Ours runs on Ollama on-premises and writes results back into the same gradebook, learning records and interventions. |
| H5P.com, Lumi | Best interactive content authoring | We generate H5P content from a topic with AI, store results as xAPI, and feed spaced repetition and gamification automatically. |
| DreamBox, Century Tech | Adaptive learning engines with research behind them | Narrow subject scope and closed content. Ours adapts across any teacher-authored or AI-generated content using mastery, spaced repetition and cognitive load signals, and shows its reasoning to the teacher. |

**Honest constraints.** Incumbents have a decade of content, integrations and district relationships. An 8B local model is weaker than a frontier cloud model for essay grading. We win on privacy, cost, integration depth between AI and the LMS, and speed of teacher workflows, not on raw model quality. Every AI output is labelled, reviewable and reversible.

---

## 3. The seven differentiators (each one is a design constraint)

1. **Private by architecture.** All inference on the school's Ollama. No student data to third parties except providers the school explicitly enables for email, SMS, push or billing. Exportable and deletable per student (FERPA, COPPA, GDPR).
2. **Honest AI.** No canned answers. Every AI feature calls the model or says it cannot. AI grades are suggestions that a teacher approves; the UI labels AI-generated content; confidence and sources are shown when available (ADR-008).
3. **AI that writes back.** A generated quiz becomes H5P content, becomes an assignment, produces xAPI statements, updates mastery, schedules spaced-repetition reviews, awards XP, and can trigger an intervention. One data model, no copy-paste between tools.
4. **Teacher time is the metric.** Draft a lesson plan, a quiz, a parent email or a progress narrative in under a minute; grade a class of essays with review in under ten. We measure and publish these times.
5. **Learning science built in, not bolted on.** SM-2 spaced repetition, mastery tracking, cognitive-load signals and SEL check-ins are core tables and jobs, visible on student and teacher dashboards, not a plugin.
6. **Accessible and inclusive by default.** IEP and accommodation data drive content adaptation (simplified text, chunking, screen-reader versions, extended explanations). The web client targets WCAG 2.2 AA.
7. **Open and operable.** Clean versioned REST API with OpenAPI, signed webhooks, API keys, LTI 1.3 and OneRoster (Release 3), health and metrics endpoints, one-command backup and restore.

---

## 4. Quality bar (non-negotiable per release)

| Area | Bar |
|---|---|
| API design | Consistent resource naming, RFC 9457 problem details for errors, cursor or page pagination with `meta`, idempotency keys on payment and bulk endpoints, OpenAPI generated from code and published |
| Performance | List endpoints p95 under 200 ms with 10,000 students seeded; tutor first token under 3 s and full answer under 15 s; quiz generation under 60 s; web client Lighthouse performance 90+ |
| Reliability | 99.5 percent availability target; AI outage degrades to a clear message, never an LMS outage; zero-downtime migrations (expand, migrate, contract) |
| Security | OWASP ASVS level 2 controls; argon2id; short-lived JWT with rotating refresh; 2FA; login throttling; audit trail on every state change; secrets only from the environment; dependency and secret scanning in CI; penetration test before Release 2 |
| Privacy | Per-student export and erase in under one minute; consent records for AI features involving minors; data retention jobs |
| Testing | Unit plus integration on every module; contract tests against the AI service; two-tenant isolation test from the day tenancy exists; coverage floor 80 percent for Release 1 |
| Accessibility | WCAG 2.2 AA for the web client; API exposes accommodations so any client can honour them |
| Observability | Structured logs with request, user and organisation ids; Prometheus metrics; health with dependency detail; per-request trace id returned in every error |
| Operability | `docker compose up` gives a full stack; one-command backup and restore; documented runbook; seed data for a demo school in under a minute |
| Documentation | Design set in `docs/`, OpenAPI at `/swagger`, a getting-started guide a teacher can follow |

---

## 5. Releases (ADR-018)

Every feature in the catalog ships. The order is chosen so that a school can run on Release 1, and each release is a complete product.

| Release | Theme | Contents | Done when |
|---|---|---|---|
| **1 Core** | A school can run on it | Identity and SSO-ready auth, organisations, roles and permissions, students and guardians, courses and modules, classes and enrolment, assignments and submissions, grades, attendance, announcements, files, notifications, messaging, AI tutor, AI-generated quizzes and flashcards as H5P, H5P player and results, minimal web client for teacher and student, demo seed, backup and restore | A pilot class runs a full unit: plan, assign AI-generated practice, students complete it, grades post, parents notified |
| **2 Depth** | It teaches better than the alternatives | Gamification, parent portal, calendar, analytics and PDF reports, teacher AI assistant (lesson plans, grading with review, communications), learning science (spaced repetition, mastery, cognitive load, learning curves), SEL, xAPI LRS with completion hooks, Google and Microsoft SSO, mobile-optimised endpoints, accessibility adaptations | Measured teacher-time savings and student engagement in the pilot |
| **3 Platform** | Districts and ecosystems | Multi-tenant SaaS (tenants, branding, plans, billing, compliance, tenant webhooks and reports), content library, collections and community, discussion forums, portfolio, careers and recruiting, integrated learning profile, agents and workflows with a control panel, LTI 1.3, OneRoster import, API keys and gateway, accessibility audits | A district onboards a second school without engineering involvement |

Inside each release, work is delivered as **vertical slices**: a user-visible outcome that cuts through API, data and client, with tests, in one to two weeks. Release 1's first slice is "a teacher logs in, creates a class, and a student sees it".

---

## 6. Success metrics we will actually measure

| Metric | Release 1 target |
|---|---|
| Time for a teacher to create a class and its first AI-generated assignment | under 5 minutes |
| Time to grade 25 essays with AI suggestions and review | under 10 minutes |
| Student tutor question to first answer token | under 3 s |
| Weekly active students in the pilot class | 90 percent |
| Setup on a fresh Windows laptop with XAMPP and Ollama | under 30 minutes following the guide |
| Full backup and restore | under 5 minutes |

## Addendum (1 October 2026): experience bar

Every screen follows the motion system and the gamified experience in [12-UX-MOTION-AND-GAMIFICATION.md](12-UX-MOTION-AND-GAMIFICATION.md): purposeful motion with reduced-motion support, skeleton loading, animated progress, earned rewards (XP, streaks, badges, quests, progress maps, opt-in class leaderboards), age-aware and never shaming. This is part of the quality bar, not a later polish pass.
