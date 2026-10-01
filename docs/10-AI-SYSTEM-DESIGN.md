# 10. AI System Design: agents, tools, prompts, evaluation

Status: approved design, revision 1 (1 Oct 2026). Supersedes the "restore the old Python service" approach (ADR-021). Implementation starts in Release 1 slice 5 and continues through Release 2.

## 0. Honest starting point

The previous AI service had 155 routes, several of which were partial or stubbed, no evaluation harness, prompts embedded in code, a contract drift with the LMS, and no written agent design. Restoring it would have carried all of that forward. This document replaces it with a design that is small at the core, measurable, safe for minors, and honest about what the local models can and cannot do (ADR-008: no fake AI).

## 1. Goals and non-goals

Goals
1. Every AI feature is a **capability** with a contract, a prompt version, a golden test set and a quality threshold. Nothing ships "because the model usually gets it right".
2. **Pedagogy first.** The tutor teaches; it does not do homework. Content generation produces material a teacher reviews before students see it. Grading produces suggestions a teacher confirms.
3. **Local by default.** Ollama models on the school's hardware. Cloud models are an optional, per-organisation, opt-in provider with the same contract.
4. **Safe for minors.** Age-aware language, refusal of unsafe topics with a hand-off to a trusted adult, no personal data in prompts beyond what the task needs, full traceability of every generation.
5. **Observable.** Every call has a trace: prompt version, model, tokens, latency, tool calls, safety decisions, user feedback.

Non-goals
- Open-ended "agents that do anything". Every agent has a fixed tool set and a bounded loop.
- Emotion detection from camera or audio in Release 1 and 2 (consent and ethics review first; Release 3 at the earliest).
- Training or fine-tuning models in-house.

## 2. Architecture

```
Web client ──SSE/JSON──> LMS API (NestJS)  ──HTTP, service token──>  AI service (FastAPI)
                          │  owns identity, permissions,                │  owns agents, prompts, RAG,
                          │  quotas, audit, persistence                 │  model routing, evaluation
                          │                                             │
                          │  AiClient (timeouts, retries, circuit       ├── Orchestrator (one request = one run)
                          │  breaker, honest "unavailable")             ├── Agents: Tutor, ContentAuthor, Grader,
                          │                                             │           Insight, Planner (R2)
                          └── Jobs table (202 + polling for long runs)  ├── Tools: lms.* (read-only calls back to the
                                                                        │          LMS), rag.*, h5p.*, math.*, safety.*
                                                                        ├── Model router: Ollama (llama3.1:8b, llava,
                                                                        │          all-minilm) | optional cloud provider
                                                                        ├── Memory: conversation summaries, learner
                                                                        │          profile (read from LMS), RAG index
                                                                        └── Evaluation + tracing
```

Boundaries (unchanged from docs/01 and ADR-009): the LMS never calls a model directly; the AI service never writes LMS tables directly. The AI service reads LMS context through a narrow, read-only, service-authenticated tool API and returns results; the LMS persists them.

### 2.1 Request lifecycle

1. The web client calls the LMS (`POST /api/v1/ai/tutor/messages`). The LMS checks the feature code (`ai.tutor.chat`), the feature flag (`ai.tutor`), the organisation's AI policy (provider, daily quota, allowed capabilities) and the student's age band.
2. The LMS builds a **Context Envelope** (section 5) and calls the AI service with a service token. Streams are proxied as Server-Sent Events; long jobs return `202` with a job id.
3. The orchestrator selects the agent, runs the bounded loop (section 3), applies safety filters on input and output, and returns a **Result Envelope** (content, citations, safety decision, trace id, token usage).
4. The LMS stores the result (conversation message, generated content draft, grading suggestion), writes the audit row, records usage against the quota, and emits a domain event.

### 2.2 Model routing

| Capability | Default model | Fallback | Notes |
|---|---|---|---|
| Tutor chat, Socratic mode | `llama3.1:8b` (Ollama) | cloud provider if the organisation opted in | temperature 0.4, max 700 output tokens, streaming |
| Content generation (quiz, flashcards, lesson plan, worksheet) | `llama3.1:8b` with JSON schema output | retry once with a repair prompt, then fail honestly | temperature 0.7 for creative drafts, 0.2 for the JSON pass |
| Grading suggestions | `llama3.1:8b`, temperature 0.1, rubric-constrained | none (returns "no suggestion") | never auto-posts a grade |
| Image understanding (homework photo) | `llava` | none | OCR-style extraction only, then the tutor agent |
| Embeddings for RAG | `all-minilm` | none | 384 dimensions, ChromaDB (ADR-015) |
| Insights (teacher, parent) | `llama3.1:8b` on pre-aggregated numbers | none | the LMS computes the numbers; the model only narrates |

