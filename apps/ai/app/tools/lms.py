"""Read-only LMS tool API client (docs/10 section 4, ADR-022). Returns the minimum fields the agents need."""

from __future__ import annotations

from typing import Any

import httpx


class LmsToolClient:
    def __init__(self, base_url: str, service_token: str, timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.headers = {"x-service-token": service_token, "accept": "application/json"}
        self.timeout = timeout

    async def _get(self, path: str) -> dict[str, Any] | None:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(f"{self.base_url}/api/v1/internal/ai{path}", headers=self.headers)
                if res.status_code == 404:
                    return None
                res.raise_for_status()
                data = res.json()
                return data if isinstance(data, dict) else None
        except (httpx.HTTPError, ValueError):
            return None

    async def lesson_content(self, lesson_id: str) -> dict[str, Any] | None:
        return await self._get(f"/lessons/{lesson_id}")

    async def course_outline(self, course_id: str) -> dict[str, Any] | None:
        return await self._get(f"/courses/{course_id}/outline")

    async def student_context(self, student_id: str) -> dict[str, Any] | None:
        return await self._get(f"/students/{student_id}/context")

    async def published_lessons(self, organization_id: str) -> list[dict[str, Any]]:
        data = await self._get(f"/organizations/{organization_id}/lessons")
        items = data.get("data") if data else None
        return items if isinstance(items, list) else []
