# Release 3 Review

**Date:** 14 October 2026. Reviewed against [11-QUALITY-AND-SECURITY.md](11-QUALITY-AND-SECURITY.md) section 3 (security checklist), section 4 (performance rules) and section 5 (what a release review must include), in the same form as the [Release 1 review](15-RELEASE-1-REVIEW.md). Release 2 (slices 9 to 18) had no review of its own; this one covers everything since Release 1, that is slices 9 to 26 of [07-BUILD-PLAN.md](07-BUILD-PLAN.md). Evidence is the test suites, the scripted browser checks, the load test, the backup drill and the audits named below, all run on 13 and 14 October 2026 against the code at commit `b40d34a` and the review's own small changes.

## 0. What the product is now

| | Release 1 (2 October) | Release 3 (14 October) |
|---|---|---|
| Prisma models | 43 | 132 |
| Migrations | 9 | 26 |
| API paths / operations (`docs/openapi.json`) | 118 / 167 | 392 / 526 |
| Web pages (`page.tsx`) | 39 | 73 |
| API unit suites / tests | 30 / 92 | 50 / 240 |
| API end-to-end suites / tests | 9 / 63 | 27 / 206 |
| AI service tests | 32 | 40 |
| Getting-started walkthrough sections (docs/14 section 4) | 2 | 19 (4 and 4a to 4r) |

Feature catalogue sections now marked **Real** or rebuilt: all of docs/02 sections 1 to 35 except the exclusions in docs/13 section 11. The product covers the full US K-12 scope decided in ADR-024 and ADR-025: rostering and SSO, school structure and period attendance, standards-based gradebook and report cards, support and safety, family home in English and Spanish, private motivation, the teacher assistant, learning records and practice, insight, mobile and push, compliance, districts and tenancy, integrations, the library, learning paths, careers and portfolio, community, and billing and operations.

## 1. Test status

| Suite | Result |
|---|---|
| API unit (Jest) | 240 of 240 |
| API end-to-end (Jest + supertest, seeded database) | 206 of 206 on MariaDB 10.4 and MySQL 8 in CI (run 38485631501); 206 of 206 locally, both in parallel and in band |
| AI service (pytest) | 40 of 40 |
| AI service lint, format, types (ruff, mypy) | clean |
| Web (TypeScript, ESLint, production build on Next 15) | clean |
| Browser sweep: 8 roles, every page reachable from the navigation, console errors, failed requests, 4xx and 5xx | 261 page loads across 8 roles, 0 findings (the 46 entries the script recorded are requests it cancelled itself by moving to the next page) |
| Per-slice user flows through the real UI (slices 20 to 26, Playwright) | clean on the day each slice closed; slice 26 rerun today: 7 of 7 steps |
| WCAG 2.2 AA, desktop (axe-core, six roles) | 189 pages, 0 violations |
| WCAG 2.2 AA, phone width 360 px (axe-core, five roles), reflow and 200 percent zoom | 108 pages, 0 violations; no horizontal page scroll at 360 px on any page; no clipped text at 200 percent zoom |
| Security attack suite (docs/16, part of the e2e run) | passing: every route guarded, no entry without a token, features mean what they say for all eight roles, two schools and two districts cannot see each other, no enumeration, tokens cannot be forged |
| Dependency audits (`pnpm audit --audit-level=high`, `pip-audit`) | 0 known vulnerabilities at high or critical |

Coverage, measured for this review: the unit suites cover 19 percent of API lines, because they test the pure rule modules (one `*-rules.ts` with a spec per slice) and leave services and controllers to the end-to-end suite. Measured once for this review with the end-to-end suite instrumented (a temporary Jest configuration, not committed): 84.8 percent of lines, 83.7 percent of statements, 87.4 percent of functions and 65 percent of branches of the API source outside the generated client. Under instrumentation three timing-sensitive tests (the report-card PDF, the webhook delivery pass and the weekly quests) ran past the thirty-second budget; they pass in every uninstrumented run of the day, and making them robust to a slow runner is listed in section 6. The coverage floor of 80 percent promised in docs/07 section 7 is therefore not met by the unit suites alone and is not enforced in CI; see section 6.

## 2. Security checklist

Status: **met**, **partly** (with what is missing), or **open** (with where it is tracked). Items unchanged since the Release 1 review keep their evidence; what Releases 2 and 3 added is marked by slice.

### Identity and session

