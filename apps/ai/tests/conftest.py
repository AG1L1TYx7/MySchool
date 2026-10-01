from __future__ import annotations

import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings  # noqa: E402
from app.main import Runtime, app, set_runtime  # noqa: E402
from app.models import FakeProvider  # noqa: E402

TOKEN = "test-service-token-0123456789"


@pytest.fixture
def runtime(tmp_path: Path) -> Runtime:
    settings = Settings(
        AI_SERVICE_TOKEN=TOKEN,
        MODEL_PROVIDER="fake",
        AI_DATA_DIR=tmp_path,
        PROMPTS_DIR=ROOT / "prompts",
        TRACE_SALT="t",
    )
    rt = Runtime(settings, provider=FakeProvider())
    set_runtime(rt)
    return rt


@pytest.fixture
async def client(runtime: Runtime) -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://ai", headers={"Authorization": f"Bearer {TOKEN}"}
    ) as c:
        yield c
