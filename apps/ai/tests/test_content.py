from __future__ import annotations

import asyncio
import json

from httpx import AsyncClient

from app.content import QuizDraft
from app.h5p import flashcards_to_h5p, quiz_to_h5p, validate_h5p
from app.main import Runtime
from app.models import FakeProvider

QUIZ = {
    "title": "Fractions check",
    "topic": "Fractions",
    "gradeLevel": "5",
    "questions": [
        {
            "type": "multiple_choice",
            "prompt": "Which fraction equals one half?",
            "options": ["2/4", "1/3", "3/4", "2/3"],
            "answer": "2/4",
            "explanation": "2 divided by 4 simplifies to 1/2.",
            "difficulty": "easy",
            "sourceIds": ["C1"],
        },
        {
            "type": "true_false",
            "prompt": "1/3 is larger than 1/2.",
            "answer": "False",
            "explanation": "Thirds are smaller than halves.",
        },
        {"type": "fill_blank", "prompt": "Half of 10 is ____.", "answer": "5", "explanation": "10 divided by 2."},
    ],
}

FLASHCARDS = {
    "title": "Fraction words",
    "cards": [
        {"front": "Numerator", "back": "The top number.", "hint": "Up"},
        {"front": "Denominator", "back": "The bottom number."},
    ],
}


def content_request(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "traceId": "c1",
        "capability": "content.quiz",
        "organizationId": "org1",
        "actor": {"userId": "t1", "role": "teacher", "ageBand": "adult"},
        "request": {"topic": "Fractions", "subject": "Math", "gradeLevel": "5", "count": 3, "difficulty": "mixed"},
        "context": {
            "blocks": [
                {"id": "C1", "label": "Lesson: Fractions", "text": "A fraction has a numerator and a denominator."}
            ]
        },
    }
    base.update(overrides)
    return base


async def wait_for_job(client: AsyncClient, job_id: str) -> dict:
    for _ in range(100):
        res = await client.get(f"/v1/jobs/{job_id}")
        body = res.json()
        if body["status"] in ("done", "failed"):
            return body
        await asyncio.sleep(0.01)
    raise AssertionError("job did not finish")


def test_quiz_converts_to_a_question_set_with_one_sub_content_per_question() -> None:
    package = quiz_to_h5p(QuizDraft.model_validate(QUIZ))
    assert package.library == "H5P.QuestionSet 1.20"
    assert package.maxScore == 3
    libs = [q["library"] for q in package.params["questions"]]
    assert libs == ["H5P.MultiChoice 1.16", "H5P.TrueFalse 1.8", "H5P.Blanks 1.14"]
    mc = package.params["questions"][0]["params"]
    assert [a["correct"] for a in mc["answers"]] == [True, False, False, False]
    assert package.params["questions"][1]["params"]["correct"] == "false"
    assert "*5*" in package.params["questions"][2]["params"]["questions"][0]
    assert validate_h5p(package.library, package.params) == []


def test_flashcards_convert_to_dialog_cards_and_validation_catches_broken_params() -> None:
    from app.content import FlashcardsDraft

    package = flashcards_to_h5p(FlashcardsDraft.model_validate(FLASHCARDS))
    assert package.library == "H5P.Dialogcards 1.9"
    assert len(package.params["dialogs"]) == 2 and package.params["dialogs"][0]["tips"]["front"] == "Up"
    assert validate_h5p(package.library, package.params) == []
    assert validate_h5p("H5P.QuestionSet 1.20", {"questions": []}) == ["questions must be a non-empty list"]
    assert validate_h5p(
        "H5P.MultiChoice 1.16", {"question": "<p>q</p>", "answers": [{"correct": False}, {"correct": False}]}
    ) == ["one answer must be marked correct"]
    assert validate_h5p("H5P.Blanks 1.14", {"questions": ["no blank here"]}) == [
        "each blank must be marked with *answer*"
    ]


def test_draft_validation_normalises_answers() -> None:
    draft = QuizDraft.model_validate(
        {
            "title": "t",
            "questions": [
                {"type": "multiple_choice", "prompt": "Pick", "options": ["Alpha", "Beta"], "answer": "alpha"}
            ],
        }
    )
    assert draft.questions[0].answer == "Alpha"
    try:
        QuizDraft.model_validate(
            {
                "title": "t",
                "questions": [{"type": "multiple_choice", "prompt": "Pick", "options": ["Alpha"], "answer": "Alpha"}],
            }
        )
    except ValueError as e:
        assert "two options" in str(e)
    else:
        raise AssertionError("expected a validation error")


