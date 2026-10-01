"""Context Envelope (LMS -> AI) and Result Envelope (AI -> LMS), docs/10 section 5."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AgeBand = Literal["5-7", "8-10", "11-13", "14-18", "adult"]
Capability = Literal["tutor.chat", "tutor.socratic", "tutor.homework_help", "safety.classify"]


class Actor(BaseModel):
    userId: str
    role: str
    ageBand: AgeBand = "adult"
    firstName: str | None = None


class Policy(BaseModel):
    provider: Literal["ollama", "fake"] = "ollama"
    showSolutions: bool = False
    maxOutputTokens: int = Field(default=700, ge=50, le=4000)
    language: str = "en"


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ContextBlock(BaseModel):
    """A delimited, citable block the model may quote: lesson text, student context, tool results."""

    id: str
    label: str
    text: str = Field(max_length=12000)


class TutorContext(BaseModel):
    studentId: str | None = None
    classId: str | None = None
    courseId: str | None = None
    lessonId: str | None = None
    gradeLevel: str | None = None
    learningStyle: str | None = None
    accessibilityNeeds: str | None = None
    conversationSummary: str | None = None
    blocks: list[ContextBlock] = Field(default_factory=list)


class TutorInput(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)


class Options(BaseModel):
    stream: bool = False


class ContextEnvelope(BaseModel):
    traceId: str
    capability: Capability
    promptProfile: str = "default"
    organizationId: str | None = None
    actor: Actor
    policy: Policy = Field(default_factory=Policy)
    context: TutorContext = Field(default_factory=TutorContext)
    input: TutorInput
    options: Options = Field(default_factory=Options)


class Citation(BaseModel):
    blockId: str
    label: str


class SafetyDecision(BaseModel):
    input: Literal["allow", "block", "escalate"] = "allow"
    output: Literal["allow", "block", "escalate"] = "allow"
    categories: list[str] = Field(default_factory=list)


class Usage(BaseModel):
    promptTokens: int = 0
    completionTokens: int = 0
    latencyMs: int = 0
    toolCalls: int = 0


class ModelInfo(BaseModel):
    provider: str
    name: str


class TutorOutput(BaseModel):
    content: str
    citations: list[Citation] = Field(default_factory=list)
    nextSteps: list[str] = Field(default_factory=list)


class ResultEnvelope(BaseModel):
    traceId: str
    capability: Capability
    promptVersion: str
    model: ModelInfo
    output: TutorOutput
    safety: SafetyDecision
    usage: Usage
    status: Literal["ok", "refused", "degraded", "unavailable"] = "ok"