| Item | Status | Evidence |
|---|---|---|
| argon2id passwords, 12+ characters, denylist, no personal data inside; imported hashes upgraded on login | met | `password.service.ts`; ASP.NET Identity V3 hashes verified and rehashed (slice 9) |
| District may require longer passwords, 2FA for named roles, a session age and administrator networks (slice 26) | met | `operations-rules.ts` security policy, `SecurityPolicyGuard`, `billing-operations` e2e: register refused under 16 characters, principal refused from an unapproved network, session closed after the district's hour, teacher held to 2FA |
| Constant-time sign-in, per-IP throttle, per-account lockout, audit row | met | unchanged since Release 1 |
| Access JWT in memory; refresh cookie HttpOnly SameSite=Strict on the auth path, rotated, family revoked on reuse, absolute lifetime; sessions listable and revocable | met | unchanged; the token now carries `tenantId` and, for superintendents, the district's school ids (slice 20) |
| TOTP with encrypted secret, replay protection, hashed backup codes, required for administrators | met | unchanged; district roles join the platform list (slice 26) |
| SSO (SAML and OIDC) and LTI 1.3 launches create or link accounts only inside the configured school; LTI id_tokens verified against the platform's JWKS with issuer, audience, expiry, nonce, deployment and message type | met | slice 9 `sso` e2e, slice 21 `integrations` e2e |
| API keys: shown once, stored hashed, read-only scopes, per-minute budget, expiry, revoked with the key or its creator, redacted from logs | met | slice 21; `apikey.scope` 403 outside the scopes, 429 over budget |
| Registration limited to students and parents, email verification, identical responses whether or not the email exists | met | unchanged |

### Authorisation

| Item | Status | Evidence |
|---|---|---|
| Every route declares a feature; deny by default; organisation scoping in services | met | `route-catalog.ts` check in the security suite fails on any unguarded handler |
| Tenant boundary: every list and id-based route stops at the district (slice 20) | met | `district` e2e two-tenant isolation; security suite cross-district probe over forty id routes |
| Students and parents only see their own records, per resource | met | unchanged; extended to learning records, paths, portfolios, community and billing |
| Visibility rules per feature: library reach (private, school, district, public), portfolio visibility with family and teachers always, community groups by membership and roster, billing by district | met | each slice's rules spec and e2e |
| District policies can switch AI, student messaging and named features off for every school | met | slice 20 `tenants.service` policies, `AccessGuard` consults them |
| Privileged role changes limited by hierarchy and audited | met | unchanged |

### Input and output

| Item | Status | Evidence |
|---|---|---|
| Whitelisted validation, unknown fields dropped, body sizes capped | met | unchanged |
| CSV formula guard, sanitised file names, uploads type-checked and outside the web root | met | unchanged; the security suite probes traversal in names and download paths |
| Student code runs in the ADR-013 isolate: worker thread, memory and time caps, no host objects, no code generation from strings | met | slice 24 `code-runner.service.spec.ts` proves `require`, `process`, `fetch`, timers and the constructor route are unreachable |
| Student community posts screened by a rule list before they show (contact details, outside links, unkind phrases) | met | slice 25 `community-rules.spec.ts`, moderation e2e |
| Webhook deliveries signed (HMAC over timestamp and body); provider webhooks verified over the raw body in constant time with a timestamp tolerance; idempotent billing writes | met | slices 21 and 26 rules specs and e2e |
| No stack traces or SQL in errors; trace id on every problem | met | unchanged; the security suite greps every error body |
| Security headers on API and web; rate limiting | met | unchanged |

### Secrets and configuration

| Item | Status | Evidence |
|---|---|---|
| Secrets only from the environment; placeholders refused in production; `.env` never committed | met | zod schema; `.gitignore`; no payment-provider or SSO key is in the repository, CI uses its own throwaway values |
| Service-to-service calls authenticated; LTI tool keys generated and stored per deployment | met | `AI_SERVICE_API_KEY`, `AI_CALLBACK_TOKEN`; `LtiKeys` RSA key generated on first use |
| Dependency audit in CI; lock file committed; overrides pin patched transitive versions | met | `pnpm.overrides` (incl. `handlebars >= 4.7.10`) |

### Data protection

| Item | Status | Evidence |
|---|---|---|
| Minimum personal data in AI prompts; pseudonymised prompt logs | met | unchanged (docs/10) |
| AI consent for students under 13 with a parent opt-out | met | slice 12 `ai-consent`, enforced before any tutor or content route |
| Data map, retention per school applied nightly, deletion on request with grace and legal hold, FERPA export | met | slice 19; docs/17; `compliance` e2e |
| Audit log for identity, permissions, students, grades, settings, moderation, billing, incidents | met | `@Audit` interceptor plus explicit `audit.record` in every Release 2 and 3 service; audit export for IT (slice 21) |
| Breach runbook and security incident records | met | docs/18; `SecurityIncidents` (slice 19); service incidents on the public status page are separate (slice 26) |

