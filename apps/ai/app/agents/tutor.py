"""The Tutor agent: explain, Socratic and homework-help modes with a bounded tool loop (docs/10 section 3)."""

from __future__ import annotations

import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.envelopes import (
    Citation,
    ContextBlock,
    ContextEnvelope,
    ModelInfo,
    ResultEnvelope,
    SafetyDecision,
    TutorOutput,
    Usage,
)
from app.models import ChatResult, ModelProvider, ModelUnavailable, ToolCall, ToolSpec
from app.prompts import Prompt, PromptLibrary
from app.safety import REFUSAL_OUTPUT, classify_rules, refusal_for, strip_personal_data
from app.tools import math_tool

AGE_BAND_LABEL = {
    "5-7": "5 to 7 years old",
    "8-10": "8 to 10 years old",
    "11-13": "11 to 13 years old",
    "14-18": "14 to 18 years old",
    "adult": "an adult",
}
READING_LEVEL = {
    "5-7": "very simple",
    "8-10": "simple",
    "11-13": "clear, everyday",
    "14-18": "clear",
    "adult": "precise",
}
MAX_WORDS = {"5-7": "120", "8-10": "160", "11-13": "220", "14-18": "260", "adult": "300"}
PROFILE_BY_CAPABILITY = {"tutor.chat": "default", "tutor.socratic": "socratic", "tutor.homework_help": "homework-help"}

_CITATION = re.compile(r"\[(C\d+)\]")

ToolFn = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass
class StreamState:
    """What a streamed turn learned on the way: tool blocks (for citations) and token usage."""

    blocks: list[ContextBlock] = field(default_factory=list)
    tool_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0


def chunk_text(text: str) -> list[str]:
    """Splits finished text into word-sized pieces so a non-streamed answer still arrives as tokens."""
    return re.findall(r"\S+\s*|\s+", text)


@dataclass
class ToolBox:
    specs: list[ToolSpec]
    handlers: dict[str, ToolFn]


