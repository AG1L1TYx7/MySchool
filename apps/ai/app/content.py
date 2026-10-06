"""Content generation contracts: request, drafts the model must produce, and the job record (docs/10 sections 3, 6, 9)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.envelopes import Actor, ContextBlock

ContentCapability = Literal["content.quiz", "content.flashcards", "content.summary", "content.conference"]
QuestionType = Literal["multiple_choice", "true_false", "fill_blank"]
DEFAULT_QUESTION_TYPES: list[QuestionType] = ["multiple_choice", "true_false"]


class ContentSpec(BaseModel):
    """What the teacher asked for."""

    topic: str = Field(min_length=2, max_length=200)
    subject: str = Field(default="", max_length=100)
    gradeLevel: str = Field(default="7", max_length=10)
    count: int = Field(default=10, ge=3, le=30)
    difficulty: Literal["easy", "medium", "hard", "mixed"] = "mixed"
    questionTypes: list[QuestionType] = Field(default_factory=lambda: list(DEFAULT_QUESTION_TYPES))
    language: str = "en"
    standard: str | None = Field(default=None, max_length=200)
    feedback: str | None = Field(default=None, max_length=2000, description="Teacher guidance when regenerating")
    previousDraft: dict[str, Any] | None = None


class ContentContext(BaseModel):
    courseId: str | None = None
    lessonId: str | None = None
    blocks: list[ContextBlock] = Field(default_factory=list)


class ContentRequest(BaseModel):
    traceId: str
    capability: ContentCapability
    organizationId: str | None = None
    actor: Actor
    request: ContentSpec
    context: ContentContext = Field(default_factory=ContentContext)


# ---------------------------------------------------------------------------
# Drafts: the strict JSON the model must return (prompt files describe the same shape)
# ---------------------------------------------------------------------------


class QuizQuestion(BaseModel):
    type: QuestionType
    prompt: str = Field(min_length=3, max_length=1000)
    options: list[str] = Field(default_factory=list, max_length=8)
    answer: str = Field(min_length=1, max_length=500)
    explanation: str = Field(default="", max_length=1000)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    sourceIds: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_shape(self) -> QuizQuestion:
        self.options = [o.strip() for o in self.options if o and o.strip()]
        self.answer = self.answer.strip()
        if self.type == "multiple_choice":
            if len(self.options) < 2:
                raise ValueError("multiple_choice needs at least two options")
            match = next((o for o in self.options if o.casefold() == self.answer.casefold()), None)
            if match is None:
                raise ValueError("answer must be one of the options")
            self.answer = match
            if len({o.casefold() for o in self.options}) != len(self.options):
                raise ValueError("options must be distinct")
        elif self.type == "true_false":
            a = self.answer.casefold()
            if a in ("true", "t", "yes"):
                self.answer = "true"
            elif a in ("false", "f", "no"):
                self.answer = "false"
            else:
                raise ValueError("true_false answer must be true or false")
            self.options = ["true", "false"]
        return self


class QuizDraft(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    topic: str = ""
    gradeLevel: str = ""
    questions: list[QuizQuestion] = Field(min_length=1, max_length=40)


class Flashcard(BaseModel):
    front: str = Field(min_length=1, max_length=300)
    back: str = Field(min_length=1, max_length=600)
    hint: str | None = Field(default=None, max_length=300)
    sourceIds: list[str] = Field(default_factory=list)


class FlashcardsDraft(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    cards: list[Flashcard] = Field(min_length=1, max_length=60)


class SummaryDraft(BaseModel):
    """A family-language lesson summary a teacher reviews before release (docs/13 section 7)."""

    title: str = Field(min_length=1, max_length=200)
    language: str = Field(default="en", max_length=16)
    summary: str = Field(min_length=20, max_length=4000)
    keyIdeas: list[str] = Field(default_factory=list, max_length=8)
    questionsToAsk: list[str] = Field(default_factory=list, max_length=6)
    tryAtHome: list[str] = Field(default_factory=list, max_length=4)


class ConferenceDraft(BaseModel):
    """Talking points for a family conference, built only from the numbers the LMS supplied."""

    language: str = Field(default="en", max_length=16)
    opening: str = Field(min_length=5, max_length=600)
    strengths: list[str] = Field(default_factory=list, max_length=6)
    concerns: list[str] = Field(default_factory=list, max_length=4)
    talkingPoints: list[str] = Field(min_length=1, max_length=8)
    questionsForFamily: list[str] = Field(default_factory=list, max_length=4)
    nextSteps: list[str] = Field(default_factory=list, max_length=4)


DRAFT_MODELS: dict[str, type[BaseModel]] = {
    "content.quiz": QuizDraft,
    "content.flashcards": FlashcardsDraft,
    "content.summary": SummaryDraft,
    "content.conference": ConferenceDraft,
}


# ---------------------------------------------------------------------------
# Job record (what /v1/jobs/{id} returns)
# ---------------------------------------------------------------------------


class H5pPackage(BaseModel):
    library: str
    title: str
    params: dict[str, Any]
    maxScore: int


class Validation(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)


class ContentUsage(BaseModel):
    promptTokens: int = 0
    completionTokens: int = 0
    latencyMs: int = 0
    repairs: int = 0


class ContentResult(BaseModel):
    promptVersion: str
    model: dict[str, str]
    draft: dict[str, Any]
    h5p: H5pPackage | None = None
    validation: Validation
    usage: ContentUsage
    cached: bool = False


class JobError(BaseModel):
    code: str
    detail: str


JobStatus = Literal["queued", "running", "done", "failed"]


class Job(BaseModel):
    jobId: str
    traceId: str
    capability: str
    status: JobStatus = "queued"
    progress: str = "Queued"
    createdAt: str
    updatedAt: str
    result: ContentResult | None = None
    error: JobError | None = None
