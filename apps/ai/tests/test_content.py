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
