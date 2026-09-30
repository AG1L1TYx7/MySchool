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
