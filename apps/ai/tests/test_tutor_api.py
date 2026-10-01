from __future__ import annotations

import json
from pathlib import Path

from httpx import AsyncClient

from app.agents.tutor import extract_citations, next_steps_from
from app.envelopes import ContextBlock
from app.main import Runtime
from app.models import FakeProvider, ToolCall


def envelope(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "traceId": "t1",
        "capability": "tutor.chat",
        "organizationId": "org1",
        "actor": {"userId": "u1", "role": "student", "ageBand": "11-13", "firstName": "Emma"},
        "policy": {"provider": "fake", "showSolutions": False},
        "context": {
            "gradeLevel": "7",
            "lessonId": "l1",
            "blocks": [
                {"id": "C1", "label": "Lesson: Two-step equations", "text": "Undo addition first, then division."}
            ],
        },
        "input": {"messages": [{"role": "user", "content": "How do I solve 2x + 3 = 11?"}]},
    }
    base.update(overrides)
    return base


async def test_requires_the_service_token(client: AsyncClient) -> None:
    res = await client.post("/v1/tutor/chat", json=envelope(), headers={"Authorization": "Bearer wrong"})
    assert res.status_code == 401
    assert res.headers["content-type"].startswith("application/problem+json")
    assert res.json()["code"] == "ai.unauthorized"


async def test_health_reports_provider_prompts_and_index(client: AsyncClient) -> None:
    res = await client.get("/health")
    body = res.json()
    assert body["provider"] == "fake"
    assert "tutor.chat@1" in body["promptVersions"]


async def test_tutor_answers_with_real_citations_and_a_next_step(client: AsyncClient, runtime: Runtime) -> None:
    res = await client.post("/v1/tutor/chat", json=envelope())
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["promptVersion"] == "tutor.chat@1"
    assert body["output"]["citations"] == [{"blockId": "C1", "label": "Lesson: Two-step equations"}]
    assert body["output"]["nextSteps"] and body["output"]["nextSteps"][0].endswith("?")
    system = runtime.provider.calls[0][0]["content"]  # type: ignore[attr-defined]
    assert "11 to 13 years old" in system and "grade 7" in system and '<CONTEXT id="C1"' in system
    assert "<STUDENT>" in runtime.provider.calls[0][1]["content"]  # type: ignore[attr-defined]
    traces = (Path(runtime.settings.data_dir) / "traces.jsonl").read_text().splitlines()
    trace = json.loads(traces[-1])
    assert trace["user"] != "u1" and trace["status"] == "ok"


async def test_refuses_and_hands_off_on_self_harm_without_calling_the_model(
    client: AsyncClient, runtime: Runtime
) -> None:
    res = await client.post(
        "/v1/tutor/chat", json=envelope(input={"messages": [{"role": "user", "content": "i want to die"}]})
    )
    body = res.json()
    assert body["status"] == "refused"
    assert body["safety"]["input"] == "escalate"
    assert "trusted adult" in body["output"]["content"]
    assert runtime.provider.calls == []  # type: ignore[attr-defined]


async def test_homework_mode_uses_the_hints_only_policy(client: AsyncClient, runtime: Runtime) -> None:
    res = await client.post("/v1/tutor/chat", json=envelope(capability="tutor.homework_help"))
    assert res.json()["promptVersion"] == "tutor.homework_help@1"
    system = runtime.provider.calls[0][0]["content"]  # type: ignore[attr-defined]
    assert "hints only" in system


async def test_tool_loop_executes_math_and_cites_the_result(runtime: Runtime, client: AsyncClient) -> None:
    runtime.provider = FakeProvider(scripted_tool_call=ToolCall("math_evaluate", {"expression": "11-3"}))
    res = await client.post("/v1/tutor/chat", json=envelope())
    body = res.json()
    assert body["usage"]["toolCalls"] == 1
    tool_messages = [m for m in runtime.provider.calls[-1] if m.get("role") == "tool"]
    assert tool_messages and "'value': 8.0" in tool_messages[0]["content"]


async def test_streaming_emits_tokens_then_a_result(client: AsyncClient) -> None:
    res = await client.post("/v1/tutor/chat", json=envelope(options={"stream": True}))
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    events = [e for e in res.text.split("\n\n") if e.strip()]
    assert events[0].startswith("event: token")
    assert events[-1].startswith("event: result")
    result = json.loads(events[-1].split("data: ", 1)[1])
    assert result["status"] == "ok" and result["output"]["citations"][0]["blockId"] == "C1"


async def test_rag_index_and_search_round_trip(client: AsyncClient) -> None:
    res = await client.post(
        "/v1/rag/index",
        json={
            "documents": [
                {
                    "docId": "lesson:l1",
                    "organizationId": "org1",
                    "courseId": "c1",
                    "lessonId": "l1",
                    "title": "Two-step equations",
                    "text": "Undo addition or subtraction first.\n\nThen undo multiplication or division.",
                }
            ]
        },
    )
    assert res.status_code == 200 and res.json()["chunks"] >= 1
    search = await client.post("/v1/rag/search", json={"organizationId": "org1", "query": "undo addition first"})
    assert search.json()["data"][0]["lessonId"] == "l1"
    assert (await client.post("/v1/rag/search", json={"organizationId": "org2", "query": "anything"})).json()[
        "data"
    ] == []


def test_invented_citations_are_dropped() -> None:
    blocks = [ContextBlock(id="C1", label="L", text="x")]
    text, cites = extract_citations("Real [C1] and fake [C7] done.", blocks)
    assert text == "Real [C1] and fake  done."
    assert [c.blockId for c in cites] == ["C1"]
    assert next_steps_from("First. Then what? Finally.") == []
    assert next_steps_from("Try it. What is 2+2?") == ["What is 2+2?"]


async def test_streaming_runs_tools_first_and_counts_them(runtime: Runtime, client: AsyncClient) -> None:
    runtime.provider = FakeProvider(scripted_tool_call=ToolCall("math_evaluate", {"expression": "11-3"}))
    res = await client.post("/v1/tutor/chat", json=envelope(options={"stream": True}))
    assert res.status_code == 200
    events = [e for e in res.text.split("\n\n") if e.strip()]
    assert events[0].startswith("event: token")
    result = json.loads(events[-1].split("data: ", 1)[1])
    assert result["status"] == "ok"
    assert result["usage"]["toolCalls"] == 1
    tool_messages = [m for m in runtime.provider.calls[-1] if m.get("role") == "tool"]
    assert tool_messages and "'value': 8.0" in tool_messages[0]["content"]
