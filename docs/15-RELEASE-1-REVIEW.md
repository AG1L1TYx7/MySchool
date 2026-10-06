# Release 1 Review

**Date:** 2 October 2026. Reviewed against [11-QUALITY-AND-SECURITY.md](11-QUALITY-AND-SECURITY.md) section 3 (security checklist) and section 4 (performance rules), as docs/11 section 5 requires before a release. Evidence is the test suites, the scripted checks under `tools/`, and the audits described below.

## 1. Test status

| Suite | Result |
|---|---|
| API unit (Jest) | 92 of 92 |
| API end-to-end (Jest + supertest + socket.io-client, seeded MariaDB) | 63 of 63 |
| AI service (pytest) | 32 of 32 |
| AI service lint, format, types (ruff, mypy) | clean |
| Web (TypeScript, ESLint, production build on Next 15) | clean |
| Browser sweep: 7 roles, up to 22 pages each, console errors, failed requests, 4xx and 5xx | 0 findings |
| Two-session live check (announcement to bell, message to open thread) | passing |
| WCAG 2.2 AA (axe-core, 5 roles, 88 page loads) | 0 violations |
| Dependency audits (pnpm audit, pip-audit) | 0 known vulnerabilities |

## 2. Security checklist

Status: **met**, **partly** (with what is missing), or **deferred** (to a named slice).

### Authentication

| Item | Status | Evidence |
|---|---|---|
| argon2id passwords, 12+ characters, common-password denylist, no personal data inside | met | `password.service.ts`, `password-policy.spec.ts`; e2e rejects weak and personal passwords |
| Constant-time sign-in behaviour, per-IP throttle, per-account lockout with notification, audit row | met | login limit 5 per minute, lockout after 5 failures, `auth` e2e |
| Access JWT in memory only; refresh in HttpOnly SameSite=Strict cookie on the auth path, rotated, family revoked on reuse, absolute lifetime; sessions listable and revocable; revoked on password change | met | `auth.controller.ts`, `session-rules.ts`; e2e covers rotation, reuse detection, absolute expiry |
| TOTP with encrypted secret, replay protection by time step, hashed single-use backup codes, required for administrators in production | met | `two-factor.service.ts`, `totp-replay.spec.ts`; `AUTH_MFA_REQUIRED_ROLES` |
| Registration limited to students and parents, staff invited, membership by invitation or join code, email verification, identical responses whether or not the email exists | met | `auth.service.ts` register returns 202 always; join codes per organisation |
| Hashed single-use email tokens with expiry; reset invalidates sessions | met | `AuthTokens` table |

### Authorisation

| Item | Status | Evidence |
|---|---|---|
| Every route declares a feature code; deny by default; organisation scoping in services; cross-organisation tests | met | `AccessGuard`, `@RequireFeature` on every controller method; e2e uses a second organisation for the AI content and messaging policies |
| Students and parents only see their own records, tested per resource | met | students, assignments, grades, attendance, conversations and notifications e2e |
| Privileged role changes limited by hierarchy and audited | met | `roles.ts` `canAssign`, users e2e |
| Socket handshakes authenticated like HTTP | met | `WsAuthService`; communication e2e rejects a bad token |

### Input and output

| Item | Status | Evidence |
|---|---|---|
| Whitelisted validation, unknown fields dropped, body sizes capped | met | `configureApp()` ValidationPipe, JSON 5 MB, CSV 10 MB, uploads 50 MB |
| CSV formula-injection guard, sanitised file names, type-checked uploads stored outside the web root | met | `csv.ts`, `file-rules.ts`, academics e2e rejects an executable |
| No stack traces or SQL in errors; trace id on every problem | met | problem-details filter |
| Security headers on API and web | met | helmet; CSP, frame denial, referrer policy on the web app |
| Rate limiting | met | 100 requests per minute per IP by default, configurable with `RATE_LIMIT_PER_MINUTE` |

### Secrets and services

| Item | Status | Evidence |
|---|---|---|
| Secrets only from the environment; placeholders refused in production; `.env` never committed | met | zod schema refuses `CHANGE_ME` and short secrets in production; `.gitignore` |
| Service-to-service calls authenticated with dedicated tokens | met | `AI_SERVICE_API_KEY` outbound, `AI_CALLBACK_TOKEN` inbound with constant-time compare |
| Dependency audit in CI, lock file committed, build scripts allow-listed | met | CI fails on high or critical (`pnpm audit`, `pip-audit`); overrides pin patched transitive versions |

