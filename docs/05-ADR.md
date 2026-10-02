# Architecture Decision Records

Format: context, decision, consequences. Status is Accepted unless stated. Dates are when the decision was recorded.

---

## ADR-001: Keep the Python AI service

**Date:** 2026-09-30
**Context.** The Python service (155 routes, ~40k lines) is the only part of the previous system whose AI features were verified to call the model. Its dependencies (Ollama client, ChromaDB, sentence-transformers, DeepFace, diffusers, tesseract) are mature in Python and immature or absent in Node.js, especially image generation.
**Decision.** The AI service stays in Python (`apps/ai`, restored from the old repository) and is treated as a product component with its own roadmap. The LMS talks to it over HTTP through one typed client.
**Consequences.** Two languages in the repository; a contract that must be tested; no duplication of AI logic in the LMS.

## ADR-002: Rebuild the LMS API in Node.js with NestJS

**Date:** 2026-09-30
**Decision.** NestJS 11 on Node 22+, TypeScript strict, in `apps/api`. Its modules, guards, interceptors, pipes, gateways, scheduler and Swagger give a disciplined structure for a large API.
**Consequences.** A framework dependency; Express under the hood.

## ADR-003: Prisma as the ORM; database table names kept compatible with the AI service

**Date:** 2026-09-30, amended by ADR-020
**Context.** The AI service depends on 12 tables by name and column. The rest of the previous schema was PascalCase.
**Decision.** Prisma 6. The 12 AI-owned tables keep their exact names and columns. All other tables also use PascalCase names and columns so the database has one convention; Prisma fields are camelCase via `@map` so application code is idiomatic (ADR-020). The Prisma schema is the source of truth; migrations are engine-portable.
**Consequences.** No data migration for the AI service; typed queries; the schema is reviewable in git. Soft delete and organisation scoping are Prisma client extensions.

## ADR-004: XAMPP MariaDB for development, MySQL 8 or MariaDB 10.11 for production

**Date:** 2026-09-30
**Decision.** Develop on XAMPP MariaDB 10.4; deploy on MySQL 8 or MariaDB 10.11 LTS. CI runs on both engines. No engine-specific SQL outside analytics.
**Consequences.** Port 3306 must be taken from the existing MySQL 8 service on the development machine. Collation is `utf8mb4_unicode_ci`. JSON-path indexes are ruled out. MariaDB 10.4 is end-of-life and is never a production target.

## ADR-005: Shared-database multi-tenancy with a TenantId column

**Date:** carried from the previous Phase 12, recorded 2026-09-30, timing amended by ADR-019
**Decision.** One database; tenant-scoped tables carry `TenantId`; a request-scoped tenant context is set by middleware and enforced in data access; tenant status is checked at the edge.
**Consequences.** Isolation depends on code discipline, so an automated two-tenant isolation test is mandatory from the day tenancy exists.

## ADR-006: Socket.IO for real-time with the documented event names

**Date:** 2026-09-30
**Decision.** Socket.IO namespaces `/hubs/notifications`, `/hubs/messaging`, `/hubs/agents`, `/hubs/collaboration` with the room and event names in docs/04.
**Consequences.** The client uses `socket.io-client`. Multi-instance deployments need sticky sessions or the Redis adapter.

## ADR-007: Cron scheduler with a JobRuns lock table

**Date:** 2026-09-30
**Decision.** `@nestjs/schedule` cron with a `JobRuns` table for locking, history and status; BullMQ added only when Redis is configured; `/api/v1/admin/jobs` exposes status.
**Consequences.** Works with zero optional infrastructure; at-most-once execution across instances.

## ADR-008: No fake AI responses

**Date:** 2026-06-10, reaffirmed 2026-09-30
**Decision.** An AI-backed endpoint calls the AI service or returns 501 with a reason. Simulated branches are not built. The UI labels AI output and requires teacher review before grades post. Every AI-produced resource carries model, prompt version and generation time.
**Consequences.** Honesty over apparent completeness; teacher trust is preserved.

## ADR-009: The AI service owns the agent runtime

**Date:** 2026-09-30
**Decision.** Agents, registry, orchestrator, workflows and bus live in the AI service. The LMS exposes agent routes and `/hubs/agents` as a client and event relay and contributes guardrails and audit at its boundary.
**Consequences.** One place to reason about agent behaviour.

## ADR-010: Preserve previous routes across the rewrite

**Status:** Superseded by ADR-017 on 2026-09-30.
**Original decision.** Every previous route keeps its path, verb, version and response shape.
**Why superseded.** No client exists that depends on those paths; the only external dependency is three callback routes from the AI service. Mirroring 1,126 inconsistently named routes would freeze past mistakes into the new product.

## ADR-011: Password hash migration

**Date:** 2026-09-30
**Decision.** New hashes use argon2id. If users are imported from the previous system, the login path verifies ASP.NET Identity PBKDF2 hashes by their format marker and re-hashes to argon2id on success.
**Consequences.** No forced password resets; two verifiers to maintain until migration completes.