### Still open for a US district (docs/13 section 10)

- A third-party penetration test and a dynamic scan of the running web app (docs/16 section 3).
- An adversarial prompt-injection corpus for the AI service (docs/10 section 8).
- The signed data-privacy agreement, which is the district's step.

None of these blocks a pilot with a signed agreement that names them, as the Release 1 review said; none has moved since, which section 6 records.

## 3. Performance

Load test: the development database holds the Release 1 load school (10,000 students, 400 teachers, 400 classes of 25, one assignment per class, 2,000 grades) next to the demo school. `pnpm load:test` ran 60 concurrent connections for 20 seconds per scenario against the API on the development machine (XAMPP MariaDB 10.4, `RATE_LIMIT_PER_MINUTE` raised), with the web app and the AI service also running. Five scenarios were added for Release 2 and 3 read paths; the Release 1 numbers are in the earlier review for comparison.

| Scenario | req/s | p50 | p95 | p99 | non-2xx |
|---|---|---|---|---|---|
| health | 2666 | 17 ms | 38 ms | 40 ms | 0 |
| auth/me | 1189 | 49 ms | 67 ms | 73 ms | 0 |
| students list (page of 50) | 566 | 105 ms | 122 ms | 130 ms | 0 |
| students search | 396 | 150 ms | 161 ms | 174 ms | 0 |
| classes/mine (student) | 547 | 108 ms | 124 ms | 130 ms | 0 |
| assignments (student week) | 374 | 152 ms | 235 ms | 291 ms | 0 |
| assignment detail | 439 | 136 ms | 150 ms | 155 ms | 0 |
| class roster | 649 | 90 ms | 111 ms | 119 ms | 0 |
| gradebook | 438 | 135 ms | 152 ms | 157 ms | 0 |
| notifications summary | 1097 | 53 ms | 71 ms | 77 ms | 0 |
| announcements feed | 805 | 72 ms | 102 ms | 109 ms | 0 |
| learning profile (student) | 207 | 286 ms | 314 ms | 343 ms | 0 |
| mastery (student) | 907 | 65 ms | 81 ms | 86 ms | 0 |
| library items (page of 20) | 662 | 89 ms | 103 ms | 106 ms | 0 |
| community feed (student) | 707 | 71 ms | 175 ms | 677 ms | 0 |
| status page (public) | 1241 | 47 ms | 66 ms | 71 ms | 0 |

Budget (docs/11): p95 under 300 ms for list and detail endpoints with 10,000 students. Met for every scenario except the student learning profile, whose p95 is 314 ms because one answer assembles the health score, gaps, next steps, paths and mastery; the community feed's p99 of 677 ms is a single spike over a p95 of 175 ms. The scenarios shared with Release 1 moved by a few milliseconds either way, with the load school now sitting beside a database that also holds everything Releases 2 and 3 added. Full numbers in `docs/load-test.json`.

Rules checked for the Release 2 and 3 code: every list paginates with a maximum page size (the community feed is capped at twenty, library and topic lists at the paged size); filters hit indexed columns (every new table has an index on its organisation or tenant plus the sort column); the learning profile and mastery views read per student, not per row; the status page reads one check row, the open incidents and ninety days of checks; usage metering counts in memory and writes once a minute, so the per-request cost is a map update; long work (AI generation, imports, webhook delivery, state exports, retention) runs as jobs; the health report is cached for five seconds. One finding fixed during the review: the usage flush at shutdown reconnected Prisma after the module had disconnected and leaked a pool per closed application, which exhausted the database's connections in a long in-band test run (commit `b40d34a`).

## 4. Front end

Lighthouse (desktop, DevTools throttling) on the public pages: /login: performance 90, accessibility 100, best practices 100, SEO 100 (largest paint 1.5 s, blocking time 30 ms, layout shift 0.001); /register: performance 89, accessibility 100, best practices 100, SEO 100 (largest paint 1.5 s, blocking time 20 ms, layout shift 0.002); /status: performance 78, accessibility 100, best practices 100, SEO 100 (largest paint 2.8 s, blocking time 20 ms, layout shift 0.009).

axe-core finds no WCAG 2.2 AA violations on any page for any role at desktop width or at 360 px, no page scrolls horizontally at 360 px, and no text is clipped at 200 percent zoom; the conformance report is [19-ACCESSIBILITY-CONFORMANCE.md](19-ACCESSIBILITY-CONFORMANCE.md), updated with today's results. Family screens are in English and Spanish (slice 13); staff screens are English only, as the report's known exceptions say. Motion follows docs/12 with one change made in slice 25: page transitions are enter-only, because the exit-then-enter sequence left the next page invisible whenever an exit was interrupted. Three findings fixed during the review's audits: a list that held a non-list child on the community groups tab, a link told apart by colour alone on the operations page, and scrolling tables on the billing and operations pages that could not be reached by keyboard.

