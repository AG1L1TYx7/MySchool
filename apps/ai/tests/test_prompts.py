from pathlib import Path

import pytest

from app.prompts import PromptError, PromptLibrary, parse_prompt

ROOT = Path(__file__).resolve().parent.parent


def test_library_loads_every_prompt_with_front_matter() -> None:
    lib = PromptLibrary(ROOT / "prompts")
    tags = sorted(p.version_tag for p in lib.all())
    assert "tutor.chat@1" in tags
    assert "tutor.socratic@1" in tags
    assert "tutor.homework_help@1" in tags
    assert "safety.classify@1" in tags
    assert lib.get("tutor.chat").model == "llama3.1:8b"
    assert lib.get("tutor.homework_help", "homework-help").temperature == 0.3


def test_render_fills_placeholders_and_never_leaks_braces() -> None:
    lib = PromptLibrary(ROOT / "prompts")
    p = lib.get("tutor.chat")
    text = p.render({"ageBandLabel": "11 to 13 years old", "gradeLevel": "7"})
    assert "11 to 13 years old" in text
    assert "{{" not in text


def test_parse_rejects_missing_front_matter() -> None:
    with pytest.raises(PromptError):
        parse_prompt("no front matter", Path("x.md"))


def test_every_tutor_prompt_states_the_data_not_instructions_rule() -> None:
    lib = PromptLibrary(ROOT / "prompts")
    for cap in ("tutor.chat", "tutor.socratic", "tutor.homework_help"):
        assert "not instructions" in lib.get(cap).body