## ADR-012: Secrets come from the environment only

**Date:** 2026-09-30
**Decision.** All secrets are read from environment variables validated at boot; placeholder values are refused outside development; `.env` files are ignored; `.env.example` documents every key; secret scanning runs in CI.

## ADR-013: Student code runs only in a sandbox

**Date:** 2026-09-30
**Decision.** Code execution goes to an isolated runner (Piston container, or a JavaScript-only isolate) with CPU, memory and time limits, or the feature returns 501.

## ADR-014: Redis and RabbitMQ are optional accelerators

**Date:** 2026-09-30
**Decision.** Every use of Redis (cache, rate limits, socket adapter, agent state, queues) and RabbitMQ (agent bus) has an in-process default. They are enabled by configuration for multi-instance deployments.

## ADR-015: Vectors stay in ChromaDB inside the AI service

**Date:** 2026-09-30
**Decision.** The AI service is the only owner of embeddings and vector search. The LMS asks it for semantic search, re-indexing and similarity.

## ADR-016: Workspace naming

**Date:** 2026-09-30
**Decision.** Brand: SmartSchool. Workspace `smartschool` (pnpm). Apps `apps/api` (`@smartschool/api`), `apps/ai` (`@smartschool/ai`), `apps/web` (`@smartschool/web`); shared code in `packages/<name>`. Lowercase kebab-case folders and packages.

## ADR-017: Design a clean API instead of mirroring the previous one

**Date:** 2026-09-30. Supersedes ADR-010.
**Context.** The previous API had 1,126 routes with mixed casing (`/api/Course`, `/api/v1/srs`, `/api/tenant-security`), duplicated v1 and unversioned paths, and success and error shapes that varied by controller. No client depends on it. The AI service depends on exactly three callback routes.
**Decision.** The LMS API is designed fresh under `/api/v1` following docs/09-API-DESIGN.md: plural kebab-case resources, camelCase JSON, string enums, RFC 9457 problem details, `{ data, meta }` lists, `202` plus job polling for long operations, ETags on mutable single resources, idempotency keys on payment and bulk endpoints. The three AI callback routes keep their exact previous paths. The previous endpoint inventory remains the checklist of capabilities to cover.
**Consequences.** Fewer, more consistent routes (Release 1 has about 150); OpenAPI is coherent enough for generated clients; the previous test scripts and docs no longer describe paths. The `apps/api` foundation is updated: `/api/Health` becomes `/api/v1/health`, the error filter emits problem details, and the pagination DTO uses `meta`.

## ADR-018: Three releases, delivered as vertical slices

**Date:** 2026-09-30
**Context.** The catalog has 35 domains. Building them horizontally (all backend first) delays user feedback by months and risks ending with nothing shippable.
**Decision.** Three releases, each a complete product: Core (a school can run on it), Depth (it teaches better), Platform (districts and ecosystems). Contents are fixed in docs/08 section 5. Every feature in the catalog is assigned to a release; none is removed. Inside a release, work is planned as vertical slices of one to two weeks that cut through API, data and the web client with tests, starting with "a teacher logs in, creates a class, and a student sees it".
**Consequences.** The web client starts in Release 1, not after the backend. Cross-cutting infrastructure (tenancy, agents, billing) is built when its release starts, not speculatively. Progress is measured in working user journeys, not endpoint counts.

## ADR-019: Tenancy is introduced in Release 3; Release 1 and 2 scope by organisation

**Date:** 2026-09-30. Amends ADR-005.
**Context.** Multi-tenant SaaS is a Release 3 capability. Carrying `TenantId` on every table from day one adds a column, an extension and a test to every slice before any tenant exists.
**Decision.** Releases 1 and 2 scope data by `OrganizationId` (a school). Release 3 introduces `Tenants` and adds `TenantId` to tenant-scoped tables through an expand-migrate-contract migration that assigns every existing organisation to a default tenant. The Prisma scoping extension is written once, parameterised by column, so switching from organisation to tenant scoping is configuration.
**Consequences.** Simpler early slices; one planned migration in Release 3; the two-scope isolation test becomes mandatory then.

## ADR-020: Identifiers, naming and error format

**Date:** 2026-09-30
**Decision.** Application-generated UUID v7 primary keys (time-ordered, stored as `char(36)`); PascalCase database names with camelCase Prisma fields via `@map`; string enums in the API mapped to integer columns; RFC 9457 problem details with a stable `code` and a `traceId`; ISO-8601 UTC timestamps.
**Consequences.** Index-friendly inserts on MariaDB; idiomatic TypeScript; the AI service's 12 tables are untouched.

## ADR-021: Rebuild the AI service to the agentic design instead of restoring the old code

Date: 1 October 2026. Status: accepted. Supersedes the "restore apps/ai from the old repository" steps in ADR-009 and docs/07 slices 5 and 6.

**Context.** The previous Python service had 155 routes, several partial or stubbed, prompts embedded in code, no evaluation harness, no written agent design and a contract drift with the LMS. Its repository URL is also unknown. Restoring it would carry those defects into a product whose bar is "outstanding".