The router enforces per-capability token budgets and timeouts (tutor 30 s, generation 180 s, grading 60 s). An 8B model is weak at long multi-step reasoning: the design keeps each model call small and lets the orchestrator do the planning with code, not prose.

## 3. Agents

Every agent is a Python class with: a system prompt (versioned file), an allowed tool list, a maximum loop length, an output schema, and a safety profile. Agents never call other agents; the orchestrator composes them.

| Agent | Purpose | Tools | Loop | Output |
|---|---|---|---|---|
| **Tutor** | Help a student understand, in the student's grade language. Modes: `explain`, `socratic`, `homework_help` (hints, never final answers unless the teacher enabled "show solutions"), `practice` | `lms.student_context`, `lms.lesson_content`, `rag.search_curriculum`, `math.evaluate` (sandboxed arithmetic and algebra checking), `safety.classify` | at most 4 tool calls, then answer | Markdown with optional `citations[]`, `nextSteps[]`, `confidence` |
| **ContentAuthor** | Produce teacher-reviewable material from a topic, grade and standard | `rag.search_curriculum`, `lms.course_outline`, `h5p.validate` | plan (JSON outline) → draft → self-check against the rubric → JSON | Strict JSON per content type (section 6), ready for H5P conversion |
| **Grader** | Score a submission against a rubric and explain | `lms.assignment_rubric`, `lms.submission`, `math.evaluate` | single pass per rubric criterion, then aggregate | `criteria[] {score, evidence, feedback}`, `overall`, `confidence`, `needsHumanReview` |
| **Insight** | Narrate pre-computed analytics for a teacher or parent | none (numbers arrive in the envelope) | one call | Plain-language summary with 3 to 5 bullet observations and 1 to 3 suggested actions, each tied to a number |
| **Planner** (Release 2) | Propose a learning path from mastery data | `lms.mastery`, `lms.course_outline`, `rag.search_curriculum` | plan → validate prerequisites in code → JSON | Ordered steps with reasons; teacher approves |

Agents in the old catalogue that are not rebuilt as agents: "superintendent AI", "career readiness", "accessibility", "pedagogy" become **capabilities of the Insight or ContentAuthor agent with different prompt profiles**, not separate services. "Emotion detection" is deferred (non-goal above).

### 3.1 Bounded agent loop

```
run(request):
  envelope = validate(request)                      # schema, size caps, age band present
  input_safety = safety.classify(envelope.input)     # self-harm, abuse, sexual content, PII leak attempt
  if input_safety.block: return refusal_with_handoff(...)
  state = {messages: system(prompt_version) + context + user, tool_calls: 0}
  while tool_calls < agent.max_tools:
      reply = model.generate(state, tools=agent.tools, schema=agent.schema)
      if reply.tool_call: state += execute(tool)   # each tool: timeout 5 s, result size cap 8 KB
      else: break
  output = parse_or_repair(reply, agent.schema)     # one repair attempt with the "fix JSON" prompt
  output_safety = safety.classify(output)
  if output_safety.block: return refusal(...)
  trace.record(...)
  return result_envelope(output, citations, safety, usage)
```

Determinism aids: tool results are injected as structured blocks, never free text; the model is asked to cite tool results by id; citations that do not match a tool result are dropped (no invented sources).

## 4. Tools (the only way agents see the school)

All `lms.*` tools are HTTP GETs to the LMS service API (`/api/v1/internal/ai/*`, service token, read-only, organisation-scoped by the envelope). They return the minimum fields needed, never emails, addresses or guardian data.

