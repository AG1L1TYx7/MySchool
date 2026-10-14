"""Settings. Secrets only from the environment; placeholders are refused in production (ADR-012)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Both names are accepted: compose files have used ENVIRONMENT, the service's own documentation AI_ENV.
    environment: str = Field(default="development", validation_alias=AliasChoices("AI_ENV", "ENVIRONMENT"))
    host: str = Field(default="127.0.0.1", alias="AI_HOST")
    port: int = Field(default=8000, alias="AI_PORT")

    # The LMS authenticates to this service with this bearer token (docs/04 section 1).
    service_token: str = Field(default="CHANGE_ME_service_token_0123456789", alias="AI_SERVICE_TOKEN")
    # This service reads context from the LMS tool API with this token (ADR-022).
    lms_url: str = Field(default="http://localhost:5000", alias="LMS_URL")
    lms_service_token: str = Field(default="CHANGE_ME_callback_token_0123456789", alias="LMS_SERVICE_TOKEN")

    model_provider: str = Field(default="ollama", alias="MODEL_PROVIDER")  # ollama | fake
    ollama_url: str = Field(default="http://localhost:11434", alias="OLLAMA_URL")
    chat_model: str = Field(default="llama3.1:8b", alias="CHAT_MODEL")
    vision_model: str = Field(default="llava", alias="VISION_MODEL")
    embedding_model: str = Field(default="all-minilm", alias="EMBEDDING_MODEL")
    tutor_timeout_seconds: float = Field(default=60.0, alias="TUTOR_TIMEOUT_SECONDS")
    tool_timeout_seconds: float = Field(default=5.0, alias="TOOL_TIMEOUT_SECONDS")
    generation_timeout_seconds: float = Field(default=120.0, alias="GENERATION_TIMEOUT_SECONDS")
    max_tool_calls: int = Field(default=4, alias="MAX_TOOL_CALLS")

    # Safety: the keyword classifier always runs; the model classifier adds a call per message.
    safety_model_check: bool = Field(default=False, alias="SAFETY_MODEL_CHECK")

    prompts_dir: Path = Field(default=Path(__file__).resolve().parent.parent / "prompts", alias="PROMPTS_DIR")
    data_dir: Path = Field(default=Path(__file__).resolve().parent.parent / "data", alias="AI_DATA_DIR")
    trace_salt: str = Field(default="dev-salt", alias="TRACE_SALT")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def production_problems(self) -> list[str]:
        """What stops this configuration from running in production (docs/21 F13): placeholder or short
        tokens, the fake model provider, and the development trace salt."""
        if not self.is_production:
            return []
        problems: list[str] = []
        for name, value in (("AI_SERVICE_TOKEN", self.service_token), ("LMS_SERVICE_TOKEN", self.lms_service_token)):
            if "CHANGE_ME" in value or len(value) < 24:
                problems.append(f"{name} must be set to a random value of at least 24 characters")
        if self.model_provider == "fake":
            problems.append("MODEL_PROVIDER=fake is only for tests")
        if self.trace_salt == "dev-salt" or len(self.trace_salt) < 16:
            problems.append("TRACE_SALT must be set to a random value of at least 16 characters")
        return problems

    def validate_for_environment(self) -> None:
        problems = self.production_problems()
        if problems:
            raise RuntimeError("; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_for_environment()
    return settings