**Decision.** Build `apps/ai` fresh in Python (FastAPI) to `docs/10-AI-SYSTEM-DESIGN.md`: a bounded orchestrator, five agents with fixed tool sets, versioned prompt files, a safety classifier for minors, golden-set evaluation with thresholds, tracing of every call, honest unavailability (ADR-008). The old code, if it is ever found, is reference material only.

**Consequences.** Slice 5 builds the orchestrator, the Tutor agent, safety and RAG; slice 6 the ContentAuthor; Release 2 the Grader, Insight and Planner. Capabilities from the old catalogue that were separate services become prompt profiles of these agents. Emotion detection stays out until an ethics and consent review (Release 3 at the earliest).

## ADR-022: Retire the H5P callback routes

Date: 1 October 2026. Status: accepted. Amends ADR-001 and ADR-017.

**Context.** ADR-017 kept `/api/ai/h5p/content|validate|libraries` so the old Python service could call back into the LMS. With ADR-021 there is no old service to be compatible with.

**Decision.** The AI service returns H5P JSON inside its job result; the LMS validates and persists it. No callback routes are exposed. The AI service calls the LMS only through the read-only `/api/v1/internal/ai/*` tool API with a service token.

**Consequences.** One fewer trust boundary in the inbound direction; docs/04 section 2 is updated when slice 5 lands.

## ADR-023: Authentication hardening

Date: 1 October 2026. Status: accepted. Extends ADR-011.

**Context.** The slice 1 design kept both tokens in browser storage, let anyone self-register as a teacher, bound accounts to any organisation id, never verified email addresses, allowed TOTP replay within the drift window, and let sessions slide indefinitely. Each is a known class of weakness for a system holding children's data.

**Decision.** Refresh tokens live in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie scoped to the auth path with a custom-header CSRF check; access tokens stay in memory. Self-registration is limited to students and parents, requires the organisation's rotating join code to attach to a school, verifies the email before first sign-in in production, never reveals whether an address exists, and is protected by reCAPTCHA when configured. Passwords are checked against a common-password list and the user's own name and email. TOTP acceptance records the time step and refuses replays; administrator roles must enable 2FA in production; sessions carry an absolute lifetime; security events (lockout, password change, 2FA changes) notify the user by email. The web client sends a strict Content Security Policy and frame denial.

**Consequences.** Native clients opt into body tokens with a header. Development keeps verification optional and exposes development-only tokens so the flows can be exercised without a mail server. `docs/11-QUALITY-AND-SECURITY.md` is the checklist every later slice is reviewed against.

## ADR-024: Build the complete product for US K-12, with four exclusions

Date: 2 October 2026. Status: accepted. Amends ADR-018.

**Context.** The build had been framed as releases of increasing depth with a minimum core first. The product owner decided the target is the complete product for US K-12 schools and districts, not a minimum viable product. A US buyer also brings legal and procurement requirements (FERPA, COPPA, state student-privacy laws, Section 508) that rule some catalogue features out entirely.

**Decision.** Every catalogue domain that serves a school is built in full across the three releases, in the order of [07-BUILD-PLAN.md](07-BUILD-PLAN.md), with [13-US-SCHOOL-READINESS.md](13-US-SCHOOL-READINESS.md) as a binding requirements document. Four things are excluded from every release: emotion detection and emotion-based analytics on children; leaderboards or any ranking of students visible to other students; betting-style "stakes"; and recruiter or employer access to student data. Rostering and single sign-on become the primary onboarding path (ADR-025).

**Consequences.** Release 2 reorders around US readiness (rostering, terms and periods, gradebook categories and report cards, period attendance, standards, parents and Spanish, counselor and consent) before depth features. Release 3 carries the breadth of the catalogue, including tenancy, integrations, library, learning paths, careers, community and billing. The definition of done in docs/11 and the UX checklist in docs/12 apply to every slice, and each slice closes with a browser sweep across roles.

## ADR-025: Rostering and single sign-on are the primary onboarding path

Date: 2 October 2026. Status: accepted. Extends ADR-023.

**Context.** US districts roster from their student information system through OneRoster, Clever or ClassLink and sign in with Google or Microsoft. Manual account creation and self-registration cannot scale to a school and are rejected in procurement.

**Decision.** Slice 9 adds OneRoster 1.1 import with nightly sync, Clever and ClassLink SSO and roster read, and Google and Microsoft OpenID Connect sign-in. Synced records carry an external id and a source and are read-only in our screens. Invitations, CSV import and join codes remain for pilots, parents and small schools. Paid vendor programmes (Clever Secure Sync, 1EdTech certification, SIS partner plugins) are adopted only when a district requires them.

**Consequences.** Users, students, guardians, classes and enrolments gain `externalId`, `source` and `managedBySis`; the API refuses edits to managed fields with `409 record.managed`; the login page shows provider buttons and passwords become optional for synced accounts; organisations gain a rostering and sign-in configuration screen.
