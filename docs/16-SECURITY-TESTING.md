# 16. Security testing

How SmartSchool is attacked before it is trusted, what the first pass found on 6 October 2026, and what is still not tested. docs/11 holds the rules the product must meet; docs/15 holds the Release 1 review by checklist. This document is about trying to break it.

## 1. What runs on every change

`apps/api/test/security.e2e-spec.ts` is part of the e2e suite, so CI runs it on every push. It does not read a list of expected answers; it derives them from the code and from live accounts, so a new route or a new role is covered the day it appears.

| Check | How | Fails when |
|---|---|---|
| Every route is guarded | `test/route-catalog.ts` reads every controller and lists each handler with its access decorators | a handler has no feature, no public marker and no class-level token guard, and is not on the short list of self-service routes (sign-in, profile, health, metrics, the play tickets and calendar tokens that carry their own secret) |
| No token, no entry | every non-public route called with no credentials | anything but 401, or a stack trace in the body |
| Features mean what they say | every route called as each of the eight roles with an empty body and with hostile junk (SQL fragments, script tags, path traversal, negative and huge numbers) | a role without the feature gets anything but 403; any role gets a 500; any response contains a password hash, two-factor secret, provider secret or token hash |
| Schools cannot see each other | a second school with its own principal, teacher, student and parent is created inside the test and each of them probes forty id-based routes with the demo school's real ids | any 200 whose body names the demo school's objects, or any 500 |
| Families see only their child | the second school's parent reads the family home and the students list | any child but their own |
| No account enumeration | sign-in with an unknown email and with a wrong password; password reset and verification resend for unknown emails | different status or wording between the two cases |
| Tokens cannot be forged | a token with the role rewritten in the payload, a token with a bad signature, a token that is not a token | anything but 401 |
| No privilege through self-service | a student updates their profile with role, organisation, features and status; registers as a principal; edits a teacher's role | the role or school changes, or the request succeeds |
| Cookie routes need the anti-forgery header | refresh with a cookie but without `X-Requested-With` | anything but 403 |
| Hardening headers | the health route's headers | missing `nosniff`, frame options or HSTS, or a server banner |
| Stored HTML is defanged | an H5P question written with a script, an event handler, a frame and a javascript: link | any of them survives in what is stored or served |
| File names are safe | an upload named with traversal and tags; a download path with traversal | the name survives unchanged, or the download answers anything but 400 or 404 |
| Dynamic scan (slice 29) | the `Browser zap` CI job runs OWASP ZAP's passive baseline over the running web app (spidered from the public pages) and over every API route from the OpenAPI document (`tools/zap/run.mjs`); `tools/zap/zap-rules.mjs` decides | any alert at medium or high that is not on the accepted list with a written reason; low and informational alerts are printed and kept in the `browser-zap` artifact |
| Prompt injection (slice 29) | `apps/ai/tests/corpus/prompt_injection.jsonl`: override phrasings, exfiltration asks, benign lookalikes, data that tries to leave its block, and canaries; `test_injection_corpus.py` runs the rule layer and the block fence over it on every change | an override phrasing passes the rules, a benign question is blocked, or a delimiter inside data survives `app/injection.py` |

