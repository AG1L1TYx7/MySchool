"""Background jobs for long generations: 202 + polling, a hard timeout, and a 24-hour result cache (docs/10 section 9)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from app.content import ContentRequest, ContentResult, Job, JobError

JOB_TIMEOUT_SECONDS = 180.0
CACHE_TTL_SECONDS = 24 * 3600
MAX_JOBS_KEPT = 500


def _now() -> str:
    return datetime.now(UTC).isoformat()


def cache_key(req: ContentRequest, prompt_version: str) -> str | None:
    """Identical requests (same organisation, capability, prompt version and spec) share a result for a day.
    Regenerations with teacher feedback are never cached."""
    if req.request.feedback or req.request.previousDraft:
        return None
    spec = req.request.model_dump(exclude={"feedback", "previousDraft"})
    blocks = [b.model_dump() for b in req.context.blocks]
    payload = json.dumps([req.organizationId, req.capability, prompt_version, spec, blocks], sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


class JobRunner:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._cache: dict[str, tuple[float, ContentResult]] = {}

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def cached(self, key: str | None) -> ContentResult | None:
        if key is None:
            return None
        hit = self._cache.get(key)
        if not hit:
            return None
        stored_at, result = hit
        if time.monotonic() - stored_at > CACHE_TTL_SECONDS:
            del self._cache[key]
            return None
        return result.model_copy(update={"cached": True})

    def remember(self, key: str | None, result: ContentResult) -> None:
        if key is not None:
            self._cache[key] = (time.monotonic(), result)

    def submit(
        self,
        req: ContentRequest,
        work: Callable[[Job], Awaitable[ContentResult]],
        *,
        cache: str | None = None,
    ) -> Job:
        job = Job(
            jobId=str(uuid.uuid4()), traceId=req.traceId, capability=req.capability, createdAt=_now(), updatedAt=_now()
        )
        self.jobs[job.jobId] = job
        self._prune()
        hit = self.cached(cache)
        if hit is not None:
            job.status, job.progress, job.result, job.updatedAt = "done", "Served from cache", hit, _now()
            return job
        self._tasks[job.jobId] = asyncio.create_task(self._run(job, work, cache))
        return job

    async def _run(self, job: Job, work: Callable[[Job], Awaitable[ContentResult]], cache: str | None) -> None:
        job.status, job.progress, job.updatedAt = "running", "Generating", _now()
        try:
            result = await asyncio.wait_for(work(job), timeout=JOB_TIMEOUT_SECONDS)
            job.result, job.status, job.progress = result, "done", "Done"
            self.remember(cache, result)
        except TimeoutError:
            job.status, job.error = (
                "failed",
                JobError(code="ai.timeout", detail=f"Generation exceeded {int(JOB_TIMEOUT_SECONDS)} seconds."),
            )
        except JobFailure as e:
            job.status, job.error = "failed", JobError(code=e.code, detail=e.detail)
        except Exception as e:  # noqa: BLE001 - a job must always reach a terminal state
            job.status, job.error = "failed", JobError(code="ai.error", detail=str(e)[:500])
        finally:
            job.updatedAt = _now()
            self._tasks.pop(job.jobId, None)

    def _prune(self) -> None:
        if len(self.jobs) <= MAX_JOBS_KEPT:
            return
        for job_id in sorted(self.jobs, key=lambda j: self.jobs[j].updatedAt)[: len(self.jobs) - MAX_JOBS_KEPT]:
            if job_id not in self._tasks:
                del self.jobs[job_id]

    def snapshot(self, job: Job) -> dict[str, Any]:
        return job.model_dump()


class JobFailure(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail
