"""The optional model safety layer (SAFETY_MODEL_CHECK, slice 33): a verdict from the model refuses a turn; anything
else leaves the rules' decision standing."""

from __future__ import annotations

from pathlib import Path

from app.agents.tutor import TutorAgent
from app.envelopes import ContextEnvelope
from app.models import FakeProvider
from app.prompts import PromptLibrary
from app.safety import parse_model_verdict

ROOT = Path(__file__).resolve().parent.parent


def _env(message: str) -> ContextEnvelope:
    return ContextEnvelope.model_validate(
        {
            "traceId": "t",
            "capability": "tutor.chat",
            "organizationId": "o",
            "actor": {"userId": "u", "role": "student", "ageBand": "11-13", "firstName": "A"},
            "policy": {"provider": "fake", "showSolutions": False},
            "context": {"gradeLevel": "7", "blocks": []},
            "input": {"messages": [{"role": "user", "content": message}]},
        }
    )


def test_parse_model_verdict_accepts_only_real_verdicts() -> None:
    ok = parse_model_verdict(
        '```json\n{"decision": "block", "scores": {"bullying": 0.9, "sexual": 0.1}, "reason": "demeaning"}\n```'
    )
    assert ok is not None and ok.decision == "block" and ok.categories == ["bullying"] and ok.reason == "demeaning"
    assert parse_model_verdict("") is None
    assert parse_model_verdict("I think this is fine.") is None
    assert parse_model_verdict('{"decision": "maybe"}') is None
    assert parse_model_verdict('{"decision": "allow"}').decision == "allow"  # type: ignore[union-attr]


async def test_model_verdict_refuses_and_garbage_does_not() -> None:
    library = PromptLibrary(ROOT / "prompts")
    blocking = TutorAgent(
        FakeProvider(scripted_replies=['{"decision": "escalate", "scores": {"self_harm": 0.8}, "reason": "hopeless"}']),
        library,
        model_safety=True,
    )
    refused = await blocking.run(_env("everything feels pointless lately"))
    assert refused.status == "refused"
    assert refused.safety.input == "escalate"
    assert "self_harm" in refused.safety.categories
    lenient = TutorAgent(FakeProvider(scripted_replies=["not json at all"]), library, model_safety=True)
    answered = await lenient.run(_env("how do I solve 2x + 3 = 11?"))
    assert answered.status == "ok"
    off = TutorAgent(FakeProvider(scripted_replies=['{"decision": "block"}']), library, model_safety=False)
    assert (await off.run(_env("how do I solve 2x + 3 = 11?"))).status == "ok"
