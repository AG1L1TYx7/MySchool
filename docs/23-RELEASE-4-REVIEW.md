# Release 4 Review

**Date:** 17 October 2026. Reviewed against [11-QUALITY-AND-SECURITY.md](11-QUALITY-AND-SECURITY.md) section 3 (security checklist), section 4 (performance rules) and section 5 (what a release review must include), in the same form as the [Release 3 review](20-RELEASE-3-REVIEW.md). Release 4 (slices 27 to 30, docs/07 section 5a) was the hardening release the Release 3 review asked for: the CI gates, the two performance findings, security verification in the pipeline, and the integration and billing seams. The security audit of 14 October ([21-SECURITY-AUDIT.md](21-SECURITY-AUDIT.md)) ran between slices 27 and 28 and its fixes are part of this release.

## 0. What the product is now

| | Release 3 (14 October) | Release 4 (17 October) |
|---|---|---|
| Prisma models | 132 | 138 |
| Migrations | 26 | 30 |
| API paths / operations (`docs/openapi.json`) | 392 / 526 | 411 / 548 |
| Web pages (`page.tsx`) | 73 | 74 |
| API unit suites / tests | 50 / 240 | 57 / 273 |
| API end-to-end suites / tests | 27 / 206 | 27 / 213 |
| AI service tests | 40 | 77 (plus one live test, skipped without Ollama) |
| CI jobs per push | 5 | 8 (API on two engines, AI, web, browser sweep, WCAG audit, Lighthouse, ZAP) |

What Release 4 added, by slice: the browser checks, the migration drift check, the coverage floor and the AI contract check in CI (27); the learning profile cache and the server-rendered status page (28); the OWASP ZAP passive scan on every push, the prompt-injection corpus with block fencing in the AI service, and the penetration-test brief (29); LTI 1.3 Names and Roles, Assignment and Grade Services and Deep Linking in both directions, Google Classroom as a roster source with grade write-back, and card payments through a provider seam with proration and tax (30). The audit added the outbound-URL guard, proxy trust, log redaction, streamed-answer moderation, per-account throttling, zip and sandbox limits, production checks on both services, student field visibility, and some thirty smaller hardenings (docs/21 section 4).

## 1. Test status

| Suite | Result |
|---|---|
| API unit (Jest) | 273 of 273 |
| API end-to-end (Jest + supertest, seeded database) | 213 of 213 on MariaDB 10.4 and MySQL 8 in CI (run 38919010585); 213 of 213 locally on a fresh database, in band |
| AI service (pytest) | 77 of 77, one live test skipped |
| AI service lint, format, types (ruff, mypy) | clean |
| Web (TypeScript, ESLint, production build on Next 15.5.27) | clean |
| Browser sweep in CI: 8 roles, every page reachable from the navigation, console errors, failed requests, 4xx and 5xx | clean; the 39 entries the run recorded are requests the sweep cancelled itself by moving to the next page |
| WCAG 2.2 AA, desktop, in CI (axe-core, six roles) | 0 violations |
| WCAG 2.2 AA, phone width 360 px (axe-core, five roles), reflow and 200 percent zoom | by hand before a release (`pnpm browser:a11y:mobile`); last run clean on 14 October |
| Lighthouse budget in CI (performance 80, the rest 100, on the public pages) | met: /login 89, /register 90, /status 89 (largest paint 1.5 s on each) |
| OWASP ZAP passive scan in CI (web app spidered; every API route from the OpenAPI document) | clean: no medium or high alert beyond the two accepted CSP alerts with written reasons; 14 low or informational, listed in the artifact |
| Security attack suite (docs/16, part of the e2e run) | passing: every route guarded, no entry without a token, features mean what they say for all eight roles, schools and districts cannot see each other, no enumeration, tokens cannot be forged |
| Prompt-injection corpus against the AI rule layer and block fence | 31 entries, all as expected (12 overrides blocked, 8 benign lookalikes allowed, 6 block escapes fenced) |
| Dependency audits (`pnpm audit --audit-level=high`, `pip-audit`) | 0 known vulnerabilities at high or critical; `pnpm audit --prod` finds nothing; the ignored dev-only advisories are listed in docs/16 |