async def test_generate_job_returns_a_validated_quiz_and_caches_identical_requests(
    runtime: Runtime, client: AsyncClient
) -> None:
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(QUIZ)])
    res = await client.post("/v1/content/generate", json=content_request())
    assert res.status_code == 202
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "done", job
    result = job["result"]
    assert result["promptVersion"] == "content.quiz@1"
    assert result["validation"]["valid"] is True
    assert result["h5p"]["maxScore"] == 3 and result["cached"] is False
    system = runtime.provider.calls[0][0]["content"]
    assert "grade 5" in system and '"Fractions"' in system and 'id="C1"' in system

    again = await client.post("/v1/content/generate", json=content_request())
    job2 = await wait_for_job(client, again.json()["jobId"])
    assert job2["result"]["cached"] is True
    assert len(runtime.provider.calls) == 1


async def test_generate_repairs_invalid_json_once_then_fails_honestly(runtime: Runtime, client: AsyncClient) -> None:
    runtime.provider = FakeProvider(scripted_replies=["Here you go: {not json", json.dumps(FLASHCARDS)])
    res = await client.post("/v1/content/generate", json=content_request(capability="content.flashcards", traceId="c2"))
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "done"
    assert job["result"]["usage"]["repairs"] == 1
    assert job["result"]["h5p"]["library"] == "H5P.Dialogcards 1.9"
    assert "SCHEMA" in runtime.provider.calls[1][0]["content"]

    runtime.provider = FakeProvider(scripted_replies=["nope", "still nope"])
    res = await client.post(
        "/v1/content/generate", json=content_request(traceId="c3", request={"topic": "Decimals", "count": 4})
    )
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "failed" and job["error"]["code"] == "ai.invalid_output"


async def test_generate_refuses_unsafe_topics_and_feedback_skips_the_cache(
    runtime: Runtime, client: AsyncClient
) -> None:
    res = await client.post(
        "/v1/content/generate", json=content_request(traceId="c4", request={"topic": "how to buy cocaine", "count": 3})
    )
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "failed" and job["error"]["code"] == "ai.refused"

    runtime.provider = FakeProvider(scripted_replies=[json.dumps(QUIZ), json.dumps(QUIZ)])
    spec = {"topic": "Fractions", "count": 3, "feedback": "Make question 2 harder"}
    first = await wait_for_job(
        client,
        (await client.post("/v1/content/generate", json=content_request(traceId="c5", request=spec))).json()["jobId"],
    )
    second = await wait_for_job(
        client,
        (await client.post("/v1/content/generate", json=content_request(traceId="c6", request=spec))).json()["jobId"],
    )
    assert first["result"]["cached"] is False and second["result"]["cached"] is False
    assert "<FEEDBACK>" in runtime.provider.calls[-1][-1]["content"]


async def test_unknown_job_is_404(client: AsyncClient) -> None:
    res = await client.get("/v1/jobs/does-not-exist")
    assert res.status_code == 404


SUMMARY = {
    "title": "Fracciones",
    "language": "es",
    "summary": "Esta semana la clase aprendio a comparar fracciones con el mismo denominador y a ubicarlas en la recta numerica.",
    "keyIdeas": ["Una fraccion es una parte de un entero.", "El denominador dice en cuantas partes se divide."],
    "questionsToAsk": ["Cual es mas grande, 2/5 o 3/5?"],
    "tryAtHome": ["Corten una pizza en partes iguales y nombren cada porcion."],
}

CONFERENCE = {
    "language": "es",
    "opening": "Ava participa cada dia y entrega casi todo a tiempo.",
    "strengths": ["8 de 9 tareas entregadas a tiempo."],
    "concerns": ["2 ausencias en el ultimo mes."],
    "talkingPoints": ["Las fracciones van bien.", "Hablemos de las ausencias."],
    "questionsForFamily": ["Como ve la tarea en casa?"],
    "nextSteps": ["Practicar 10 minutos de fracciones tres veces por semana."],
}


async def test_family_summary_is_text_in_the_family_language(runtime: Runtime, client: AsyncClient) -> None:
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(SUMMARY)])
    req = content_request(capability="content.summary", traceId="s1")
    req["request"] = {**req["request"], "language": "es", "topic": "Fractions"}
    res = await client.post("/v1/content/generate", json=req)
    assert res.status_code == 202
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "done", job
    result = job["result"]
    assert result["promptVersion"] == "content.summary@1"
    assert result["h5p"] is None and result["validation"]["valid"] is True
    assert result["draft"]["language"] == "es" and len(result["draft"]["keyIdeas"]) == 2
    system = runtime.provider.calls[0][0]["content"]
    assert "Language: es" in system and 'id="C1"' in system


