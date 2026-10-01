# Prompt library

Versioned system prompts for the SmartSchool AI service (design: `docs/10-AI-SYSTEM-DESIGN.md`, section 6).

- One file per capability and profile: `<agent>/<profile>@<version>.md`. The front matter declares the capability, model, sampling settings and the output schema.
- `{{placeholders}}` are rendered by the AI service from the Context Envelope; prompts never contain student data at rest.
- A new version is a new file. The old file stays until no result in the LMS references it (results store `promptVersion`).
- Every change ships with its evaluation run (`apps/ai/evals/<capability>/`) and must not drop a capability below the thresholds in the design document, section 8.

| File | Capability |
|---|---|
| `tutor/default@1.md` | tutor.chat |
| `tutor/socratic@1.md` | tutor.socratic |
| `tutor/homework-help@1.md` | tutor.homework_help |
| `content/quiz@1.md` | content.quiz |
| `content/flashcards@1.md` | content.flashcards |
| `content/lesson-plan@1.md` | content.lesson_plan |
| `grader/rubric@1.md` | grading.rubric |
| `insight/teacher@1.md` | insight.teacher |
| `insight/parent@1.md` | insight.parent |
| `safety/classify@1.md` | safety.classify |
| `shared/json-repair@1.md` | shared.json_repair |