Coverage, measured for this review with the end-to-end suite instrumented on a fresh database (the floor in `test/jest-e2e.json` is 80 percent lines, statements and functions and 60 percent branches): 85.7 percent of lines, 84.3 percent of statements, 87.6 percent of functions and 65.6 percent of branches (213 of 213 tests), above the floor on every measure; the unit suites still cover the pure rule modules and leave services and controllers to the end-to-end suite, as the Release 3 review described.

## 2. Security checklist

Status: **met**, **partly** (with what is missing), or **open** (with where it is tracked). Items unchanged since the Release 3 review keep their evidence; what Release 4 and the audit added is marked.

### Identity and session

| Item | Status | Evidence |
|---|---|---|
| Passwords, lockout, sessions, two-factor, SSO and LTI launches, API keys, registration | met | unchanged from the Release 3 review |
| Sign-in style routes throttle per address **and** account (audit F07) | met | `request-rules.ts` `throttleTracker`, `AppThrottlerGuard` |
| An API key reaches only routes that declare a feature, never the auth routes (audit F06) | met | `access.guard.ts`, `jwt-auth.guard.ts`; `apikey.scope` |
| Access tokens from the Authorization header only (audit F28) | met | `jwt.strategy.ts`; sockets carry the token in the handshake |
| Wrong school join codes and verification or reset mails have cooldowns (audit F29, F39) | met | `auth/abuse-rules.ts` |
| LTI service tokens: client-credentials with a client assertion, never a stored secret; our service token for tools is HMAC-signed, scoped, an hour long (slice 30) | met | `integration-rules.ts` `clientAssertionClaims`, `signServiceToken`, `verifyServiceToken`; `integrations` e2e |
| First-time SSO and LTI account linking by email for staff and district roles | **open** | docs/21 section 5, decision 1; waits for the product decision |
| Two-factor enrolment without the current password; reusable MFA token; per-account lockout wording | **open** | docs/21 section 5, decision 2 |

### Authorisation

| Item | Status | Evidence |
|---|---|---|
| Every route declares a feature; organisation and tenant scoping; students and parents see only their own | met | unchanged; the 19 new routes of slice 30 are in the matrix |
| A school role learns nothing about a record in another school (404, not 403) (audit F36) | met | `access/scope.ts` `assertOrganizationRecord` in students, support, files and compliance |
| User management follows the role hierarchy; feature overrides readable only inside the organisation (audit F17) | met | `users.service.ts`, `access.service.ts` |
| Sensitive student fields only to administrators, counselors, the student's teachers and the family (audit F14) | met | `students-rules.ts`; list rows carry identity and standing |
| LTI tools reach only classes of their own school; placed content is managed by the class's teachers (slice 30) | met | `lti-platform.service.ts`; `integrations` e2e |

### Input and output

| Item | Status | Evidence |
|---|---|---|
| Validation, CSV guard, file names, uploads, the code sandbox, community screening, signed webhooks, error shape | met | unchanged; the CSV guard now covers every writer (audit F21) |
| Outbound URLs an administrator supplies are public https, resolved and checked against private ranges before every fetch (audit F08) | met | `common/outbound-url.ts`; webhooks, roster sources, Classroom, LTI key sets and services |
| Archive inflate budget; sandbox admission queue; per-route limits on expensive work (audit F09, F10) | met | `oneroster-csv.ts` `zipEntryFilter`, `careers-rules.ts` `sandboxAdmission`, `common/throttle-limits.ts` |
| Downloads: media type from the allow-listed extension, encoded disposition, `nosniff` (audit F22) | met | `file-rules.ts` `mimeTypeFor`; every download route |
| Security headers: API `default-src 'none'` and `frame-ancestors 'none'`, Swagger only when enabled; web adds `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`; no `X-Powered-By` (audit F26, ZAP) | met | `app.setup.ts`, `next.config.mjs`; the ZAP job checks every push |
| Prompt data stays inside its block in the AI service; override phrasings are blocked before the model (slice 29) | met | `apps/ai/app/injection.py`, `safety.py`; `test_injection_corpus.py` |
| Proxy trust is explicit; client addresses never come from a header the client wrote (audit F03) | met | `TRUST_PROXY`, `request-rules.ts` `parseTrustProxy` |

