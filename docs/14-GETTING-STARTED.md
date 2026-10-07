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

## 4b. School year, bell schedule and attendance codes

As a principal, open the organisation page and scroll to School structure: tick the grades the school serves, set the time attendance is due each day, add the school year with its terms and grading periods, add a bell schedule with its periods, and adjust the attendance codes (the seven defaults cover present, tardy, excused, unexcused, remote, field trip and suspended). Classes then pick a term, a period and a grade level; the attendance sheet shows the codes and the period. The office view at /attendance/today lists classes that still owe attendance and downloads the average daily attendance and chronic absenteeism CSVs. Everyone has a calendar at /calendar with a private subscription link for phones and Google Calendar.

## 4c. Grading, standards and report cards

On the organisation page, set the letter cutoffs and GPA points the district uses and, for standards-based classes, the proficiency levels. Each teacher opens their class and sets the grading mode, the weighted categories (for example Homework 30, Quizzes 30, Tests 40 with the lowest homework dropped), the late work policy and the syllabus; students and parents see the policy and syllabus on the class page. Assignments pick a category, a grading period and the standards they assess; Common Core, NGSS and a Texas sample set are included, and a district imports its own from a CASE file on the Standards page. The gradebook shows marks (Missing counts as zero, Excused is left out), dropped scores and category totals, with a standards view for standards-based classes. At the end of a grading period an administrator generates report cards for the school (or a teacher for one class), teachers add comments, and the office publishes them; students and parents are notified and can download the PDF.

## 4d. Support and safety

Add counselors as users with the Counselor role (the demo has counselor@smartschool.local). On a student's page, their teachers, counselors and administrators record the IEP or 504 plan; the student then gets extended time on due dates, read-aloud buttons, larger text, reduced motion and a quieter layout automatically, and parents can read the plan. Counselors keep private notes there that nobody else sees and manage their caseload at /caseload. When a student says something to the AI tutor that needs a trusted adult, counselors and the principal are notified and work it at /wellness. On the organisation page, set which behaviour records families see, whether the school consents to AI features for students under 13 or asks parents first, and whether students may message classmates. Parents grant or decline AI features on their child's page.

## 4e. Families and Spanish

Parents and students see My family: every linked child with the current grade in each class, attendance for the last 30 days, missing work, what is due this week and what was graded, with a preview of the weekly email. The language menu in the header (and on the sign-in page) switches the whole family-facing interface between English and Spanish; the choice is saved on the account, so alerts and the weekly email arrive in that language too. Missing-work alerts go out on school-day afternoons and the weekly summary on Sunday evenings to guardians who keep those notices on under Notifications. On a lesson, a teacher asks the AI for a family summary in Spanish or English, edits it, and releases it; families only ever see released summaries, labelled as AI-generated and reviewed. On a student's page, teachers and counselors draft conference talking points from that student's own records; families never see them.

## 4f. Motivation

