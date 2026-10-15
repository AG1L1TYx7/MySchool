# 22. Penetration test brief

What an outside tester needs to attack SmartSchool properly: what it is, where to get a copy that is theirs to break, which accounts to use, what is in and out of scope, what has already been checked, and how to report. Written for the testing firm; the district's privacy officer can read it too.

## 1. What you are testing

SmartSchool is a learning platform for US K-12 schools: a web client (Next.js), an API (NestJS, MariaDB) and an AI service (Python, FastAPI, with Ollama models). People sign in as one of eight roles: platform administrator, superintendent (district), principal, teacher, counselor, assistant, student, parent. Students can be under 13; the product treats every student as a minor. Architecture: docs/01. Data model and classification: docs/03 and docs/17 (the data map). Threat model and the last internal audit: docs/21.

Hosts in a test deployment (docs/14, Docker Compose):

| Component | Address | Notes |
|---|---|---|
| Web client | `https://<host>/` | the only thing the public reaches; proxies `/api` to the API |
| API | `https://<host>/api/v1/...` | OpenAPI at `/swagger/openapi.json` when `SWAGGER_ENABLED=true` (ask for it on the test copy); 392 paths |
| AI service | internal only (`ai:8000` on the compose network) | reachable from the API with a bearer token; not meant to be public |
| Sockets | `/hubs/notifications`, `/hubs/messaging` | Socket.IO with the same access token |
| Public pages | `/login`, `/register`, `/status`, `/p/<slug>` (student portfolio pages), `/calendar/ical/<token>` feeds | no sign-in |

## 2. Your own copy to break

The tester gets a dedicated deployment with the demo seed, never a school's data. `docs/14` section 3 starts one with Docker Compose; the person who runs it sets `SEED_DEMO_DATA=true` so the demo school and its accounts exist, and `SWAGGER_ENABLED=true` so the route list is yours. Everything in it may be destroyed.

Accounts (password in `apps/api/prisma/seed.ts`, `DEMO_PASSWORD`): one per role at `<role>@smartschool.local` (`superadmin`, `superintendent`, `principal`, `teacher`, `counselor`, `assistant`, `student`, `parent`). Students and parents can also register with the join code `DEMO-2026`. Ask for a second school if you want to test school isolation with accounts you created yourself; the seed can be run twice with a different organisation name.

An API key (district role, `Integrations` in the web app) and an LTI platform registration are yours to create from the superintendent account; the AI service token is in the deployment's `.env.docker` if you need to talk to the service directly from inside the network.

## 3. Scope

In scope, with priority:

1. Authorisation across schools, roles and families: any read or write of another school's data, another family's child, or a role above your own (the suite in docs/16 probes forty id-based routes; find the forty-first).
2. Sign-in and sessions: password, two-factor, refresh cookie rotation and reuse, SSO (Google, Microsoft) and LTI launch linking, the native-client header, the device registration for push.
3. Student-supplied content: assignment submissions, discussion posts, portfolio projects, H5P content, uploaded files, messages, and the student code sandbox (`/code/lessons/:id/run`, ADR-013).
4. Administrator-supplied integration points: webhooks, roster sources, LTI platforms (the server fetches these; docs/21 F08), CSV imports, Common Cartridge and Canvas exports.
5. The AI tutor: prompt injection through lesson material and student messages, exfiltration of context, the safety layer for minors (`apps/ai/tests/corpus/prompt_injection.jsonl` is what we tried).
6. Public pages and feeds: the status page, portfolio pages, calendar feeds, verification and reset links.
7. Multi-tenancy: district policies, tenant-scoped data, branded sign-in domains.

Out of scope: denial of service and load beyond what one tester generates by hand; the Ollama model service and the models themselves; the hosting provider; social engineering of the people who run the test copy; third-party identity providers.

## 4. What has already been done, so you need not repeat it

- An internal audit of the code and configuration on 14 October 2026: docs/21 (41 findings, fixes in section 4, what is still open in section 5, including four product decisions that may still be unmade when you start; treat anything listed there as known).
- On every change: a route-by-role matrix, a cross-school probe, token forgery, enumeration, header and upload checks (docs/16 section 1); an OWASP ZAP passive scan of the web app and the API; dependency audits; the prompt-injection corpus against the rule layer.
- Browser checks: every page as every role, WCAG 2.2 AA, Lighthouse.

Not done, where we expect you to spend time: authenticated active scanning, business-logic abuse (grading, billing idempotency, consent flows), race conditions, the sandbox escape, SSO and LTI with real providers, and anything a person finds that a script does not.

## 5. Rules of engagement

- Only the test copy; never a school's deployment. Confirm the host with us in writing before the first request.
- Keep a log of what you ran and when; the test copy's audit log and request logs are available to you afterwards.
- If you find a way to reach student personal data of a kind the role should not see, stop at proof (one record) and report; do not export.
- Credentials and tokens you create are yours; do not reuse ours in reports.

## 6. Reporting

One finding per item: where (route, page or component), how (steps and a request), what it reaches (which data, which role), severity on CVSS 3.1 with the vector, and what you suggest. Findings that reproduce one of docs/21's open items can point at the item. We fix critical and high findings before the pilot continues and publish the summary in docs/16; the full report stays with the district's privacy officer.

Contact: the repository owner (GitHub `AG1L1TYx7`), who runs the test copy and answers questions within a working day.
