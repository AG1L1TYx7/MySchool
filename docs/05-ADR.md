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
**Context.** The product owner wants the LMS on Node.js and MySQL under XAMPP. The previous C# API was large (1,126 routes) and structured around ASP.NET concepts.
**Decision.** NestJS 11 on Node 22+, TypeScript strict, in `apps/api`. Its modules, guards, interceptors, pipes, gateways, scheduler and Swagger correspond directly to ASP.NET's controllers, policies, filters, model binding, SignalR, Hangfire and Swashbuckle, which makes the port mechanical.
**Consequences.** A familiar structure for anyone who knew the C# code; a framework dependency; Express under the hood.

## ADR-003: Prisma as the ORM with the previous schema preserved

**Date:** 2026-09-30
**Context.** 145 tables, 376 foreign keys and 529 indexes existed and the AI service depends on 12 of the tables by name.
**Decision.** Prisma 6 with a schema generated from the previous EF snapshot (recovered from the old repository) and kept name-compatible. The Prisma schema is the source of truth after generation; migrations are engine-portable.
**Consequences.** No data migration for the AI service; typed queries; the schema file is reviewable in git. Global query filters (soft delete, tenant) are re-implemented as Prisma client extensions.

## ADR-004: XAMPP MariaDB for development, MySQL 8 or MariaDB 10.11 for production

**Date:** 2026-09-30
**Context.** XAMPP ships MariaDB 10.4, not MySQL 8. The previous database ran on MySQL 8 and the two engines differ in collations, JSON handling and defaults.
**Decision.** Develop on XAMPP MariaDB; deploy on MySQL 8 or MariaDB 10.11 LTS. CI runs the test suite on both engines. No engine-specific SQL outside analytics, and none there without a test on both.
**Consequences.** Port 3306 must be taken from the existing MySQL 8 service on the development machine. Collation is fixed to `utf8mb4_unicode_ci`. JSON-path indexes are ruled out.

## ADR-005: Shared-database multi-tenancy with a TenantId column

**Date:** carried from the previous Phase 12 (2025-12), recorded 2026-09-30
**Context.** Schools and districts are tenants of one deployment. Database-per-tenant multiplies operational cost on local infrastructure.
**Decision.** One database; tenant-scoped tables carry `TenantId`; a request-scoped tenant context is set by middleware and enforced in data access; tenant status is checked at the edge.
**Consequences.** Isolation depends on code discipline, so an automated two-tenant isolation test is mandatory. Per-tenant backups are logical exports.

## ADR-006: Socket.IO replaces SignalR with identical events

**Date:** 2026-09-30
**Context.** Four SignalR hubs carried messaging, notifications, agent events and collaboration. The client has not been written.
**Decision.** Socket.IO namespaces at the same paths with the same room names and event names.
**Consequences.** The client uses `socket.io-client`. Multi-instance deployments need sticky sessions or the Redis adapter.

## ADR-007: Cron scheduler with a JobRuns lock table instead of Hangfire

**Date:** 2026-09-30
**Context.** Hangfire stored jobs in MySQL and offered a dashboard. Node equivalents with persistence require Redis (BullMQ) or a second database.
**Decision.** `@nestjs/schedule` cron with a `JobRuns` table for locking, history and status; BullMQ added only when Redis is configured; `/api/admin/jobs` replaces the dashboard.
**Consequences.** Works with zero optional infrastructure; at-most-once execution across instances; no retry queue for one-off jobs until Redis exists.

## ADR-008: No fake AI responses

**Date:** 2026-06-10 (gap analysis), reaffirmed 2026-09-30
**Context.** Several previous services returned hard-coded "AI" output (canned tutor answers, constant grades, simulated audits). This misleads users and hides outages.
**Decision.** An AI-backed endpoint calls the AI service or returns 501 with a reason. Simulated branches are not ported. The UI must label AI output and require teacher review before grades post.
**Consequences.** Some features show 501 until their AI path exists; honesty over apparent completeness.

## ADR-009: The AI service owns the agent runtime

**Date:** 2026-09-30
**Context.** Two agent systems existed, in C# and Python, with overlapping responsibilities. The Python one is real.
**Decision.** Agents, registry, orchestrator, workflows and bus live in the AI service. The LMS exposes `/api/Agent` and `/hubs/agents` as a client and event relay and contributes guardrails and audit at its boundary.
**Consequences.** One place to reason about agent behaviour; the C# agent code is not ported as a runtime.

## ADR-010: Preserve routes, versions and JSON shapes across the rewrite

**Date:** 2026-09-30
**Context.** The AI service calls back into fixed LMS routes; documentation and the planned client reference existing paths.
**Decision.** Every route keeps its path (including inconsistent casing), verb, version and response shape. URI versioning with v1 default; v2 controllers stay separate.
**Consequences.** The endpoint inventory is the acceptance checklist. Route clean-up is a future, separately-versioned change.

## ADR-011: Password hash migration

**Date:** 2026-09-30
**Context.** Existing users, if imported, have ASP.NET Identity v3 PBKDF2 hashes.
**Decision.** New hashes use argon2id. The login path verifies PBKDF2 hashes by their format marker and re-hashes to argon2id on success.
**Consequences.** No forced password resets; two verifiers to maintain until all hashes are migrated.

## ADR-012: Secrets come from the environment only

**Date:** 2026-09-30
**Context.** The previous repository committed database passwords and the JWT key in several files.
**Decision.** All secrets are read from environment variables validated at boot; placeholder values are refused outside development; `.env` files are ignored; `.env.example` documents every key; secret scanning runs in CI.
**Consequences.** Old credentials are rotated and never reused.

## ADR-013: Student code runs only in a sandbox

**Date:** 2026-09-30
**Context.** The previous AI service's code evaluator ran submitted code with `subprocess` on the host.
**Decision.** Code execution goes to an isolated runner (a Piston container, or a JavaScript-only in-process isolate) with CPU, memory and time limits, or the feature returns 501.
**Consequences.** One optional container in production; no remote code execution on API hosts.

## ADR-014: Redis and RabbitMQ are optional accelerators

**Date:** 2026-09-30
**Context.** Neither is installed on the development machine; both services have in-memory fallbacks.
**Decision.** Every use of Redis (cache, rate limits, socket adapter, agent state, queues) and RabbitMQ (agent bus) has an in-process default. They are enabled by configuration for multi-instance deployments.
**Consequences.** Single-instance deployments need nothing extra; horizontal scaling requires Redis for sockets and rate limits.

## ADR-015: Vectors stay in ChromaDB inside the AI service

**Date:** 2026-09-30
**Context.** MariaDB 10.4 has no vector type. ChromaDB is embedded in the Python service and already indexes the curriculum.
**Decision.** The AI service is the only owner of embeddings and vector search. The LMS asks it for semantic search, re-indexing and similarity.
**Consequences.** Semantic features depend on the AI service being up; `ContentEmbeddings` in MariaDB stores references and hashes, not vectors used for search.

## ADR-016: Workspace naming

**Date:** 2026-09-30
**Context.** The previous repository mixed `SmartSchool.Api`, `SmartSchool.AI` and `mainschool`. A clean restart needs one convention.
**Decision.** The product brand stays SmartSchool. The workspace is `smartschool` (pnpm workspaces). Applications are `apps/api` (`@smartschool/api`), `apps/ai` (`@smartschool/ai`), `apps/web` (`@smartschool/web`); shared code goes in `packages/<name>` (`@smartschool/<name>`). Folder and package names are lowercase kebab-case; the brand is capitalised only in prose and UI.
**Consequences.** Old path references in recovered files are rewritten on restore; documentation uses the new names.
