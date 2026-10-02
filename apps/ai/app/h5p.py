"""Conversion of validated drafts into H5P content parameters, and structural validation of those parameters.

Library versions match the packages the web client serves (apps/web/scripts/h5p-setup.mjs downloads them from the H5P hub).
"""

from __future__ import annotations

import html
import re
import uuid
from typing import Any

from app.content import FlashcardsDraft, H5pPackage, QuizDraft, QuizQuestion

QUESTION_SET = "H5P.QuestionSet 1.20"
MULTI_CHOICE = "H5P.MultiChoice 1.16"
TRUE_FALSE = "H5P.TrueFalse 1.8"
BLANKS = "H5P.Blanks 1.14"
DIALOG_CARDS = "H5P.Dialogcards 1.9"

_BLANK = re.compile(r"_{2,}|\[blank\]|\(blank\)", re.I)


def _p(text: str) -> str:
    return f"<p>{html.escape(text.strip())}</p>"


def _sub(library: str, params: dict[str, Any], title: str, content_type: str) -> dict[str, Any]:
    return {
        "library": library,
        "params": params,
        "subContentId": str(uuid.uuid4()),
        "metadata": {"contentType": content_type, "license": "U", "title": title[:120]},
    }


def _behaviour() -> dict[str, Any]:
    return {
        "enableRetry": True,
        "enableSolutionsButton": True,
        "enableCheckButton": True,
        "confirmCheckDialog": False,
        "confirmRetryDialog": False,
        "autoCheck": False,
    }


def multi_choice(q: QuizQuestion) -> dict[str, Any]:
    answers = []
    for option in q.options:
        correct = option == q.answer
        answers.append(
            {
                "text": f"<div>{html.escape(option)}</div>",
                "correct": correct,
                "tipsAndFeedback": {
                    "tip": "",
                    "chosenFeedback": f"<div>{html.escape(q.explanation)}</div>" if correct and q.explanation else "",
                    "notChosenFeedback": "",
                },
            }
        )
    return _sub(
        MULTI_CHOICE,
        {
            "question": _p(q.prompt),
            "answers": answers,
            "behaviour": {
                **_behaviour(),
                "type": "auto",
                "singlePoint": True,
                "randomAnswers": True,
                "showSolutionsRequiresInput": True,
                "passPercentage": 100,
                "showScorePoints": True,
            },
            "overallFeedback": [{"from": 0, "to": 100}],
        },
        q.prompt,
        "Multiple Choice",
    )


def true_false(q: QuizQuestion) -> dict[str, Any]:
    return _sub(
        TRUE_FALSE,
        {
            "question": _p(q.prompt),
            "correct": q.answer,
            "behaviour": {
                **_behaviour(),
                "feedbackOnCorrect": q.explanation,
                "feedbackOnWrong": q.explanation,
            },
        },
        q.prompt,
        "True/False Question",
    )


def blanks(q: QuizQuestion) -> dict[str, Any]:
    answer = q.answer.replace("*", "")
    if _BLANK.search(q.prompt):
        text = _BLANK.sub(f"*{answer}*", q.prompt, count=1)
    else:
        text = f"{q.prompt.rstrip()} *{answer}*"
    return _sub(
        BLANKS,
        {
            "text": _p(q.explanation) if q.explanation else "",
            "questions": [f"<p>{html.escape(text)}</p>".replace("&#x27;", "'")],
            "behaviour": {
                **_behaviour(),
                "caseSensitive": False,
                "showSolutionsRequiresInput": True,
                "separateLines": False,
                "acceptSpellingErrors": True,
            },
            "overallFeedback": [{"from": 0, "to": 100}],
        },
        q.prompt,
        "Fill in the Blanks",
    )


def quiz_to_h5p(draft: QuizDraft) -> H5pPackage:
    questions = []
    for q in draft.questions:
        if q.type == "multiple_choice":
            questions.append(multi_choice(q))
        elif q.type == "true_false":
            questions.append(true_false(q))
        else:
            questions.append(blanks(q))
    params = {
        "introPage": {"showIntroPage": False},
        "progressType": "dots",
        "passPercentage": 50,
        "disableBackwardsNavigation": False,
        "randomQuestions": False,
        "questions": questions,
        "endGame": {
            "showResultPage": True,
            "showSolutionButton": True,
            "showRetryButton": True,
            "noResultMessage": "Finished",
            "message": "Your result:",
            "scoreBarLabel": "You got @finals out of @totals points",
            "overallFeedback": [{"from": 0, "to": 100}],
            "solutionButtonText": "Show solution",
            "retryButtonText": "Retry",
            "finishButtonText": "Finish",
            "submitButtonText": "Submit",
            "showAnimations": False,
            "skippable": False,
        },
        "override": {"checkButton": True},
        "texts": {
            "prevButton": "Previous question",
            "nextButton": "Next question",
            "finishButton": "Finish",
            "submitButton": "Submit",
            "textualProgress": "Question: @current of @total questions",
            "jumpToQuestion": "Question %d of %total",
            "questionLabel": "Question",
            "readSpeakerProgress": "Question @current of @total",
            "unansweredText": "Unanswered",
            "answeredText": "Answered",
            "currentQuestionText": "Current question",
            "navigationLabel": "Questions",
        },
    }
    return H5pPackage(library=QUESTION_SET, title=draft.title, params=params, maxScore=len(questions))


def flashcards_to_h5p(draft: FlashcardsDraft) -> H5pPackage:
    dialogs = [
        {
            "text": _p(c.front),
            "answer": _p(c.back),
            "tips": {"front": html.escape(c.hint or ""), "back": ""},
        }
        for c in draft.cards
    ]
    params = {
        "title": _p(draft.title),
        "mode": "normal",
        "description": "",
        "dialogs": dialogs,
        "behaviour": {
            "enableRetry": True,
            "disableBackwardsNavigation": False,
            "scaleTextNotCard": False,
            "randomCards": False,
            "maxProficiency": 5,
            "quickProgression": False,
        },
        "answer": "Turn",
        "next": "Next",
        "prev": "Previous",
        "retry": "Retry",
        "correctAnswer": "I got it right!",
        "incorrectAnswer": "I got it wrong",
        "round": "Round @round",
        "cardsLeft": "Cards left: @number",
        "nextRound": "Proceed to round @round",
        "startOver": "Start over",
        "showSummary": "Next",
        "summary": "Summary",
        "summaryCardsRight": "Cards you got right:",
        "summaryCardsWrong": "Cards you got wrong:",
        "summaryCardsCompleted": "Cards you have completed learning:",
        "summaryCompletedRounds": "Completed rounds:",
        "summaryAllDone": "Well done! You got all @cards cards correct @max times in a row!",
        "progressText": "Card @card of @total",
        "cardFrontLabel": "Card front",
        "cardBackLabel": "Card back",
        "tipButtonLabel": "Show tip",
        "audioNotSupported": "Your browser does not support this audio",
    }
    return H5pPackage(library=DIALOG_CARDS, title=draft.title, params=params, maxScore=len(dialogs))


# ---------------------------------------------------------------------------
# Validation: the `h5p.validate` tool. Structural checks the player would trip over.
# ---------------------------------------------------------------------------


def validate_h5p(library: str, params: dict[str, Any]) -> list[str]:
    name = library.split(" ")[0]
    errors: list[str] = []
    if name == "H5P.QuestionSet":
        questions = params.get("questions")
        if not isinstance(questions, list) or not questions:
            return ["questions must be a non-empty list"]
        for i, q in enumerate(questions, 1):
            if not isinstance(q, dict) or "library" not in q or not isinstance(q.get("params"), dict):
                errors.append(f"question {i}: needs library and params")
                continue
            errors.extend(f"question {i}: {e}" for e in validate_h5p(str(q["library"]), q["params"]))
    elif name == "H5P.MultiChoice":
        answers = params.get("answers")
        if not params.get("question"):
            errors.append("question text is required")
        if not isinstance(answers, list) or len(answers) < 2:
            errors.append("at least two answers are required")
        elif not any(a.get("correct") for a in answers if isinstance(a, dict)):
            errors.append("one answer must be marked correct")
    elif name == "H5P.TrueFalse":
        if not params.get("question"):
            errors.append("question text is required")
        if params.get("correct") not in ("true", "false"):
            errors.append("correct must be 'true' or 'false'")
    elif name == "H5P.Blanks":
        qs = params.get("questions")
        if not isinstance(qs, list) or not qs:
            errors.append("questions must be a non-empty list")
        elif not all(isinstance(t, str) and t.count("*") >= 2 for t in qs):
            errors.append("each blank must be marked with *answer*")
    elif name == "H5P.Dialogcards":
        dialogs = params.get("dialogs")
        if not isinstance(dialogs, list) or not dialogs:
            errors.append("dialogs must be a non-empty list")
        else:
            for i, d in enumerate(dialogs, 1):
                if not isinstance(d, dict) or not d.get("text") or not d.get("answer"):
                    errors.append(f"card {i}: text and answer are required")
    else:
        errors.append(f"unsupported library {library}")
    return errors