def tutor_tools(rag_search: ToolFn | None) -> ToolBox:
    specs = [
        ToolSpec(
            name="math_evaluate",
            description="Evaluate an arithmetic expression or check whether two expressions are equal. Use it to verify numbers before stating them.",
            parameters={
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "Expression such as 2*(3+4)/7"},
                    "left": {"type": "string"},
                    "right": {"type": "string"},
                    "variables": {"type": "object", "additionalProperties": {"type": "number"}},
                },
            },
        )
    ]

    async def math_handler(args: dict[str, Any]) -> dict[str, Any]:
        return math_tool.run_tool(args)

    handlers: dict[str, ToolFn] = {"math_evaluate": math_handler}
    if rag_search is not None:
        specs.append(
            ToolSpec(
                name="rag_search",
                description="Search the student's course material for a topic. Returns short excerpts with ids you can cite.",
                parameters={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
            )
        )
        handlers["rag_search"] = rag_search
    return ToolBox(specs, handlers)


def render_system_prompt(prompt: Prompt, env: ContextEnvelope, blocks: list[ContextBlock]) -> str:
    band = env.actor.ageBand
    ctx = env.context
    grade = ctx.gradeLevel or "unknown"
    accessibility = f"Accessibility notes from the teacher: {ctx.accessibilityNeeds}." if ctx.accessibilityNeeds else ""
    rendered_blocks = (
        "\n\n".join(f'<CONTEXT id="{b.id}" label="{b.label}">\n{b.text}\n</CONTEXT>' for b in blocks)
        or "(no context blocks)"
    )
    values = {
        "ageBandLabel": AGE_BAND_LABEL.get(band, "a student"),
        "gradeLevel": grade,
        "readingLevel": READING_LEVEL.get(band, "clear"),
        "accessibilityNotes": accessibility,
        "language": env.policy.language,
        "maxWords": MAX_WORDS.get(band, "250"),
        "contextBlocks": rendered_blocks,
        "conversationSummary": ctx.conversationSummary or "(start of conversation)",
        "solutionsPolicy": "solutions allowed" if env.policy.showSolutions else "hints only",
    }
    return prompt.render(values)


def build_messages(system_prompt: str, env: ContextEnvelope) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for m in env.input.messages:
        content = f"<STUDENT>\n{m.content}\n</STUDENT>" if m.role == "user" else m.content
        messages.append({"role": m.role, "content": content})
    return messages


def extract_citations(content: str, blocks: list[ContextBlock]) -> tuple[str, list[Citation]]:
    """Keeps citations that match a real block id and removes the ones the model invented."""
    by_id = {b.id: b for b in blocks}
    seen: list[Citation] = []
    for match in _CITATION.findall(content):
        if match in by_id and all(c.blockId != match for c in seen):
            seen.append(Citation(blockId=match, label=by_id[match].label))
    cleaned = _CITATION.sub(lambda m: m.group(0) if m.group(1) in by_id else "", content)
    return re.sub(r"[ \t]+\n", "\n", cleaned).strip(), seen


def next_steps_from(content: str) -> list[str]:
    """The closing question (the prompts end every reply with one) becomes the suggested next step."""
    sentences = [s.strip() for s in re.split(r"(?<=[.?!])\s+", content) if s.strip()]
    return [sentences[-1]] if sentences and sentences[-1].endswith("?") else []


class TutorAgent:
    def __init__(
        self,
        provider: ModelProvider,
        library: PromptLibrary,
        *,
        max_tool_calls: int = 4,
        timeout: float = 30.0,
        model_safety: bool = False,
        tool_timeout: float = 5.0,
    ):
        self.provider = provider
        self.library = library
        self.max_tool_calls = max_tool_calls
        self.timeout = timeout
        self.tool_timeout = tool_timeout
        self.model_safety = model_safety

    def _prompt_for(self, env: ContextEnvelope) -> Prompt:
        profile = PROFILE_BY_CAPABILITY.get(env.capability, "default")
        return self.library.get("tutor.chat" if env.capability == "tutor.chat" else env.capability, profile)

    async def run(self, env: ContextEnvelope, rag_search: ToolFn | None = None) -> ResultEnvelope:
        started = time.monotonic()
        prompt = self._prompt_for(env)
        model = ModelInfo(provider=self.provider.name, name=prompt.model)
        last_user = env.input.messages[-1].content
        safety = SafetyDecision()

        rules = classify_rules(last_user, env.actor.ageBand)
        safety.categories = list(rules.categories)
        if rules.decision != "allow":
            safety.input = rules.decision
            return ResultEnvelope(
                traceId=env.traceId,
                capability=env.capability,
                promptVersion=prompt.version_tag,
                model=model,
                output=TutorOutput(content=refusal_for(rules)),
                safety=safety,
                usage=Usage(latencyMs=int((time.monotonic() - started) * 1000)),
                status="refused",
            )

        blocks = list(env.context.blocks)
        toolbox = tutor_tools(rag_search)
        messages = build_messages(render_system_prompt(prompt, env, blocks), env)
        tool_calls_made = 0
        prompt_tokens = completion_tokens = 0
        result: ChatResult | None = None
        try:
            while True:
                result = await self.provider.chat(
                    messages,
                    model=prompt.model,
                    temperature=prompt.temperature,
                    max_tokens=prompt.max_output_tokens,
                    tools=toolbox.specs if tool_calls_made < self.max_tool_calls else None,
                    timeout=self.timeout,
                )
                prompt_tokens += result.prompt_tokens
                completion_tokens += result.completion_tokens
                if not result.tool_calls or tool_calls_made >= self.max_tool_calls:
                    break
                for call in result.tool_calls[: self.max_tool_calls - tool_calls_made]:
                    tool_calls_made += 1
                    block = await self._execute(call, toolbox, len(blocks) + 1)
                    if block is not None:
                        blocks.append(block)
                        messages.append(
                            {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{"function": {"name": call.name, "arguments": call.arguments}}],
                            }
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "content": f'<CONTEXT id="{block.id}" label="{block.label}">\n{block.text}\n</CONTEXT>',
                            }
                        )
                messages[0] = {"role": "system", "content": render_system_prompt(prompt, env, blocks)}
        except ModelUnavailable:
            return ResultEnvelope(
                traceId=env.traceId,
                capability=env.capability,
                promptVersion=prompt.version_tag,
                model=model,
                output=TutorOutput(content=""),
                safety=safety,
                usage=Usage(
                    promptTokens=prompt_tokens,
                    completionTokens=completion_tokens,
                    latencyMs=int((time.monotonic() - started) * 1000),
                    toolCalls=tool_calls_made,
                ),
                status="unavailable",
            )

        content = strip_personal_data(result.content if result else "")
        output_rules = classify_rules(content, env.actor.ageBand)
        if output_rules.decision != "allow":
            safety.output = output_rules.decision
            safety.categories = sorted(set(safety.categories) | set(output_rules.categories))
            content, citations = REFUSAL_OUTPUT, []
            status = "refused"
        else:
            content, citations = extract_citations(content, blocks)
            status = "ok"
        return ResultEnvelope(
            traceId=env.traceId,
            capability=env.capability,
            promptVersion=prompt.version_tag,
            model=model,
            output=TutorOutput(content=content, citations=citations, nextSteps=next_steps_from(content)),
            safety=safety,
            usage=Usage(
                promptTokens=prompt_tokens,
                completionTokens=completion_tokens,
                latencyMs=int((time.monotonic() - started) * 1000),
                toolCalls=tool_calls_made,
            ),
            status=status,
        )

    async def stream(
        self,
        env: ContextEnvelope,
        rag_search: ToolFn | None = None,
        state: StreamState | None = None,
    ) -> AsyncIterator[str]:
        """Token stream. Tools cannot run mid-stream, so tool rounds happen first (non-streamed) and the
        answer streams afterwards; when the model answers without tools that text is delivered in word
        chunks. The caller applies safety to the final text and reads tool blocks and usage from `state`."""
        state = state if state is not None else StreamState()
        prompt = self._prompt_for(env)
        blocks = list(env.context.blocks)
        state.blocks = blocks
        toolbox = tutor_tools(rag_search)
        messages = build_messages(render_system_prompt(prompt, env, blocks), env)
        while state.tool_calls < self.max_tool_calls:
            result = await self.provider.chat(
                messages,
                model=prompt.model,
                temperature=prompt.temperature,
                max_tokens=prompt.max_output_tokens,
                tools=toolbox.specs,
                timeout=self.timeout,
            )
            state.prompt_tokens += result.prompt_tokens
            state.completion_tokens += result.completion_tokens
            if not result.tool_calls:
                for piece in chunk_text(result.content):
                    yield piece
                return
            for call in result.tool_calls[: self.max_tool_calls - state.tool_calls]:
                state.tool_calls += 1
                block = await self._execute(call, toolbox, len(blocks) + 1)
                if block is None:
                    continue
                blocks.append(block)
                messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{"function": {"name": call.name, "arguments": call.arguments}}],
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "content": f'<CONTEXT id="{block.id}" label="{block.label}">\n{block.text}\n</CONTEXT>',
                    }
                )
            messages[0] = {"role": "system", "content": render_system_prompt(prompt, env, blocks)}
        async for token in self.provider.stream(
            messages,
            model=prompt.model,
            temperature=prompt.temperature,
            max_tokens=prompt.max_output_tokens,
            timeout=self.timeout,
        ):
            yield token

    async def _execute(self, call: ToolCall, toolbox: ToolBox, next_index: int) -> ContextBlock | None:
        handler = toolbox.handlers.get(call.name)
        if handler is None:
            return None
        try:
            payload = await handler(call.arguments)
        except Exception as e:  # noqa: BLE001 - a failing tool must not fail the answer
            payload = {"ok": False, "error": str(e)}
        text = str(payload)[:8000]
        return ContextBlock(id=f"C{next_index}", label=f"Tool: {call.name}", text=text)
