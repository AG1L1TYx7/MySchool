"""Production refuses placeholder settings; development keeps its defaults (docs/21 F13)."""

import pytest

from app.config import Settings


def test_development_accepts_defaults() -> None:
    assert Settings(AI_ENV="development", _env_file=None).production_problems() == []


def test_production_names_every_problem() -> None:
    settings = Settings(
        ENVIRONMENT="production",
        AI_SERVICE_TOKEN="CHANGE_ME_service_token",
        LMS_SERVICE_TOKEN="short",
        MODEL_PROVIDER="fake",
        TRACE_SALT="dev-salt",
        _env_file=None,
    )
    assert settings.is_production
    problems = settings.production_problems()
    assert any("AI_SERVICE_TOKEN" in p for p in problems)
    assert any("LMS_SERVICE_TOKEN" in p for p in problems)
    assert any("MODEL_PROVIDER" in p for p in problems)
    assert any("TRACE_SALT" in p for p in problems)
    with pytest.raises(RuntimeError):
        settings.validate_for_environment()


def test_production_with_real_values_passes() -> None:
    settings = Settings(
        AI_ENV="production",
        AI_SERVICE_TOKEN="x" * 32,
        LMS_SERVICE_TOKEN="y" * 32,
        MODEL_PROVIDER="ollama",
        TRACE_SALT="z" * 24,
        _env_file=None,
    )
    assert settings.is_production
    settings.validate_for_environment()
