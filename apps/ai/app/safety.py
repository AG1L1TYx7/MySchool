"""Safety for minors (docs/10 section 7): a fast rule layer that always runs, plus an optional model layer."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

Decision = Literal["allow", "block", "escalate"]


@dataclass
class SafetyResult:
    decision: Decision
    categories: list[str] = field(default_factory=list)
    reason: str = ""


# Patterns are deliberately conservative: false positives hand the student to a caring adult,
# which is the right failure mode for a school tool.
_ESCALATE = {
    "self_harm": re.compile(
        r"\b(kill myself|end my life|want to die|hurt myself|cut myself|suicide|suicidal|no reason to live|better off dead)\b",
        re.I,
    ),
    "abuse_or_danger": re.compile(
        r"\b(hits? me|beats? me|hurts? me|touche[sd] me|i am scared of (him|her|them|home)|i'm scared of (him|her|them|home)|someone is hurting me|threatened to hurt me|locked me in)\b",
        re.I,
    ),
}

_BLOCK = {
    "sexual": re.compile(r"\b(sex|porn|nude|naked|sexy)\b", re.I),
    "violence": re.compile(
        r"\b(how to (make|build) a (bomb|gun|weapon)|kill (him|her|them|everyone)|shoot up)\b", re.I
    ),
    "substances": re.compile(r"\b(how to (buy|get|make) (drugs|weed|meth|cocaine)|get drunk|vape)\b", re.I),
    "personal_data": re.compile(
        r"(\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\bmy (home )?address is\b|\bmy password is\b)",
        re.I,
    ),
    "prompt_injection": re.compile(
        r"(ignore (all|the|your) (previous|above|prior) instructions|you are now|pretend (you are|to be)|system prompt|developer mode|jailbreak)",
        re.I,
    ),
}

_REPORT = {
    "academic_dishonesty": re.compile(
        r"\b(answer key|write (my|the) (essay|paper|homework) for me|do my homework|give me the answers)\b", re.I
    ),
}


def classify_rules(text: str, age_band: str) -> SafetyResult:
    categories: list[str] = []
    for name, pattern in _ESCALATE.items():
        if pattern.search(text):
            categories.append(name)
    if categories:
        return SafetyResult("escalate", categories, "possible harm to the student")
    for name, pattern in _BLOCK.items():
        if name == "personal_data" and age_band == "adult":
            continue
        if pattern.search(text):
            categories.append(name)
    if categories:
        return SafetyResult("block", categories, "unsafe or inappropriate content")
    for name, pattern in _REPORT.items():
        if pattern.search(text):
            categories.append(name)
    return SafetyResult("allow", categories, "")


REFUSAL_ESCALATE = (
    "I'm really glad you told me. You deserve support from someone who can help right now. "
    "Please talk to a trusted adult such as your teacher, your school counsellor, or a parent. "
    "If you are in danger, contact your local emergency number. I'm here to help with schoolwork whenever you're ready."
)

REFUSAL_BLOCK = (
    "I can't help with that one, but I'm happy to keep going with your schoolwork. What would you like to work on?"
)

REFUSAL_OUTPUT = "Sorry, I couldn't produce a safe answer for that. Let's try the question a different way."


def refusal_for(result: SafetyResult) -> str:
    return REFUSAL_ESCALATE if result.decision == "escalate" else REFUSAL_BLOCK


def strip_personal_data(text: str) -> str:
    """Removes emails and phone numbers from model output before it reaches a student."""
    text = re.sub(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b", "[email removed]", text)
    return re.sub(r"\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b", "[number removed]", text)