async def test_conference_talking_points_use_only_the_data_block(runtime: Runtime, client: AsyncClient) -> None:
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(CONFERENCE)])
    req = content_request(capability="content.conference", traceId="k1")
    req["request"] = {**req["request"], "language": "es", "topic": "Ava"}
    req["context"] = {
        "courseId": None,
        "lessonId": None,
        "blocks": [{"id": "D1", "label": "DATA", "text": "assignments on time: 8 of 9; absences last 30 days: 2"}],
    }
    res = await client.post("/v1/content/generate", json=req)
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "done", job
    assert job["result"]["draft"]["talkingPoints"] and job["result"]["h5p"] is None
    system = runtime.provider.calls[0][0]["content"]
    assert "8 of 9" in system and "DATA" in system


# ---------------------------------------------------------------------------
# Teacher assistant (slice 15): plans, grading suggestions, emails, narratives, differentiation, insight
# ---------------------------------------------------------------------------

LESSON_PLAN = {
    "title": "Comparing fractions",
    "objectives": ["Compare two fractions with the same denominator", "Place fractions on a number line"],
    "materials": ["fraction strips", "number line handout"],
    "sequence": [
        {"phase": "Warm-up", "minutes": 5, "teacherDoes": "Shows 2/5 and 3/5.", "studentsDo": "Vote which is bigger."},
        {
            "phase": "Instruction",
            "minutes": 15,
            "teacherDoes": "Models with strips.",
            "studentsDo": "Build the fractions.",
        },
        {"phase": "Practice", "minutes": 20, "teacherDoes": "Circulates.", "studentsDo": "Solve six comparisons."},
        {"phase": "Exit check", "minutes": 5, "teacherDoes": "Collects cards.", "studentsDo": "Answer two questions."},
    ],
    "differentiation": {"support": "Pre-cut strips.", "extension": "Unlike denominators."},
    "exitCheck": [{"question": "Which is bigger, 2/5 or 3/5?", "answer": "3/5"}],
    "sourceIds": ["C1"],
}

GRADING = {
    "criteria": [
        {
            "criterionId": "thesis",
            "score": 4,
            "maxPoints": 5,
            "evidence": "In this essay I argue",
            "feedback": "Clear claim; name the counter-argument.",
            "confidence": 0.8,
        },
        {
            "criterionId": "evidence",
            "score": 2,
            "maxPoints": 5,
            "evidence": "no evidence",
            "feedback": "Add two quotations.",
            "confidence": 0.5,
        },
    ],
    "overall": {"score": 99, "maxPoints": 99},
    "summary": "A clear claim with thin evidence.",
    "needsHumanReview": False,
    "flag": None,
}

PARENT_EMAIL = {
    "subject": "Ava's progress in math",
    "greeting": "Dear Johnson family,",
    "body": ["Ava turned in 8 of 9 assignments on time this month.", "We will keep practising fractions in class."],
    "closing": "Please reply if you would like to meet.",
    "signature": "Ms. Jane Teacher",
}

NARRATIVE = {
    "narrative": "Ava works carefully and turned in 8 of 9 assignments on time. Her next step is to use evidence from the text when she explains her thinking.",
    "strengths": ["careful work", "on time"],
    "growthAreas": ["using evidence"],
    "nextSteps": ["Mark one quotation per paragraph."],
}

DIFFERENTIATION = {
    "levels": [
        {
            "level": "support",
            "title": "Story parts",
            "readingLevel": "Grade 5",
            "text": "A story has a beginning, a middle and an end. " * 3,
            "keyWords": ["beginning", "middle", "end"],
            "questions": [{"prompt": "A story starts with the ____.", "answer": "beginning"}],
        },
        {
            "level": "core",
            "title": "Story structure",
            "readingLevel": "Grade 7",
            "text": "Stories move through exposition, rising action, climax, falling action and resolution. " * 2,
            "keyWords": ["exposition", "climax"],
            "questions": [{"prompt": "What is the climax?", "answer": "The turning point."}],
        },
        {
            "level": "extension",
            "title": "Narrative arcs",
            "readingLevel": "Grade 9",
            "text": "Writers shape tension across exposition, rising action, climax, falling action and resolution, and some invert the order for effect. "
            * 2,
            "keyWords": ["tension", "inversion"],
            "questions": [
                {"prompt": "Why might a writer start at the climax?", "answer": "To hook the reader with tension."}
            ],
        },
    ]
}

