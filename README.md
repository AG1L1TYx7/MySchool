# SmartSchool

AI-native K-12 learning management system that runs entirely on local infrastructure. A Node.js LMS API on MySQL (XAMPP in development) is paired with a Python AI service that uses local language models through Ollama to tutor students, generate interactive H5P content, grade work, and coordinate autonomous agents.

This repository was started fresh on 30 September 2026 from the design in [docs/](docs/README.md). The previous implementation (C# API and Python AI service) lives in the old repository's git history and is the reference for the rebuild.

## Layout

```
smartschool/
├── apps/
│   ├── api/        @smartschool/api   Node.js LMS API (NestJS 11, Prisma 6), port 5000
│   ├── ai/         @smartschool/ai    Python AI service (FastAPI, Ollama), port 8000  [restored from the old repo in Release 1 slice 5]
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

## Quick start (development, Windows)

Prerequisites: Node 22 or newer, pnpm, XAMPP (MariaDB on port 3306), Ollama with `llama3.1:8b` and `llava`.

```powershell
pnpm install
copy appsapi.env.example appsapi.env      # fill DATABASE_URL, JWT_SECRET, AI_CALLBACK_TOKEN
pnpm --filter @smartschool/api prisma:deploy   # applies migrations to XAMPP MariaDB
pnpm --filter @smartschool/api db:seed         # feature catalogue, flags, demo school, one demo user per role
pnpm dev                                       # API: http://localhost:5000/swagger, /health
copy appsweb.env.example appsweb.env
pnpm dev:web                                   # Web: http://localhost:3000
```

Sign in with `teacher@smartschool.local` / `SmartSchool!Demo2026` (development seed; every role has a matching account).

## Status

Release 1 slice 1 (identity and access) is implemented: registration, sign-in with lockout, rotating refresh tokens with reuse detection, password reset, TOTP two-factor with backup codes, sessions, users, roles, a feature catalogue with per-role and per-user permissions, feature flags, and an audit log, plus the web pages for all of it. Next: slice 2, school and people (`/organizations`, `/students`, guardians, CSV import).

The full week-1 checklist, including freeing port 3306 from an existing MySQL 8 service, is in [docs/07-BUILD-PLAN.md](docs/07-BUILD-PLAN.md).
