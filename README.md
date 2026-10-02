# SmartSchool

AI-native K-12 learning management system that runs entirely on local infrastructure. A Node.js LMS API on MySQL (XAMPP in development) is paired with a Python AI service that uses local language models through Ollama to tutor students, generate interactive H5P content, grade work, and coordinate autonomous agents.

This repository was started fresh on 30 September 2026 from the design in [docs/](docs/README.md). The previous implementation (C# API and Python AI service) lives in the old repository's git history and is the reference for the rebuild.

## Layout

```
smartschool/
├── apps/
│   ├── api/        @smartschool/api   Node.js LMS API (NestJS 11, Prisma 6), port 5000
│   ├── ai/         @smartschool/ai    Python AI service (FastAPI, Ollama), port 8000  [built fresh in Release 1 slice 5, ADR-021]
│   └── web/        @smartschool/web   Next.js 14 client, port 3000 (proxies /api/* to the API)
├── packages/       shared code when a second app needs it
├── docs/           system architecture, feature catalog, data model, contracts, ADRs, build plan
└── .github/        CI
```

## Start here

| Document | Purpose |
|---|---|
| [docs/README.md](docs/README.md) | Index of the design set and how to read it |
| [docs/01-SYSTEM-ARCHITECTURE.md](docs/01-SYSTEM-ARCHITECTURE.md) | System design |
| [docs/02-FEATURE-CATALOG.md](docs/02-FEATURE-CATALOG.md) | What the product does, domain by domain |
| [docs/03-DATA-MODEL.md](docs/03-DATA-MODEL.md) | Tables, relationships, enums |
| [docs/04-INTEGRATION-CONTRACTS.md](docs/04-INTEGRATION-CONTRACTS.md) | Every boundary the system crosses |
| [docs/05-ADR.md](docs/05-ADR.md) | Decision records |
| [docs/07-BUILD-PLAN.md](docs/07-BUILD-PLAN.md) | Three releases as vertical slices, on XAMPP MySQL |
| [docs/08-PRODUCT-STRATEGY.md](docs/08-PRODUCT-STRATEGY.md) | Why it is outstanding: competitors, differentiators, quality bar |
| [docs/09-API-DESIGN.md](docs/09-API-DESIGN.md) | API conventions and the Release 1 resource map |
| [docs/10-AI-SYSTEM-DESIGN.md](docs/10-AI-SYSTEM-DESIGN.md) | Agentic AI design, prompts, safety, evaluation |
| [docs/11-QUALITY-AND-SECURITY.md](docs/11-QUALITY-AND-SECURITY.md) | Definition of done, security checklist, performance rules |
| [docs/12-UX-MOTION-AND-GAMIFICATION.md](docs/12-UX-MOTION-AND-GAMIFICATION.md) | Motion system and gamified experience required on every screen |

## Quick start (development, Windows)

Prerequisites: Node 22 or newer, pnpm, XAMPP MariaDB (port 3307 on the development machine, see docs/07 section 2.1), Ollama with `llama3.1:8b` and `llava`.

```powershell
pnpm install
copy appsapi.env.example appsapi.env      # fill DATABASE_URL, JWT_SECRET, AI_CALLBACK_TOKEN
pnpm --filter @smartschool/api prisma:deploy   # applies migrations to XAMPP MariaDB
pnpm --filter @smartschool/api db:seed         # feature catalogue, flags, demo school, one demo user per role
pnpm dev                                       # API: http://localhost:5000/swagger, /health
copy appsweb.env.example appsweb.env
pnpm dev:web                                   # Web: http://localhost:3000
```

Sign in with `teacher@smartschool.local` / `SmartSchool!Demo2026` (development seed; every role has a matching account). Students and parents can also self-register with the demo join code `DEMO-2026`.

## Status

Release 1 slices 1 and 2 are implemented. Slice 1 (identity and access): registration, sign-in with lockout, rotating refresh tokens with reuse detection, password reset, TOTP two-factor with backup codes, sessions, users, roles, a feature catalogue with per-role and per-user permissions, feature flags, and an audit log. Slice 2 (school and people): organisations with members, student records, guardians with invitations, CSV import with dry run and per-line errors, CSV export. Slice 3 (courses and classes): course builder with modules, lessons, reordering, publishing, cloning and prerequisites; classes with teachers, capacity, waitlist and enrolment; "my classes" for students, parents and teachers. All have web pages. The sign-in system follows the hardening in docs/11 (HttpOnly refresh cookie, email verification, school join codes, common-password checks, replay-safe 2FA, mandatory 2FA for administrators in production). The AI service is designed in docs/10 with its prompt library in `apps/ai/prompts`. Slice 4 (assignments, grades, attendance, files): rubrics, assignments with due dates, late windows, penalties and attempt limits, online submissions with uploaded files, grading with rubric scores, a weighted gradebook with CSV export, attendance marking and summaries. Slice 5 (AI tutor): a fresh Python AI service with prompt library, safety classifier, math tool, lesson retrieval and streaming; tutor conversations in the API with quotas, feedback and an internal tool API; a chat UI with explain, guided and homework modes. Slice 6 (AI content to H5P): teachers generate quizzes and flashcards from a topic or lesson, review and edit every item, preview, publish, attach to an assignment; students play them in the H5P player and the score posts to the gradebook. Next: slice 7, communication.

The full week-1 checklist, including freeing port 3306 from an existing MySQL 8 service, is in [docs/07-BUILD-PLAN.md](docs/07-BUILD-PLAN.md).