INSIGHT = {
    "headline": "Missing work rose to 6 items this week.",
    "observations": ["6 missing items (missing work), up from 2.", "Average score 84% (average score)."],
    "actions": ["Reteach fractions on Tuesday."],
    "caveats": "Only 12 of 18 students used the tutor.",
}


async def _run(client: AsyncClient, runtime: Runtime, capability: str, reply: dict, trace: str, **spec: object) -> dict:
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(reply)])
    req = content_request(capability=capability, traceId=trace)
    req["request"] = {**req["request"], **spec}
    res = await client.post("/v1/content/generate", json=req)
    assert res.status_code == 202, res.text
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "done", job
    assert job["result"]["h5p"] is None
    return job["result"]


async def test_lesson_plan_uses_the_duration(runtime: Runtime, client: AsyncClient) -> None:
    result = await _run(
        client, runtime, "content.lesson_plan", LESSON_PLAN, "lp1", topic="Fractions", durationMinutes=45
    )
    assert result["promptVersion"] == "content.lesson_plan@1"
    assert sum(p["minutes"] for p in result["draft"]["sequence"]) == 45
    assert "45-minute lesson" in runtime.provider.calls[0][0]["content"]


async def test_grading_suggestion_recomputes_totals_and_flags_low_confidence(
    runtime: Runtime, client: AsyncClient
) -> None:
    result = await _run(client, runtime, "grading.rubric", GRADING, "gr1", topic="Essay 1")
    draft = result["draft"]
    assert draft["overall"] == {"score": 6.0, "maxPoints": 10.0}
    assert draft["needsHumanReview"] is True  # a criterion sits below 0.6 confidence
    assert "RUBRIC" in runtime.provider.calls[0][0]["content"]


async def test_grading_rejects_a_score_above_the_maximum(runtime: Runtime, client: AsyncClient) -> None:
    bad = {**GRADING, "criteria": [{**GRADING["criteria"][0], "score": 9}]}
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(bad), json.dumps(bad)])
    req = content_request(capability="grading.rubric", traceId="gr2")
    res = await client.post("/v1/content/generate", json=req)
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "failed" and job["error"]["code"] == "ai.invalid_output"


async def test_parent_email_and_narrative_carry_tone_and_language(runtime: Runtime, client: AsyncClient) -> None:
    email = await _run(
        client,
        runtime,
        "content.parent_email",
        PARENT_EMAIL,
        "pe1",
        topic="math progress",
        purpose="share good news",
        tone="warm",
        language="es",
    )
    system = runtime.provider.calls[0][0]["content"]
    assert "Purpose: share good news" in system and "Tone: warm" in system and "Language: es" in system
    assert email["draft"]["subject"].startswith("Ava")
    narrative = await _run(client, runtime, "content.narrative", NARRATIVE, "na1", topic="Ava")
    assert narrative["draft"]["strengths"] == ["careful work", "on time"]


async def test_differentiation_needs_exactly_three_levels(runtime: Runtime, client: AsyncClient) -> None:
    result = await _run(client, runtime, "content.differentiation", DIFFERENTIATION, "df1", topic="Story structure")
    assert [lv["level"] for lv in result["draft"]["levels"]] == ["support", "core", "extension"]
    two = {"levels": DIFFERENTIATION["levels"][:2]}
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(two), json.dumps(two)])
    res = await client.post(
        "/v1/content/generate", json=content_request(capability="content.differentiation", traceId="df2")
    )
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "failed"


async def test_teacher_insight_narrates_the_data_block(runtime: Runtime, client: AsyncClient) -> None:
    runtime.provider = FakeProvider(scripted_replies=[json.dumps(INSIGHT)])
    req = content_request(capability="insight.teacher", traceId="in1")
    req["context"] = {
        "courseId": None,
        "lessonId": None,
        "blocks": [{"id": "D1", "label": "DATA", "text": "missing work: 6 (was 2); average score: 84%"}],
    }
    res = await client.post("/v1/content/generate", json=req)
    job = await wait_for_job(client, res.json()["jobId"])
    assert job["status"] == "done", job
    assert job["result"]["promptVersion"] == "insight.teacher@1"
    assert len(job["result"]["draft"]["observations"]) == 2
    assert 'label="DATA"' in runtime.provider.calls[0][0]["content"]