Besides the suite: `pnpm audit --audit-level=high` and `pip-audit` fail CI; `pnpm audit --audit-level=moderate` is checked by hand each slice; the two ignored advisories are a dev-only pattern (`braces` through the Next lint preset) and a dev-only string formatter (`sprintf-js` through Jest's coverage chain) with no patched version. Since slice 27 two more are ignored: `extract-zip` (GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3), a dev-only archive extractor reached only through Lighthouse's own browser downloader, which the checks never call because Playwright supplies Chromium; it has no patched version. `basic-ftp` on the same chain is pinned to a patched version.

## 2. Findings of the first pass (6 October 2026) and what was done

| Finding | Severity | Fix |
|---|---|---|
| A student or parent of one school could read another school's course outline and lesson titles through the progress-map route, because that route only checked the student, not the course's school | medium (information disclosure across tenants; no grades or names, but course content) | the route now checks the course's school for every caller; covered by the cross-school probe |
| H5P parameters were stored and served exactly as typed, and H5P renders them as HTML, so a teacher or an AI draft could plant a script that runs in every student's browser | medium (stored cross-site scripting; authors are staff, viewers are children) | every string in the parameters passes an allow-list sanitiser on create and update: formatting stays, scripts, frames, styles, event handlers and javascript: links go; unit-tested |
| District roles got 500 instead of 404 on fifteen school-scoped routes when the school id did not exist (the scope check passed, the record lookup threw) | low (robustness; no data) | the exception filter now maps database not-found, duplicate and in-use errors to 404, 409 and 409 problems, for every route at once |
| The route catalogue's own first version missed a decorator form, which would have let a real gap hide | none in the product | the catalogue understands spread decorators and names the one route that is deliberately feature-less (the feature catalogue itself, read-only, authenticated) |

Everything else the suite checks already held: every other route guarded, 401 without a token, no 500 on junk for school roles, no secret fields anywhere, no enumeration, tokens unforgeable, self-service cannot escalate, the anti-forgery header enforced, headers set, file names cleaned.

## 2b. Second pass (7 October 2026, slice 19)

The route catalogue grew by the learning, insight, mobile, push and compliance routes and every one is covered by the role matrix and the second-school probes automatically. New probes: school B's family and staff against school A's records export, deletion requests, legal hold and incidents; a device token registered by one person cannot be removed by another; a replayed tutor message with a known client id never produces a second answer. Found and fixed: a principal or counselor of another school could read a class's mastery summary and learning curve (the learning module checked the school only for counselors); the records export is limited in the service to the family, counselors and administrators even though record readers can reach the route. No new vulnerability class was found.

## 2c. Third pass (7 October 2026, slice 22)

The id-based probe in `test/security.e2e-spec.ts` caught a real gap once the library spec left a teacher's upload in school A: a principal of school B could read `GET /files/{id}` for that file, because the file-manager branch of `findAccessible` checked the feature but not the organisation. Fixed by requiring the same organisation on that branch (district roles keep their reach). The library routes themselves were added to the catalogue check and the per-role feature sweep with no findings; library visibility is decided by `canSee` in `library-rules.ts`, unit-tested for every reach and role.

## 2d. Security audit (14 October 2026)

A full audit of the code, configuration and dependencies (docs/21) found 41 issues: one critical and eleven high, of which the ones that need no product decision are fixed (outbound URL guard, proxy trust, log redaction, streamed-answer moderation, API-key reach, per-account throttling, zip and sandbox limits, AI production checks, student field exposure, user-management reach, seed guard, open redirect) along with the mediums and lows (CSV guard, download headers, CSP, SMTP auth, query-string tokens, join-code and mail cooldowns, push token ownership, AI docs gating, opener, noindex, URL schemes, LTI key refetch and client id, Next.js patch). Four findings change how people sign in or the schema and wait for a decision (docs/21 section 5). The route matrix and the cross-school probe in this suite ran unchanged and green after the fixes; the per-route limits were tuned so the matrix (fourteen calls per route) stays under them.

Advisories ignored on purpose, all development-only: `GHSA-jmr9-qjv8-65gv` and `GHSA-7pqw-9j4j-h8q3` (extract-zip, in Lighthouse's browser download) and the OpenTelemetry instrumentation moderates reached through Lighthouse's Sentry dependency (`GHSA-qqmp-wf37-98f9`, `GHSA-8988-4f7v-96qf`); none is installed in the API, web or AI images, and CI fails on high and above.

## 3. Not tested yet, and honest about it

- **A human penetration test.** The suite is systematic but it only asks the questions we thought of. A third party should attack a test copy before a district signs the data-privacy agreement (docs/13 section 10); the brief they need is docs/22.
- **Active dynamic scanning.** Since slice 29 ZAP's passive rules run in CI over the web app and the API; an authenticated active scan (injection payloads against every parameter) is not run, because it needs a dedicated copy and hours, so it is the penetration tester's (docs/22).
- **Prompt injection against the real model.** The corpus runs against the rule layer and the block fence on every change (slice 29); the live run (`OLLAMA_LIVE=1 pytest apps/ai/tests/test_injection_live.py`, canaries in lesson material must never reach the student) is by hand before a release, since the chat model does not fit a CI runner. Last live run: not yet.
- **Resource exhaustion.** Per-IP rate limits exist and are tested; per-account limits on expensive AI routes are only the daily tutor quota.
- **Backup and secret handling** are reviewed by checklist (docs/15), not attacked.
- **Physical and operational** matters (who holds the server, how logs are retained) are the district's, documented in docs/14.

## 4. How to run it by hand

```
cd apps/api
DATABASE_URL=<the test database> node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json test/security.e2e-spec.ts
```

It prints every failing probe by route and role, so a regression reads as a sentence, not a count.