Students earn XP for finishing lessons (the Mark lesson finished button at the end of a lesson), turning work in, turning it in on time, beating their previous score and perfect scores; levels and titles grow with XP, and a streak counts school days in a row with a freeze token covering one missed day. Badges unlock from the same actions, and teachers award Kindness, Helper and Leader badges or extra points with a reason from the class Motivation page, where they also start class quests (a shared goal that everyone's work counts toward). Every Monday each student gets a few personal quests for the week. Students see all of this under My progress and on their dashboard; parents see it on My family. Nobody is ranked against anybody: students never see each other's numbers, and the console lists students alphabetically. The school can turn the whole thing off on the organisation page.

## 4g. Teacher assistant

Teachers open Teacher assistant in the sidebar. Lesson plans: name a topic and a class, get a timed plan built from the course outline, edit it, publish it and put it on a date; it then shows on the Planner. Grading: pick an assignment, press Suggest grades, and the AI scores each text submission against the rubric with quoted evidence and a confidence; approve, change or reject each one, or approve all the confident ones at once; anything the AI is unsure about waits for you. Families: draft an email to a family (in Spanish if the family prefers) from that student's own numbers and send it as a message, or draft a report-card narrative and apply it to the draft report card. Differentiation: adapt a lesson to support, core and extension levels and create them as unpublished lessons. Class insight: build this week's briefing from the tutor's traces, missing work, scores and attendance, then make a practice set on the stuck topic. On a class page, Substitutes gives a colleague the class until a date; access ends by itself.

## 4h. Learning records and practice

Sign in as the student and open Practice. Add cards from the published flashcard set (or write your own), then review: show the answer and rate it 0 to 5. The tenth review of the day earns practice XP. The Progress tab shows mastery by skill and the learning curve. Finish a lesson on a course page to see a module ring fill on the course page and a skill appear under mastery. As the teacher, open a class and choose Learning for the class curve, the standards with band bars and who needs help. As the principal, `GET /api/v1/organizations/{id}/xapi/export` returns the full statements for an external record store.

## 4i. Insight and scheduled reports

Sign in as the principal: the dashboard opens with a School today card, and Insight in the menu shows the overview (attendance taken, missing work by grade, failing students by class, gradebook completeness, AI usage, activity). The Reports tab downloads any report as CSV and lets you schedule one by email to staff addresses; Run now builds it immediately and says honestly whether a mail transport delivered it (set SMTP_HOST to send for real). Open a class and choose Insight for the class picture. On a student's page the Insight card has the transcript download; families get the same download on their home page.

## 4j. Mobile and push

There is no native app yet, but the API a phone would use is live: sign in, then call `GET /api/v1/mobile/home` and `GET /api/v1/mobile/sync` with the bearer token (Swagger lists them under Mobile). Register a device with `POST /api/v1/me/devices` and press "Send a test" on the Notifications page: without a Firebase key the test is recorded as simulated and the page says so; set `FIREBASE_SERVICE_ACCOUNT_JSON` to the service account JSON to send for real. To see the tutor work offline, open a conversation, switch the browser to offline in developer tools, send a message (it shows "Waiting to send"), then go back online: it is sent and answered once.

## 4k. Compliance

Sign in as the principal and open Compliance. The Data map tab lists every table that holds personal data with live counts; Retention sets how long each kind of record is kept and Apply now runs the nightly job immediately; Deletion requests shows what families asked for, with approve, decline and erase now; Incidents opens a security incident on the breach clock and notifies every administrator. As the parent, the family home has Your records: download a copy of the records as a zip, or ask the school to erase them. On a student's page, Records and retention has the export and the legal hold. Press Tab on any page: the first stop is "Skip to main content".

## 4l. District and tenants

Sign in as the superintendent and open District. Overview shows every school in the district on one line with the totals above; Reports downloads the cross-school CSVs; Policies switches AI off for the district or for named schools, decides whether schools may allow student-to-student messaging, lists feature codes to switch off district-wide and sets retention defaults; State reporting downloads the enrollment, attendance, discipline and grades files. As the platform administrator, Tenants creates a district, gives it a custom domain and shows the DNS record to add before pressing Verify; the District page then has a district picker. The sign-in page takes its name and colour from the district behind the host: set `TENANT_BASE_DOMAIN` (default `localhost`) so `beta.<base domain>` resolves the tenant with slug `beta`, or open `/login` on a verified custom domain.

## 4m. Integrations

Sign in as the principal and open Integrations. Webhooks: add an https endpoint (http is allowed on localhost while developing), tick the events, copy the secret shown once, press Send test and open Deliveries to see the attempt; a receiver checks `X-Webhook-Signature` as the sha256 HMAC of `timestamp.body`. API keys: name the key, tick its scopes, copy the key shown once and call the API with `X-Api-Key`; revoke it from the list. LTI 1.3: the first card shows the URLs to register SmartSchool in Canvas (or use `/api/v1/lti/config.json?organizationId=`), then add the platform's issuer, client id, authorization and JWKS URLs; under Tools register an outside tool and give it the details shown, after which Open appears on every class page. On a gradebook, For Canvas and For Google Classroom download grade sheets in those layouts. On the audit log, Export CSV downloads the filtered trail. Set `API_PUBLIC_URL` to the address platforms and tools reach the API at.

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
