"""Model providers: Ollama (local) and a deterministic fake for tests and CI (docs/10 section 2.2)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass
class ChatResult:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0


class ModelProvider(Protocol):
    name: str

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: list[ToolSpec] | None = None,
        timeout: float = 30.0,
        json_mode: bool = False,
    ) -> ChatResult: ...

    def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        timeout: float = 30.0,
    ) -> AsyncIterator[str]: ...

    async def embed(self, texts: list[str], *, model: str, timeout: float = 30.0) -> list[list[float]]: ...

    async def health(self) -> dict[str, Any]: ...


class ModelUnavailable(RuntimeError):
    """The model backend is down or timed out; the LMS shows an honest message (ADR-008)."""


def _tool_payload(tools: list[ToolSpec] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    return [
        {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
        for t in tools
    ]


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: list[ToolSpec] | None = None,
        timeout: float = 30.0,
        json_mode: bool = False,
    ) -> ChatResult:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "keep_alive": "30m",
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        tool_payload = _tool_payload(tools)
        if tool_payload:
            payload["tools"] = tool_payload
        if json_mode:
            payload["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(f"{self.base_url}/api/chat", json=payload)
                res.raise_for_status()
                data = res.json()
        except (httpx.HTTPError, ValueError) as e:
            raise ModelUnavailable(str(e)) from e
        message = data.get("message", {})
        calls = [
            ToolCall(name=c["function"]["name"], arguments=_as_dict(c["function"].get("arguments")))
            for c in message.get("tool_calls", [])
        ]
        return ChatResult(
            content=message.get("content", "") or "",
            tool_calls=calls,
            prompt_tokens=int(data.get("prompt_eval_count", 0) or 0),
            completion_tokens=int(data.get("eval_count", 0) or 0),
        )

    async def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        timeout: float = 30.0,
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "keep_alive": "30m",
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        try:
            async with (
                httpx.AsyncClient(timeout=timeout) as client,
                client.stream("POST", f"{self.base_url}/api/chat", json=payload) as res,
            ):
                res.raise_for_status()
                async for line in res.aiter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done"):
                        break
        except (httpx.HTTPError, ValueError) as e:
            raise ModelUnavailable(str(e)) from e

    async def embed(self, texts: list[str], *, model: str, timeout: float = 30.0) -> list[list[float]]:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(f"{self.base_url}/api/embed", json={"model": model, "input": texts})
                res.raise_for_status()
                data = res.json()
        except (httpx.HTTPError, ValueError) as e:
            raise ModelUnavailable(str(e)) from e
        return [list(map(float, v)) for v in data.get("embeddings", [])]

    async def health(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                res.raise_for_status()
                models = [m.get("name", "") for m in res.json().get("models", [])]
                return {"reachable": True, "models": models}
        except (httpx.HTTPError, ValueError) as e:
            return {"reachable": False, "error": str(e)}


class FakeProvider:
    """Deterministic provider for tests: echoes context, honours a scripted tool call, never calls the network."""

    name = "fake"

    def __init__(self, scripted_tool_call: ToolCall | None = None, scripted_replies: list[str] | None = None):
        self.scripted_tool_call = scripted_tool_call
        self.scripted_replies = list(scripted_replies or [])
        self.calls: list[list[dict[str, Any]]] = []

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: list[ToolSpec] | None = None,
        timeout: float = 30.0,
        json_mode: bool = False,
    ) -> ChatResult:
        self.calls.append(messages)
        if self.scripted_replies:
            return ChatResult(content=self.scripted_replies.pop(0), prompt_tokens=30, completion_tokens=40)
        last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
        has_tool_result = any(m.get("role") == "tool" for m in messages)
        if self.scripted_tool_call and tools and not has_tool_result:
            call, self.scripted_tool_call = self.scripted_tool_call, None
            return ChatResult(content="", tool_calls=[call], prompt_tokens=10, completion_tokens=5)
        cited = (
            " [C1]" if "[C1]" in " ".join(m.get("content", "") for m in messages if m.get("role") == "system") else ""
        )
        return ChatResult(
            content=f"Let's look at that together{cited}. You asked: {last_user[:60]}. What do you think the first step is?",
            prompt_tokens=20,
            completion_tokens=12,
        )

    async def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        timeout: float = 30.0,
    ) -> AsyncIterator[str]:
        result = await self.chat(messages, model=model, temperature=temperature, max_tokens=max_tokens)
        for word in result.content.split(" "):
            yield word + " "

    async def embed(self, texts: list[str], *, model: str, timeout: float = 30.0) -> list[list[float]]:
        # bag-of-characters embedding: stable, cheap, good enough to test ranking
        out: list[list[float]] = []
        for t in texts:
            vec = [0.0] * 64
            for ch in t.lower():
                vec[ord(ch) % 64] += 1.0
            norm = sum(v * v for v in vec) ** 0.5 or 1.0
            out.append([v / norm for v in vec])
        return out

    async def health(self) -> dict[str, Any]:
        return {"reachable": True, "models": ["fake"]}


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}
