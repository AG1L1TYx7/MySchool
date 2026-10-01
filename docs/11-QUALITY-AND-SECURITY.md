# 11. Quality and security bar

Status: binding for every slice from Release 1 slice 1 onward (1 Oct 2026). This is what "well tested, optimised, no known vulnerabilities" means in practice. No one can promise zero bugs; this document promises that every known class of defect has a check that runs before code lands.

## 1. Definition of done for a slice

A slice is done only when all of the following are true and visible in CI:

1. **Unit tests** for every pure rule (permissions, enrolment, import parsing, token logic, password policy, TOTP, CSV, ids). Target: every branch in a rule file is exercised.
2. **End-to-end tests** against a real database for every endpoint added, covering: the happy path, validation failure (400 problem details), authentication failure (401), authorisation failure (403 naming the feature), cross-organisation access (404 or 403, never data), and the state-changing side effects (audit row, event, counts).
3. **Security tests** (section 3) for any change touching auth, permissions, uploads, or queries built from user input.
4. **Static gates**: ESLint with type-aware rules, `tsc --noEmit`, Prettier, `pnpm audit` at high severity reviewed (the job reports; a high advisory with no fix is documented in `docs/05-ADR.md` with the mitigation).
5. **Performance review** (section 4): list endpoints paginate, every filter has an index, no N+1 in the request path, large bodies are capped.
6. **Docs updated**: `09-API-DESIGN.md` for routes, `03-DATA-MODEL.md` for tables, `07-BUILD-PLAN.md` status, README quick start if commands changed.
7. **Walk-through**: the feature is used through the web client with the demo accounts for each role that can see it.

## 2. Test pyramid and tooling

| Layer | Tool | Where | Runs |
|---|---|---|---|
| Unit | Jest | `apps/api/src/**/*.spec.ts` | every push, no database |
| End to end | Jest + supertest, real MariaDB 10.4 and MySQL 8 | `apps/api/test/*.e2e-spec.ts` | every push, CI matrix, after migrate and seed |
| Web | ESLint, `tsc`, `next build`; Playwright flows from slice 4 | `apps/web` | every push |
| AI | golden sets and red-team sets with deterministic checks and judge prompts | `apps/ai/evals` | every prompt or model change (slice 5 onward) |
| Load | k6 smoke (50 virtual users, 2 minutes) on list and login endpoints | `tools/load` | before each release |

Test data: every e2e suite creates and removes its own records and never depends on another suite's ordering. The seed provides stable demo accounts and one of everything.

## 3. Security checklist (reviewed per slice)

Identity and session
- Passwords: argon2id, 12+ characters with mixed classes, common-password denylist, no email or name inside the password; imported hashes upgraded on login.
- Sign-in: constant-time behaviour for unknown accounts, per-IP throttling, per-account lockout with notification, audit row for every attempt that changes state.
- Tokens: short-lived access JWT in memory only; refresh token in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie scoped to the auth path, rotated on every use, family revoked on reuse, absolute lifetime cap; sessions listable and revocable; all sessions revoked on password change or reset.
- Two-factor: TOTP with encrypted secret, replay protection by time step, hashed single-use backup codes, required for administrator roles in production.
- Registration: students and parents only; staff are invited; organisation membership only through an invitation or a join code; email verification before the account is usable; identical responses whether or not the email exists.
- Email flows: hashed single-use tokens with expiry; reset invalidates sessions.

Authorisation
- Every route declares a feature code; the guard denies by default. Ownership and organisation scoping live in services and are tested with a cross-organisation account in every slice.
- Students and parents only ever see their own records; this is tested explicitly per resource.
- Privileged role changes are limited by the hierarchy and audited.

Input and output
- All bodies validated with whitelisting; unknown fields dropped; sizes capped (JSON 5 MB, CSV 10 MB, file uploads per policy).
- CSV output guards against formula injection; file names are sanitised; uploads are type-checked and stored outside the web root (slice 4).
- Errors never leak stack traces, SQL or internal ids beyond the resource id; every problem response carries a trace id for support.
- Security headers on both the API (helmet) and the web client (CSP, frame denial, referrer policy, permissions policy, HSTS in production).

Secrets and configuration
- Secrets only from the environment; placeholders refused in production; `.env` never committed; generated credentials for development.
- Service-to-service calls (AI) authenticated with a dedicated token; callbacks verified.
- Dependency audit in CI; lock file committed; build scripts allow-listed in pnpm.

Data protection
- Minimum personal data in AI prompts; pseudonymised prompt logs with retention; soft delete where history matters, hard delete for student data on request (Release 2 data-subject tooling).
- Audit log for every write to identity, permissions, students, grades and settings.

## 4. Performance rules

- Every list endpoint paginates (max 200) and sorts only on allow-listed, indexed columns.
- Every `where` used by a list has a covering or leading index; new filters add an index in the same migration.
- Counts and aggregates are computed with `groupBy` or `count`, never by loading rows.
- No query inside a loop in request handlers (imports batch their lookups; rosters load students in one query).
- Response payloads expose only the fields the client renders; detail endpoints include related summaries, not whole related rows.
- Long work (imports over 1,000 rows, AI generation, exports over 10,000 rows) runs as a job with `202` and polling.
- Caches: permissions (5 min per user), feature flags (1 min), AI content (24 h per request signature); every cache has an explicit invalidation path.
- Budgets: p95 under 300 ms for list and detail endpoints on the reference XAMPP machine with 10,000 students; sign-in under 500 ms including argon2.

## 5. Review and release

- Every pull request lists which checklist items apply and how they were tested.
- Before each release: full e2e on both database engines, load smoke, dependency audit, a manual pass through the security checklist by someone other than the author, and a backup and restore drill of the production database.
- Known gaps are written down in `docs/07-BUILD-PLAN.md` under the release, never left implicit.
