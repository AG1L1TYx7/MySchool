# SmartSchool

AI-native K-12 learning management system that runs entirely on local infrastructure. A Node.js LMS API on MySQL (XAMPP in development) is paired with a Python AI service that uses local language models through Ollama to tutor students, generate interactive H5P content, grade work, and coordinate autonomous agents.

This repository was started fresh on 30 September 2026 from the design in [docs/](docs/README.md). The previous implementation (C# API and Python AI service) lives in the old repository's git history and is the reference for the rebuild.

## Layout

```
smartschool/
├── apps/
│   ├── api/        @smartschool/api   Node.js LMS API (NestJS 11, Prisma 6), port 5000
│   ├── ai/         @smartschool/ai    Python AI service (FastAPI, Ollama), port 8000  [restored from the old repo in Phase 4]
│   └── web/        @smartschool/web   Next.js client, port 3000                        [Phase 11]
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
| [docs/07-BUILD-PLAN.md](docs/07-BUILD-PLAN.md) | Phased build plan on XAMPP MySQL |

## Quick start (development, Windows)

Prerequisites: Node 22 or newer, pnpm, XAMPP (MariaDB on port 3306), Ollama with `llama3.1:8b` and `llava`.

```powershell
pnpm install
copy apps\api\.env.example apps\api\.env      # fill DATABASE_URL and JWT_SECRET
pnpm --filter @smartschool/api prisma:migrate  # creates the schema in XAMPP MariaDB
pnpm --filter @smartschool/api dev             # http://localhost:5000/swagger, /health
```

The full week-1 checklist, including freeing port 3306 from an existing MySQL 8 service, is in [docs/07-BUILD-PLAN.md](docs/07-BUILD-PLAN.md).