### Data

| Item | Status | Evidence |
|---|---|---|
| Minimum personal data in AI prompts; pseudonymised prompt logs | met | the internal tool API returns first name, grade and class only; traces use salted pseudonyms |
| Hard delete of student data on request, data-subject tooling | deferred | Release 2 slice 12 and Release 3 slice 19 (docs/13 section 10) |
| Audit log for identity, permissions, students, grades, settings | met | `@Audit` interceptor and explicit `audit.record` calls |

### Still open for a US district (docs/13)

Consent flow for under-13 AI use, data map and retention jobs, penetration test by a third party, signed data-privacy agreement. All scheduled; none blocks a pilot with a signed agreement that names them.

## 3. Performance

Load test: `pnpm load:seed` adds a school with 10,000 students, 400 teachers, 400 classes of 25, one assignment per class and 2,000 grades (11 seconds to seed). `pnpm load:test` runs 60 concurrent connections for 15 seconds per scenario against the API on the development machine (XAMPP MariaDB 10.4, API started with `RATE_LIMIT_PER_MINUTE` raised).

| Scenario | req/s | p50 | p99 |
|---|---|---|---|
| health | 3182 | 15 ms | 35 ms |
| auth/me | 1291 | 45 ms | 69 ms |
| students list, page of 50 | 580 | 102 ms | 130 ms |
| students search | 371 | 160 ms | 199 ms |
| classes/mine (student) | 555 | 105 ms | 140 ms |
| assignments, 100 per page (student) | 390 | 142 ms | 357 ms |
| assignment detail | 474 | 125 ms | 147 ms |
| class roster | 638 | 91 ms | 124 ms |
| gradebook | 622 | 95 ms | 121 ms |
| notifications summary | 1171 | 50 ms | 72 ms |
| announcements feed | 882 | 67 ms | 86 ms |

Budget (docs/11): p95 under 300 ms for list and detail endpoints with 10,000 students. Met for every scenario; the only p99 above 300 ms is the 100-row student assignment list under 60 concurrent clients. Full numbers in `docs/load-test.json`.

Rules checked: every list paginates with a maximum page size; filters hit indexed columns; learner views batch submissions and grades in two queries, not per row; long work (AI generation, imports) runs as jobs; the health report is cached for five seconds so probes cannot amplify load.

## 4. Front end

Lighthouse (desktop) on the sign-in and registration pages: accessibility 100, best practices 100, SEO 100, performance 91 with applied (DevTools) throttling. Observed first and largest paint on the local server is 92 ms; the font is marked `display: optional` so slow connections keep the system font instead of delaying the paint, and the sign-in pages ship without the motion library. axe-core finds no WCAG 2.2 AA violations on any page for any role. Remaining accessibility work for Release 3 slice 19 is the manual audit (screen reader walkthroughs, keyboard-only flows, the H5P player's own controls).

## 5. Operations

- `pnpm db:backup` and `pnpm db:restore`: tested by backing up the development database and restoring it, with uploads, into the test database.
- `docker compose up` with MariaDB, API, web, AI service and Ollama: written and reviewed; not executed on this machine because Docker is not installed here. First run on a Linux host is a Release 2 slice 9 task.
- OpenAPI: `docs/openapi.json` (118 paths, 167 operations), regenerated with `pnpm --filter @smartschool/api openapi:export`.
- Getting-started guide: [14-GETTING-STARTED.md](14-GETTING-STARTED.md).

## 6. Known gaps carried into Release 2

Update, 6 October 2026: the review by checklist above is now backed by an attack suite that runs in CI; see docs/16 for the method, the three findings it produced and what remains untested.

- Lighthouse performance is 91 with applied throttling but 86 under the simulated profile, which extrapolates from a local server where every script finishes before the first paint. Tracked for the accessibility and performance slice; the remaining lever is a smaller framework bundle.
- Docker images untested on this machine (no Docker). Backup and restore drill done with the local database only.
- Manual accessibility audit and third-party penetration test not yet done.
- Standalone web build is Docker-only (Windows blocks the symlinks it needs).