### Secrets and configuration

| Item | Status | Evidence |
|---|---|---|
| Secrets only from the environment; placeholders refused in production; `.env` never committed | met | unchanged; production now also requires `ENCRYPTION_KEY`, `AI_SERVICE_API_KEY` and `CORS_ORIGINS`, and the AI service refuses placeholders, the fake provider and the development salt (audit F13, F25) |
| Logs redact credentials and mask token-carrying URLs (audit F04) | met | `request-rules.ts` `LOG_REDACT_PATHS`, `maskLoggedUrl` |
| Dependency audit in CI; Dependabot opens grouped weekly pull requests (slice 29, audit) | met | `.github/dependabot.yml`; its first five pull requests (GitHub Actions majors) await review |
| Demo accounts never seeded in production without `SEED_DEMO_DATA=true` (audit F19) | met | `prisma/seed.ts` |
| Card data never touches the product; the provider hosts the checkout and settles by signed webhook (slice 30) | met | `infra/payments`; `billing-operations` e2e |
| LTI tool signing key stored encrypted; launch nonces in a table instead of memory | **open** | docs/21 section 5, decision 3 (two migrations) |

### Data protection

| Item | Status | Evidence |
|---|---|---|
| Minimum personal data in prompts, consent under 13, data map, retention, deletion, FERPA export, audit log, breach runbook | met | unchanged |
| Streamed tutor answers are moderated before release (audit F05) | met | `safety.py` `release_segments`; `test_stream_safety.py` |
| Cached tutor transcripts are cleared on sign-out (audit F15) | met | `apps/web/src/lib/offline.ts` |
| Public portfolio pages are not indexed; approval before a minor's page goes public | partly | `noindex` is in place; the approval rule is docs/21 section 5, decision 4 |

### Still open for a US district (docs/13 section 10)

- A third-party penetration test: the brief is written ([22-PENETRATION-TEST-BRIEF.md](22-PENETRATION-TEST-BRIEF.md)); the test itself has not been commissioned.
- The prompt-injection corpus against the live model (`OLLAMA_LIVE=1`): run by hand before a release; not yet run.
- The four product decisions of docs/21 section 5.
- The signed data-privacy agreement, which is the district's step.

The dynamic scan, which the Release 3 review carried as open, now runs on every push.

## 3. Performance

Load test, 15 October (slice 28), same method as the Release 3 review: `pnpm load:test`, 60 concurrent connections for 20 seconds per scenario against the development API with the load school (10,000 students) beside the demo school. Full numbers in `docs/load-test.json`; the two scenarios the Release 3 review flagged:

| Scenario | Release 3 p95 | Release 4 p95 | Change |
|---|---|---|---|
| learning profile (student) | 314 ms | 118 ms | assembled once per student and served from a one-minute cache that learning events and path writes drop early (`paths-rules.ts`, `common/ttl-cache.ts`) |
| status page (public) | 66 ms | 53 ms | the API builds it once per thirty seconds; the web server renders the last known state |

Budget (docs/11): p95 under 300 ms for list and detail endpoints with 10,000 students. Met for every scenario. The other scenarios moved by tens of milliseconds either way between the two runs (the slice 28 run shared the machine with the development servers); none approaches the budget.

Rules checked for the Release 4 code: the new LTI, Classroom and billing routes paginate or are bounded (memberships and line items by class, results capped at 500, ZAP and roster fetches capped in pages and bytes); the profile cache has an explicit invalidation path; the three timing-sensitive end-to-end tests have their own budgets and ran under coverage instrumentation in 23 seconds for their four suites.

## 4. Front end

Lighthouse in CI on every push (desktop, DevTools throttling, budget performance 80 and the rest 100): /login 89, /register 90, /status 89, each with a largest paint of 1.5 s, blocking time 50 ms and no layout shift; the status page is held to the budget since slice 28 (it was 78 and informational). axe-core in CI finds no WCAG 2.2 AA violations for the six roles at desktop width; the phone-width audit and the per-slice journeys run by hand before a release. The conformance report is [19-ACCESSIBILITY-CONFORMANCE.md](19-ACCESSIBILITY-CONFORMANCE.md); its known exceptions (PDF exports not tagged, H5P content by its author, staff screens English only, Insight chart points not individually focusable) are unchanged. New screens this release: the "Courses from your LMS" card and the deep-linking picker on Integrations, the tools card with placed content on a class, the Google Classroom card, the sales tax and Pay by card controls on Billing, all built from the shared components with labelled controls and keyboard paths.