## 5. Operations

- Backup and restore drill, 14 October: `pnpm db:backup` wrote a 2.6 MB dump of the development database (10,006 students) and its uploads; `pnpm db:restore` into the test database took 7 seconds including the uploads, and row counts matched (students, invoices, community topics). The dump format is unchanged since Release 1.
- Public status page: `/status` shows one overall state, four components, open incidents, planned maintenance and ninety days of uptime from a check every five minutes; incidents are recorded and updated under Operations and audited (slice 26).
- Usage metering per school and day, with a nightly snapshot of active students and storage, visible to the district under Billing (slice 26).
- Docker: `docker compose` is still unexecuted on this machine (no Docker installed); unchanged since Release 1 and carried forward.
- OpenAPI: `docs/openapi.json` (392 paths, 526 operations), regenerated with `pnpm --filter @smartschool/api openapi:export`.
- Getting-started guide: [14-GETTING-STARTED.md](14-GETTING-STARTED.md) sections 4a to 4r walk every slice.
- CI (`.github/workflows/ci.yml`) against the gates promised in docs/07 section 7: lint, typecheck, unit, e2e on both engines, `pnpm audit` and `pip-audit`, ruff, mypy and the web build are there; failing tests and the first unhandled server errors are copied to the job summary and to annotations readable without repository rights. Not there: a Playwright smoke job (the flow and audit scripts live outside the repository and run by hand), a coverage floor, a migration drift check, a Lighthouse budget, and contract fixtures run against the real AI service (the API e2e uses a stub; the AI service has its own tests).

## 6. Pilot readiness (docs/13 section 12) and known gaps carried forward

Definition of ready for a US pilot: rostering or SSO (slice 9) **ready**; terms and periods (slice 10) **ready**; gradebook categories per syllabus (slice 11) **ready**; attendance codes per district (slice 10) **ready**; consent for under-13 AI (slice 12) **ready**; accessibility report (docs/19) **current as of today**; data-privacy agreement **the district's step**.

Gaps carried forward, consolidated from the per-slice notes in docs/07, docs/16 section 3 and docs/19 section 4:

1. Third-party penetration test, dynamic scan of the web app, prompt-injection corpus (unchanged since Release 1).
2. CI gates still missing from docs/07 section 7: Playwright smoke in CI (move the flow and audit scripts into the repository), coverage floor (measure unit and e2e together), migration drift check, Lighthouse budget, AI contract fixtures.
3. Docker images unexecuted here; the standalone web build is Docker-only on Windows.
4. Lighthouse performance below 90 under the simulated profile on the sign-in pages (framework bundle size).
5. Accessibility exceptions: PDF exports are not tagged PDF; H5P content depends on its author; staff screens are English only; Insight chart points are not individually focusable.
6. By decision (ADR-024 and docs/13 section 11): emotion detection, leaderboards, stakes, recruiting, follows and public feeds.
7. Integrations: LTI Assignment and Grade Services, Names and Roles and Deep Linking; Google Classroom API sync; the organisation IP whitelist (the district allowlist of slice 26 covers administrators only).
8. Billing: Stripe checkout and card payments, taxes and proration; the signed webhook and provider fields are the seam.
9. Found by this review: the student learning profile answers in 314 ms at p95 under sixty concurrent clients (budget 300 ms), so its five parts should be cached per student or fetched separately by the page; the public status page's largest paint waits for the status API call (Lighthouse performance 78 under throttling), so it should render the last known state on the server; three timing-sensitive end-to-end tests (report-card PDF, webhook delivery pass, weekly quests) fail only when the suite runs instrumented for coverage and should get their own timeouts; the load test must be pointed at `127.0.0.1` on Node 24, which the script's usage note now says.
10. Smaller items per slice: AI-written narratives for the learning profile and intervention plans (23); scholarships, industry trends and languages other than JavaScript (24); library comments, creator profiles and trending (22); a native app, APNS direct and web push through a service worker (18); dashboard widgets, Excel and analytics caching (17); statement voiding, external xAPI ingestion and prerequisite maps (16); district narrative AI, budgets and staff positions (20).

What a Release 4 would start with, in order: the CI gates (item 2), the penetration test and dynamic scan (item 1), then the integration and billing seams (items 7 and 8) as districts ask for them.
