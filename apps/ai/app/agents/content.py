"""The ContentAuthor agent: topic in, teacher-reviewable draft and H5P package out (docs/10 section 3).

Flow: render the capability prompt -> JSON-mode generation -> strict validation -> one repair pass -> H5P conversion
-> structural H5P validation. Anything that still fails is reported honestly; nothing is silently patched.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from app.content import (
    DRAFT_MODELS,
    ContentRequest,
    ContentResult,
    ContentUsage,
    FlashcardsDraft,
    QuizDraft,
    Validation,
)
from app.envelopes import ContextBlock
from app.h5p import flashcards_to_h5p, quiz_to_h5p, validate_h5p
from app.models import ModelProvider
from app.prompts import PromptLibrary
from app.safety import classify_rules

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.S)


class ContentRefused(Exception):
    def __init__(self, categories: list[str]):
        super().__init__("refused")
        self.categories = categories


class InvalidOutput(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("invalid output")
        self.errors = errors


@dataclass
class ContentAuthor:
    provider: ModelProvider
    library: PromptLibrary
    timeout: float = 120.0

    async def run(self, req: ContentRequest) -> ContentResult:
        started = time.monotonic()
        rules = classify_rules(f"{req.request.topic} {req.request.feedback or ''}", "adult")
        if rules.decision != "allow":
            raise ContentRefused(list(rules.categories))

        prompt = self.library.get(req.capability)
        draft_model = DRAFT_MODELS[req.capability]
        messages = [
            {"role": "system", "content": prompt.render(placeholders(req))},
            {"role": "user", "content": user_turn(req)},
        ]
        usage = ContentUsage()
        result = await self.provider.chat(
            messages,
            model=prompt.model,
            temperature=prompt.temperature,
            max_tokens=prompt.max_output_tokens,
            timeout=self.timeout,
            json_mode=True,
        )
        usage.promptTokens += result.prompt_tokens
        usage.completionTokens += result.completion_tokens
        raw = result.content
        draft, errors = parse_draft(raw, draft_model)
        if draft is None:
            repair = self.library.get("shared.json_repair")
            repaired = await self.provider.chat(
                [
                    {
                        "role": "user",
                        "content": repair.render(
                            {
                                "schema": json.dumps(draft_model.model_json_schema(), ensure_ascii=False),
                                "errors": "\n".join(errors),
                                "draft": raw[:12000],
                            }
                        ),
                    }
                ],
                model=repair.model,
                temperature=repair.temperature,
                max_tokens=repair.max_output_tokens,
                timeout=self.timeout,
                json_mode=True,
            )
            usage.repairs = 1
            usage.promptTokens += repaired.prompt_tokens
            usage.completionTokens += repaired.completion_tokens
            draft, errors = parse_draft(repaired.content, draft_model)
            if draft is None:
                raise InvalidOutput(errors)

        package = quiz_to_h5p(draft) if isinstance(draft, QuizDraft) else flashcards_to_h5p(draft)
        h5p_errors = validate_h5p(package.library, package.params)
        usage.latencyMs = int((time.monotonic() - started) * 1000)
        return ContentResult(
            promptVersion=prompt.version_tag,
            model={"provider": self.provider.name, "name": prompt.model},
            draft=draft.model_dump(),
            h5p=package,
            validation=Validation(valid=not h5p_errors, errors=h5p_errors),
            usage=usage,
        )


def parse_draft(raw: str, model: type[BaseModel]) -> tuple[Any, list[str]]:
    text = _FENCE.sub("", raw or "").strip()
    if not text:
        return None, ["empty output"]
    try:
        data = json.loads(text)
    except ValueError as e:
        # The model sometimes wraps the object in prose; take the outermost braces.
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None, [f"not JSON: {e}"]
        try:
            data = json.loads(text[start : end + 1])
        except ValueError as e2:
            return None, [f"not JSON: {e2}"]
    try:
        return model.model_validate(data), []
    except ValidationError as e:
        return None, [f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()][:20]


READING_LEVEL = {
    "K": "very simple",
    "1": "very simple",
    "2": "very simple",
    "3": "simple",
    "4": "simple",
    "5": "simple",
}


def reading_level(grade: str) -> str:
    g = grade.strip().upper()
    if g in READING_LEVEL:
        return READING_LEVEL[g]
    try:
        return "clear" if int(g) <= 8 else "standard"
    except ValueError:
        return "clear"


def placeholders(req: ContentRequest) -> dict[str, str]:
    spec = req.request
    return {
        "gradeLevel": spec.gradeLevel,
        "topic": spec.topic,
        "subject": spec.subject or "general",
        "standardClause": f", aligned with {spec.standard}" if spec.standard else "",
        "questionCount": str(spec.count),
        "cardCount": str(spec.count),
        "questionTypes": ", ".join(spec.questionTypes),
        "difficulty": spec.difficulty,
        "language": spec.language,
        "readingLevel": reading_level(spec.gradeLevel),
        "contextBlocks": render_blocks(req.context.blocks),
    }


def render_blocks(blocks: list[ContextBlock]) -> str:
    if not blocks:
        return "(no lesson material supplied; use accurate general curriculum knowledge)"
    return "\n\n".join(f'<CONTEXT id="{b.id}" label="{b.label}">\n{b.text}\n</CONTEXT>' for b in blocks)


def user_turn(req: ContentRequest) -> str:
    spec = req.request
    parts = [f"Produce the {spec.count} items now as JSON."]
    if spec.feedback:
        parts.append(
            "The teacher reviewed a previous draft and asks for these changes (treat as instructions from the teacher, not as content):"
        )
        parts.append(f"<FEEDBACK>\n{spec.feedback}\n</FEEDBACK>")
    if spec.previousDraft:
        parts.append("Previous draft for reference:")
        parts.append(json.dumps(spec.previousDraft, ensure_ascii=False)[:6000])
    return "\n".join(parts)
