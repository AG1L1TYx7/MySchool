# Getting Started

**Version:** 1.0, 2 October 2026. For the person installing SmartSchool for a pilot school, and for a developer setting up a workstation.

Two ways to run it: **Docker** (a pilot server, one command) or **workstation** (XAMPP or any MariaDB, for development). Both end with the same product: the API on port 5000, the web app on 3000, the AI service on 8000, Ollama on 11434.

## 1. What you need

| Component | Pilot server (Docker) | Workstation |
|---|---|---|
| Docker Engine 24+ with Compose | yes | no |
| Node.js 22 and pnpm 10 (`corepack enable`) | no | yes |
| Python 3.12+ | no | yes |
| MariaDB 10.4+ or MySQL 8 | included | XAMPP or your own; note the port |
| Ollama with `llama3.1:8b` and `all-minilm` | included | install from ollama.com, then `ollama pull llama3.1:8b` and `ollama pull all-minilm` |
| GPU | recommended: an 8 GB NVIDIA card gives tutor replies in 1 to 3 s; without one replies take 20 to 60 s | same |
| Disk | 20 GB for the model, database and uploads | same |
| A domain and TLS certificate | for anything beyond localhost | not needed |

## 2. Pilot server with Docker

```bash
git clone https://github.com/AG1L1TYx7/MySchool.git smartschool
cd smartschool
cp .env.docker.example .env.docker
# Fill in every secret. Generate one with:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
docker compose --env-file .env.docker up -d --build
```

The first start downloads the two models (about 5 GB) and applies the database migrations. Then:

```bash
docker compose --env-file .env.docker run --rm api pnpm db:seed    # demo school, optional
docker compose --env-file .env.docker logs -f api web ai           # watch it come up
```

Open `http://<server>:3000`. Put a reverse proxy with TLS in front (Caddy or nginx) and set `WEB_APP_URL` to the public address; the sign-in cookie is marked secure in production and will not work over plain HTTP from another machine.

GPU: on a machine with NVIDIA drivers and the NVIDIA Container Toolkit, add to the `ollama` service in `docker-compose.yml`:

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

## 3. Workstation

```bash
git clone https://github.com/AG1L1TYx7/MySchool.git smartschool
cd smartschool
pnpm install
```

**Database.** Create a database and a user (XAMPP users: `C:\xampp\mysql\bin\mysql.exe -u root`, and remember XAMPP may listen on 3307 if another MySQL holds 3306):

```sql
CREATE DATABASE smartschooldb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE smartschooldb_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smartschool'@'localhost' IDENTIFIED BY '<password>';
GRANT ALL ON smartschooldb.* TO 'smartschool'@'localhost';
GRANT ALL ON smartschooldb_test.* TO 'smartschool'@'localhost';
```

**API.**

```bash
cd apps/api
cp .env.example .env            # set DATABASE_URL, JWT_SECRET, AI_CALLBACK_TOKEN, AI_SERVICE_API_KEY
pnpm prisma:generate
pnpm prisma:deploy              # applies migrations
pnpm db:seed                    # demo school and accounts
pnpm start:dev                  # http://localhost:5000, Swagger at /swagger
```

**AI service.**

```bash
cd apps/ai
py -3.12 -m venv .venv          # or python3 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"      # Linux and macOS: .venv/bin/pip
copy .env.example .env          # AI_SERVICE_TOKEN = the API's AI_SERVICE_API_KEY; LMS_SERVICE_TOKEN = the API's AI_CALLBACK_TOKEN
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

**Web.**

```bash
cd apps/web
pnpm h5p:setup                  # downloads the H5P player and content libraries (once)
pnpm dev                        # http://localhost:3000
```

## 4. Demo accounts

Password for all: `SmartSchool!Demo2026`. School join code for self-registration: `DEMO-2026`.

| Role | Email |
|---|---|
| District administrator | superadmin@smartschool.local |
| Superintendent | superintendent@smartschool.local |
| Principal | principal@smartschool.local |
| Teacher | teacher@smartschool.local |
| Student (Emma Johnson) | student@smartschool.local |
| Parent (of Emma) | parent@smartschool.local |
| Assistant | assistant@smartschool.local |

In development, email verification is optional and the registration screen shows the verification link directly.

## 4a. Rostering and single sign-on

Sign-in buttons appear on the login page when the API has credentials for a provider (`SSO_GOOGLE_CLIENT_ID` and `SSO_GOOGLE_CLIENT_SECRET`, likewise `SSO_MICROSOFT_*`, `SSO_CLEVER_*`, `SSO_CLASSLINK_*`). Register this redirect URL with the provider: `<WEB_APP_URL>/api/v1/auth/sso/<provider>/callback`. Then, as a principal, open the organisation page, enable the provider under Sign-in and list the allowed email domains.

Rostering: on the same page, connect the district's OneRoster API, ClassLink or Clever source, press Preview to see what would change, then Sync now; or import a OneRoster CSV bundle exported from the SIS. Synced people and classes are read-only in SmartSchool and refresh nightly.

## 5. Backups

```bash
pnpm db:backup                                   # backups/<db>-<timestamp>.sql.gz and .uploads.tar.gz
pnpm db:restore backups/<file>.sql.gz --uploads backups/<file>.uploads.tar.gz --yes
```

The backup is a consistent dump plus the uploads folder. Schedule it nightly (cron, Task Scheduler) and copy the files off the server. Restore refuses to run without `--yes`. After restoring an older backup, run `pnpm --filter @smartschool/api prisma:deploy` to bring the schema forward.

## 6. Checks before you call it ready

```bash
pnpm --filter @smartschool/api test            # unit
pnpm --filter @smartschool/api test:e2e        # against smartschooldb_test, needs the seed
pnpm --filter @smartschool/web typecheck && pnpm --filter @smartschool/web lint
cd apps/ai && .venv\Scripts\python -m pytest -q && .venv\Scripts\python -m ruff check app tests && .venv\Scripts\python -m mypy app
```

Load test for a 10,000-student school (needs a running API):

```bash
pnpm load:seed        # adds "Load School" with 10,000 students, 400 classes, graded work
pnpm load:test        # 60 connections for 20 s per scenario; results in docs/load-test.json
```

The API documentation is at `/swagger` on a running API and in `docs/openapi.json` (regenerate with `pnpm --filter @smartschool/api openapi:export`).

## 7. Updating

```bash
git pull
pnpm install
pnpm --filter @smartschool/api prisma:deploy
# Docker: docker compose --env-file .env.docker up -d --build
```

Migrations are forward-only and applied automatically by the API container at start. Take a backup first.

## 8. Where things are

| Path | What |
|---|---|
| `apps/api` | NestJS API, Prisma schema and migrations, seeds, e2e tests |
| `apps/web` | Next.js web app |
| `apps/ai` | FastAPI AI service, prompts, tests |
| `docs` | design docs; start with `docs/README.md` |
| `tools` | backup, restore and load-test scripts |
| `backups` | local backups (git-ignored) |
