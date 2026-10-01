# SmartSchool AI service

Python (FastAPI) implementation of `docs/10-AI-SYSTEM-DESIGN.md`: a bounded orchestrator, the Tutor agent (explain, Socratic, homework help), rule-based safety for minors, a SQLite + numpy curriculum index, prompt files under `prompts/`, and tracing.

## Run (Windows, Python 3.12+)

```powershell
cd apps\ai
py -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
copy .env.example .env            # AI_SERVICE_TOKEN must match AI_SERVICE_API_KEY in apps/api/.env
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Ollama must be running with `llama3.1:8b` and `all-minilm` (`ollama pull all-minilm`). `GET /health` reports both.

## Test

```powershell
.venv\Scripts\python -m pytest
```

Tests use the deterministic fake provider; nothing touches the network.

## Interface (v1)

| Route | Purpose |
|---|---|
| `GET /health` | provider reachability, model presence, prompt versions, index size |
| `POST /v1/tutor/chat` | Context Envelope in, Result Envelope out; `options.stream` for SSE (`token` events, then `result`) |
| `POST /v1/rag/index` | index lesson documents (chunked, embedded) |
| `POST /v1/rag/search` | semantic search scoped to an organisation and optionally a course |
| `DELETE /v1/rag/documents/{docId}` | remove a document |
| `GET /v1/jobs/{id}` | job status (content generation arrives in slice 6) |

All `/v1/*` routes require `Authorization: Bearer <AI_SERVICE_TOKEN>`. Errors are RFC 9457 problem details.