## 5. Operations

- CI (`.github/workflows/ci.yml`) now meets every gate docs/07 section 7 promised: lint, typecheck, unit, end-to-end on both engines with a coverage floor and a migration drift check, dependency audits, ruff and mypy, the AI contract check, the web build, the browser sweep, the WCAG audit, the Lighthouse budget and the ZAP scan; failing tests and the first server errors reach the job summary and annotations. A push takes about 25 minutes end to end because the four browser jobs each build and start the whole stack.
- Dependabot: weekly grouped pull requests for npm, pip, GitHub Actions and the three Docker images.
- Status page: server-rendered with the last known state; the API caches it for thirty seconds.
- Backup and restore: unchanged since the Release 3 drill (`pnpm db:backup`, `pnpm db:restore`); not re-run for this review.
- Docker: `docker compose` is still unexecuted on this machine; the compose file gained `ENCRYPTION_KEY`, `TRUST_PROXY`, `AI_ENV`, a pinned Ollama image and a loopback-bound web port in the audit. The ZAP job is the first use of Docker in CI.
- OpenAPI: `docs/openapi.json` (411 paths, 548 operations).
- Production settings a deployment now needs (docs/14, docs/21 section 5): `TRUST_PROXY`, `ENCRYPTION_KEY`, `AI_SERVICE_API_KEY`, `CORS_ORIGINS`, `SWAGGER_ENABLED` unset, a captcha provider, and for the seams `STRIPE_*`, the Classroom service account per school and the LTI platform token URLs.

## 6. Pilot readiness (docs/13 section 12) and known gaps carried forward

Definition of ready for a US pilot: rostering or SSO **ready** (now also Google Classroom and LTI rosters); terms and periods **ready**; gradebook categories per syllabus **ready**; attendance codes per district **ready**; consent for under-13 AI **ready**; accessibility report **current as of 14 October** (the CI audit has been clean since); data-privacy agreement **the district's step**.

Gaps carried forward, consolidated from docs/21 section 5, docs/16 section 3, docs/19 section 4 and the per-slice notes in docs/07:

1. The four product decisions of docs/21 section 5: first-time SSO and LTI linking by email; two-factor enrolment, single-use MFA tokens and per-account lockout wording; the LTI nonce table and the encrypted tool key (two migrations); approval before a minor's public page. Each changes how people sign in or the schema, so each waits for a decision.
2. Manual actions from the audit: remove or scope the unused internal AI tool routes (F31); implement or remove `SAFETY_MODEL_CHECK` (F33); rotate the secrets listed; set the production variables; enable secret scanning with push protection on the repository; add a pre-commit secret scan.
3. The penetration test (brief in docs/22) and the live prompt-injection run before a release.
4. Dependabot's first pull requests (five GitHub Actions major bumps) need a review; the seven OpenTelemetry moderates and two Lighthouse advisories stay ignored as development-only.
5. Docker images unexecuted here; the standalone web build is Docker-only on Windows.
6. Accessibility exceptions (unchanged): PDF exports not tagged; H5P content by its author; staff screens English only; Insight chart points not individually focusable.
7. Integrations, remaining pieces: LTI as a platform does not yet offer Names and Roles to tools launched without a class, nor line items for assignments created in SmartSchool first (a tool creates its own); Google Classroom sync is pull and grade push only (no coursework import); the organisation IP whitelist for all roles.
8. Billing, remaining pieces: refunds and disputes through the provider, invoice emails, and the subscription portal; the seam carries them.
9. By decision (ADR-024 and docs/13 section 11): emotion detection, leaderboards, stakes, recruiting, follows and public feeds.
10. Smaller items per slice, unchanged from the Release 3 review item 10.

What a Release 5 would start with, in order: the four decisions and the manual actions (items 1 and 2), the penetration test (item 3), then the remaining integration and billing pieces (items 7 and 8) as districts ask for them. docs/07 section 5b lists them as slices.