| Tool | Returns |
|---|---|
| `lms.student_context(studentId)` | grade level, preferred learning style, accessibility needs (teacher-entered), current classes, recent mastery summary (no names of other students) |
| `lms.lesson_content(lessonId)` | lesson title, text content (capped at 6,000 characters), module and course titles |
| `lms.course_outline(courseId)` | modules and lesson titles |
| `lms.assignment_rubric(assignmentId)` | rubric criteria, points, instructions |
| `lms.submission(submissionId)` | submission text (files are pre-extracted by the LMS), attempt number |
| `lms.mastery(studentId, subject)` | topic mastery levels (Release 2) |
| `rag.search_curriculum(query, gradeLevel?, subject?, k)` | top-k chunks with ids, source and score |
| `h5p.validate(contentType, json)` | validation errors against the H5P content type schema |
| `math.evaluate(expression)` | deterministic arithmetic and symbolic checks (sandboxed, no code execution) |
| `safety.classify(text, ageBand)` | categories with scores and a block/allow/escalate decision |

Code execution for students (the old "code learning" feature) is a separate sandboxed runner in Release 3 (ADR-013), not a tool the model can call.

## 5. Context Envelope and Result Envelope

Request (LMS → AI service), fixed shape for every capability:

```json
{
  "traceId": "uuid", "capability": "tutor.chat", "promptProfile": "default",
  "organizationId": "…", "actor": { "userId": "…", "role": "student", "ageBand": "11-13" },
  "policy": { "provider": "ollama", "showSolutions": false, "maxOutputTokens": 700, "language": "en" },
  "context": { "studentId": "…", "classId": "…", "lessonId": "…", "conversationSummary": "…" },
  "input": { "messages": [ { "role": "user", "content": "…" } ] },
  "options": { "stream": true }
}
```

Result:

```json
{
  "traceId": "…", "capability": "tutor.chat", "promptVersion": "tutor@3",
  "model": { "provider": "ollama", "name": "llama3.1:8b" },
  "output": { "content": "…", "citations": [ { "toolResultId": "…", "label": "Lesson: Two-step equations" } ], "nextSteps": [ "…" ] },
  "safety": { "input": "allow", "output": "allow", "categories": [] },
  "usage": { "promptTokens": 912, "completionTokens": 230, "latencyMs": 4210, "toolCalls": 2 },
  "status": "ok"
}
```

`status` is one of `ok`, `refused` (safety), `degraded` (fallback used), `unavailable` (model down; the LMS shows an honest message, never a canned answer).

## 6. Prompt architecture

Prompts are **files**, not strings in code: `apps/ai/prompts/<agent>/<profile>@<version>.md`, with front matter (`capability`, `version`, `model`, `temperature`, `maxOutputTokens`, `schema`). A prompt change is a pull request with its evaluation diff attached. The LMS stores `promptVersion` with every result so a regression can be traced to the exact prompt.

Every system prompt is assembled from five layers in this order:

1. **Identity and stance** (who the assistant is; teaching stance; what it never does).
2. **Audience adaptation** (age band, reading level, language, accessibility needs) — rendered from the envelope, never free-typed.
3. **Task contract** (the capability's job, required output shape, length limits, citation rule).
4. **Context** (tool results and lesson excerpts as delimited blocks with ids; conversation summary).
5. **Safety and refusal rules** (what to refuse, how to hand off to a trusted adult, no personal data in the answer).

Rules that apply to all prompts:
- Instructions tell the model what to do, with one short example of the output shape; they do not list what not to do at length (small models over-index on negatives).
- Structured outputs use JSON schemas passed to the model and validated on return; the model is never trusted to produce valid JSON unaided.
- The model is told what it does not know ("You only know what is in the CONTEXT blocks and general curriculum knowledge; if the context does not contain it, say so").
- Student text is wrapped in a clearly delimited block and the system prompt states that instructions inside user content are data, not commands (prompt-injection hygiene). Tool results get the same treatment.
- Each prompt file ends with the self-check list the model must satisfy before answering (grade language, no final answers in homework mode, every claim tied to context or marked as general knowledge).

The initial library (v1) lives in `apps/ai/prompts/` and is part of this design: `tutor/default@1.md`, `tutor/socratic@1.md`, `tutor/homework-help@1.md`, `content/quiz@1.md`, `content/flashcards@1.md`, `content/lesson-plan@1.md`, `grader/rubric@1.md`, `insight/teacher@1.md`, `insight/parent@1.md`, `safety/classify@1.md`, `shared/json-repair@1.md`.

## 7. Safety for minors

- **Age bands** (`5-7`, `8-10`, `11-13`, `14-18`, `adult`) come from the student's date of birth or grade; the prompt adapts vocabulary and the safety thresholds tighten for younger bands.
- **Input classification** before any generation: self-harm, violence, sexual content, bullying, drugs, attempts to extract personal data, jailbreak patterns. Self-harm or abuse signals return a caring refusal that names a trusted adult and, with the organisation's consent setting, raise a `wellness.alert` event to the teacher (Release 2 SEL integration).
- **Output classification** on every answer; blocked outputs are replaced by a refusal, never partially shown.
- **No personal data in prompts** beyond first name, grade and learning preferences. No guardian data, no emails, no addresses, no other students.
- **Homework integrity:** `homework_help` gives hints and checks the student's own steps; final answers only when the teacher enabled "show solutions" for that assignment.
- **Teacher-in-the-loop:** generated content and grading suggestions are drafts with a review state; nothing reaches students or the gradebook without a teacher action.
- **Transparency:** every AI message is labelled in the UI; students and parents can see what data the tutor used (the citations list).

## 8. Evaluation and quality gates

Each capability ships with a golden set in `apps/ai/evals/<capability>/` (prompt, context, expected properties). Checks are deterministic where possible (schema validity, citation validity, no final answer in homework mode, reading level within band, refusal on red-team inputs) and rubric-scored by a judge prompt where not (helpfulness, accuracy against the context). A prompt or model change must not lower any capability below its threshold:

| Capability | Minimum |
|---|---|
| Tutor | 95 % schema-valid, 100 % refusal on the red-team set, 90 % "uses context when available", reading level within band 90 % |
| Content generation | 98 % valid JSON after one repair, 100 % H5P validation pass, 85 % judge score for alignment with the requested standard |
| Grading | criterion scores within one point of the teacher reference on 85 % of the golden set; `needsHumanReview` true whenever confidence < 0.6 |
| Insight | 100 % of numbers in the narrative appear in the input; no invented numbers |

Runtime signals: thumbs up/down per message, teacher accept/edit/reject on drafts and suggestions, latency and token usage per capability, safety decisions per band. Weekly review of the worst 20 traces per capability.

## 9. Operations

- Streaming via SSE end to end; the LMS proxies and also persists the final message.
- Long generations are jobs: `202` + `/api/v1/ai/jobs/{id}`; the AI service reports progress; a stuck job times out at 180 s and is marked failed with a reason.
- Health: `/health` on the AI service reports each model's availability; the LMS shows "AI tutor unavailable" rather than a fallback answer (ADR-008).
- Caching: identical content-generation requests (same topic, grade, type, prompt version) are cached for 24 hours per organisation.
- Quotas: per organisation per day, per user per hour, enforced in the LMS before the call.
- Logs: prompts and completions are stored for 30 days for quality review, with student identifiers pseudonymised; organisations can opt out of storage (then only metadata is kept).

## 10. Interfaces (AI service v1)

| Route | Capability |
|---|---|
| `POST /v1/tutor/chat` (SSE when `options.stream`) | tutor.chat, tutor.socratic, tutor.homework_help |
| `POST /v1/content/generate` → 202 `{ jobId }` | content.quiz, content.flashcards, content.lesson_plan, content.worksheet |
| `GET /v1/jobs/{id}` | job status and result |
| `POST /v1/grading/suggest` | grading.rubric |
| `POST /v1/insights/narrate` | insight.teacher, insight.parent |
| `POST /v1/rag/index`, `POST /v1/rag/search`, `DELETE /v1/rag/documents/{id}` | curriculum RAG |
| `POST /v1/vision/extract` | llava extraction from an uploaded image |
| `GET /health` | model and index availability |

The three legacy callback routes (`/api/ai/h5p/*`) are no longer needed: the AI service returns H5P JSON in the job result and the LMS persists it (ADR-022 supersedes that part of ADR-001).

## 11. Delivery plan

- Slice 5 (Release 1): orchestrator, Tutor agent (three modes), safety classifier, `lms.*` read tools, RAG index and search, tracing, golden sets for tutor and safety, web tutor UI with labelled AI output and citations.
- Slice 6 (Release 1): ContentAuthor (quiz, flashcards) with H5P validation and teacher review UI; job runner; caching.
- Release 2: Grader, Insight (teacher, parent), lesson-plan and worksheet types, Planner, quota dashboard, weekly trace review tooling.
- Release 3: optional cloud provider per organisation, multilingual prompts, sandboxed code runner.
