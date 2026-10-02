"""FastAPI entry point: /health, /v1/tutor/chat (JSON or SSE), /v1/content/generate (202), /v1/rag/*, /v1/jobs/{id}."""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.agents.content import ContentAuthor, ContentRefused, InvalidOutput
from app.agents.tutor import ResultStatus, StreamState, ToolFn, TutorAgent, extract_citations, next_steps_from
from app.config import Settings, get_settings
from app.content import ContentRequest, ContentResult, Job
from app.envelopes import Citation, ContextEnvelope, ModelInfo, ResultEnvelope, SafetyDecision, TutorOutput, Usage
from app.jobs import JobFailure, JobRunner, cache_key
from app.models import FakeProvider, ModelProvider, ModelUnavailable, OllamaProvider
from app.prompts import PromptLibrary
from app.rag.chunk import chunk_text
from app.rag.store import Chunk, VectorStore
from app.safety import REFUSAL_OUTPUT, classify_rules, strip_personal_data
from app.tracing import Tracer


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Loads the chat model into memory at start so the first student does not wait for a cold start."""
    task = asyncio.create_task(_warm_up())
    yield
    task.cancel()


async def _warm_up() -> None:
    runtime = get_runtime()
    if runtime.provider.name != "ollama":
        return
    try:
        await runtime.provider.chat(
            [{"role": "user", "content": "Say ready."}],
            model=runtime.settings.chat_model,
            temperature=0.0,
            max_tokens=5,
            timeout=180.0,
        )
    except ModelUnavailable:
        pass


app = FastAPI(title="SmartSchool AI", version="0.1.0", docs_url="/docs", redoc_url=None, lifespan=lifespan)


class Runtime:
    def __init__(self, settings: Settings, provider: ModelProvider | None = None):
        self.settings = settings
        self._provider: ModelProvider = provider or (
            FakeProvider() if settings.model_provider == "fake" else OllamaProvider(settings.ollama_url)
        )
        self.library = PromptLibrary(settings.prompts_dir)
        self.store = VectorStore(settings.data_dir / "rag.sqlite")
        self.tracer = Tracer(settings.data_dir, settings.trace_salt)
        self.tutor = TutorAgent(
            self._provider,
            self.library,
            max_tool_calls=settings.max_tool_calls,
            timeout=settings.tutor_timeout_seconds,
            model_safety=settings.safety_model_check,
            tool_timeout=settings.tool_timeout_seconds,
        )
        self.content = ContentAuthor(self._provider, self.library, timeout=settings.generation_timeout_seconds)
        self.jobs = JobRunner()

    @property
    def provider(self) -> ModelProvider:
        return self._provider

    @provider.setter
    def provider(self, value: ModelProvider) -> None:
        """Swapping the provider (tests, future hot reload) must reach the agents too."""
        self._provider = value
        self.tutor.provider = value
        self.content.provider = value


_runtime: Runtime | None = None


def get_runtime() -> Runtime:
    global _runtime
    if _runtime is None:
        _runtime = Runtime(get_settings())
    return _runtime


def set_runtime(runtime: Runtime) -> None:
    """Tests inject a runtime with the fake provider and a temporary data directory."""
    global _runtime
    _runtime = runtime


def require_service_token(
    authorization: str | None = Header(default=None), runtime: Runtime = Depends(get_runtime)
) -> None:
    expected = f"Bearer {runtime.settings.service_token}"
    if not authorization or not _constant_time_equal(authorization, expected):
        raise HTTPException(status_code=401, detail={"code": "ai.unauthorized", "detail": "Service token required."})


def _constant_time_equal(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a.encode(), b.encode())


@app.get("/health")
async def health(runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    model_health = await runtime.provider.health()
    models = model_health.get("models", [])
    wanted = [runtime.settings.chat_model, runtime.settings.embedding_model]
    present = (
        {m: any(name.startswith(m) for name in models) for m in wanted}
        if model_health.get("reachable")
        else {m: False for m in wanted}
    )
    status = (
        "healthy"
        if model_health.get("reachable") and all(present.values())
        else ("degraded" if model_health.get("reachable") else "unhealthy")
    )
    return {
        "status": status,
        "provider": runtime.provider.name,
        "models": present,
        "promptVersions": sorted(p.version_tag for p in runtime.library.all()),
        "ragChunks": runtime.store.count(),
    }


def _rag_tool(runtime: Runtime, env: ContextEnvelope) -> ToolFn | None:
    if not env.organizationId:
        return None

    async def search(args: dict[str, Any]) -> dict[str, Any]:
        query = str(args.get("query", "")).strip()[:500]
        if not query:
            return {"ok": False, "error": "empty query"}
        [vec] = await runtime.provider.embed(
            [query], model=runtime.settings.embedding_model, timeout=runtime.settings.tool_timeout_seconds
        )
        hits = runtime.store.search(vec, env.organizationId or "", course_id=env.context.courseId, k=3)
        return {
            "ok": True,
            "results": [
                {
                    "title": h.chunk.title,
                    "lessonId": h.chunk.lesson_id,
                    "excerpt": h.chunk.text[:600],
                    "score": round(h.score, 3),
                }
                for h in hits
            ],
        }

    return search


@app.post("/v1/tutor/chat", dependencies=[Depends(require_service_token)])
async def tutor_chat(env: ContextEnvelope, runtime: Runtime = Depends(get_runtime)) -> Response:
    if not env.capability.startswith("tutor."):
        raise HTTPException(status_code=400, detail={"code": "ai.capability", "detail": "Use a tutor capability."})
    if env.options.stream:
        return StreamingResponse(
            _stream_tutor(env, runtime),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    result = await runtime.tutor.run(env, rag_search=_rag_tool(runtime, env))
    _trace(runtime, env, result)
    return JSONResponse(result.model_dump())


async def _stream_tutor(env: ContextEnvelope, runtime: Runtime) -> AsyncIterator[bytes]:
    """SSE: 'token' events while generating, then one 'result' event with the full envelope."""
    started = time.monotonic()
    prompt = runtime.tutor._prompt_for(env)  # noqa: SLF001
    last_user = env.input.messages[-1].content
    rules = classify_rules(last_user, env.actor.ageBand)
    if rules.decision != "allow":
        result = await runtime.tutor.run(env)
        _trace(runtime, env, result)
        yield _sse("result", result.model_dump())
        return
    text = ""
    status: ResultStatus = "ok"
    state = StreamState()
    try:
        async for token in runtime.tutor.stream(env, rag_search=_rag_tool(runtime, env), state=state):
            text += token
            yield _sse("token", {"t": token})
    except ModelUnavailable:
        status = "unavailable"
    text = strip_personal_data(text)
    safety = SafetyDecision()
    out_rules = classify_rules(text, env.actor.ageBand)
    citations: list[Citation] = []
    if out_rules.decision != "allow":
        safety.output = out_rules.decision
        safety.categories = out_rules.categories
        content, status = REFUSAL_OUTPUT, "refused"
    else:
        content, citations = extract_citations(text, state.blocks or list(env.context.blocks))
    result = ResultEnvelope(
        traceId=env.traceId,
        capability=env.capability,
        promptVersion=prompt.version_tag,
        model=ModelInfo(provider=runtime.provider.name, name=prompt.model),
        output=TutorOutput(content=content, citations=citations, nextSteps=next_steps_from(content)),
        safety=safety,
        usage=Usage(
            promptTokens=state.prompt_tokens,
            completionTokens=state.completion_tokens,
            latencyMs=int((time.monotonic() - started) * 1000),
            toolCalls=state.tool_calls,
        ),
        status=status,
    )
    _trace(runtime, env, result)
    yield _sse("result", result.model_dump())


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


def _trace(runtime: Runtime, env: ContextEnvelope, result: ResultEnvelope) -> None:
    runtime.tracer.record(
        {
            "traceId": env.traceId,
            "capability": env.capability,
            "promptVersion": result.promptVersion,
            "model": result.model.model_dump(),
            "org": runtime.tracer.pseudonym(env.organizationId),
            "user": runtime.tracer.pseudonym(env.actor.userId),
            "ageBand": env.actor.ageBand,
            "status": result.status,
            "safety": result.safety.model_dump(),
            "usage": result.usage.model_dump(),
            "citations": len(result.output.citations),
        }
    )


# ---------------------------------------------------------------------------
# RAG
# ---------------------------------------------------------------------------


class IndexDocument(BaseModel):
    docId: str = Field(max_length=100)
    organizationId: str
    courseId: str | None = None
    lessonId: str | None = None
    title: str = Field(max_length=300)
    text: str = Field(max_length=200_000)


class IndexRequest(BaseModel):
    documents: list[IndexDocument] = Field(min_length=1, max_length=200)


class SearchRequest(BaseModel):
    organizationId: str
    courseId: str | None = None
    query: str = Field(min_length=1, max_length=500)
    k: int = Field(default=5, ge=1, le=20)


@app.post("/v1/rag/index", dependencies=[Depends(require_service_token)])
async def rag_index(req: IndexRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    indexed = 0
    for doc in req.documents:
        pieces = chunk_text(doc.text)
        if not pieces:
            runtime.store.delete_document(doc.docId)
            continue
        try:
            embeddings = await runtime.provider.embed(pieces, model=runtime.settings.embedding_model, timeout=60.0)
        except ModelUnavailable as e:
            raise HTTPException(
                status_code=503, detail={"code": "ai.unavailable", "detail": f"Embedding model unavailable: {e}"}
            ) from e
        chunks = [
            Chunk(
                id=f"{doc.docId}:{i}",
                doc_id=doc.docId,
                organization_id=doc.organizationId,
                course_id=doc.courseId,
                lesson_id=doc.lessonId,
                title=doc.title,
                text=p,
            )
            for i, p in enumerate(pieces)
        ]
        indexed += runtime.store.replace_document(doc.docId, chunks, embeddings)
    return {"documents": len(req.documents), "chunks": indexed, "total": runtime.store.count()}


@app.delete("/v1/rag/documents/{doc_id}", dependencies=[Depends(require_service_token)])
async def rag_delete(doc_id: str, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    return {"deleted": runtime.store.delete_document(doc_id)}


@app.post("/v1/rag/search", dependencies=[Depends(require_service_token)])
async def rag_search(req: SearchRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    try:
        [vec] = await runtime.provider.embed(
            [req.query], model=runtime.settings.embedding_model, timeout=runtime.settings.tool_timeout_seconds
        )
    except ModelUnavailable as e:
        raise HTTPException(status_code=503, detail={"code": "ai.unavailable", "detail": str(e)}) from e
    hits = runtime.store.search(vec, req.organizationId, course_id=req.courseId, k=req.k)
    return {
        "data": [
            {
                "chunkId": h.chunk.id,
                "docId": h.chunk.doc_id,
                "lessonId": h.chunk.lesson_id,
                "title": h.chunk.title,
                "text": h.chunk.text,
                "score": round(h.score, 4),
            }
            for h in hits
        ]
    }


@app.post("/v1/content/generate", status_code=202, dependencies=[Depends(require_service_token)])
async def content_generate(req: ContentRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    """Starts a generation job. Poll /v1/jobs/{jobId}; identical requests are served from a 24-hour cache."""
    prompt = runtime.library.get(req.capability)

    async def work(job: Job) -> ContentResult:
        try:
            result = await runtime.content.run(req)
        except ContentRefused as e:
            raise JobFailure(
                "ai.refused", "That topic cannot be used for school content: " + ", ".join(e.categories)
            ) from e
        except InvalidOutput as e:
            raise JobFailure(
                "ai.invalid_output",
                "The model did not return a valid draft after one repair: " + "; ".join(e.errors[:5]),
            ) from e
        except ModelUnavailable as e:
            raise JobFailure("ai.unavailable", f"The model is unavailable: {e}") from e
        runtime.tracer.record(
            {
                "traceId": req.traceId,
                "capability": req.capability,
                "promptVersion": result.promptVersion,
                "model": result.model,
                "org": runtime.tracer.pseudonym(req.organizationId),
                "user": runtime.tracer.pseudonym(req.actor.userId),
                "status": "ok" if result.validation.valid else "degraded",
                "usage": result.usage.model_dump(),
                "items": result.h5p.maxScore,
            }
        )
        return result

    job = runtime.jobs.submit(req, work, cache=cache_key(req, prompt.version_tag))
    return {"jobId": job.jobId, "status": job.status}


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(require_service_token)])
async def job(job_id: str, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    found = runtime.jobs.get(job_id)
    if found is None:
        raise HTTPException(status_code=404, detail={"code": "resource.not_found", "detail": "Job not found."})
    return runtime.jobs.snapshot(found)


@app.exception_handler(HTTPException)
async def problem_details(request: Request, exc: HTTPException) -> JSONResponse:
    """RFC 9457 problem details, the same shape the LMS uses (docs/09)."""
    detail = (
        exc.detail if isinstance(exc.detail, dict) else {"code": f"http.{exc.status_code}", "detail": str(exc.detail)}
    )
    body = {
        "type": f"https://docs.smartschool.local/errors/{detail.get('code', 'error')}",
        "title": _title(exc.status_code),
        "status": exc.status_code,
        "detail": detail.get("detail", ""),
        "code": detail.get("code", "error"),
        "instance": str(request.url.path),
        "traceId": str(uuid.uuid4()),
    }
    return JSONResponse(status_code=exc.status_code, content=body, media_type="application/problem+json")


def _title(status: int) -> str:
    return {
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        422: "Unprocessable Content",
        503: "Service Unavailable",
    }.get(status, "Error")


_SAFE_ID = re.compile(r"^[A-Za-z0-9:_-]{1,100}$")
