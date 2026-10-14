"""Contract check (docs/04, docs/07 section 7): every route the LMS's AI client calls exists in this service.

The API side is the source of truth for what gets called; this test reads its client and compares the paths
with the FastAPI application's OpenAPI document, so a renamed or removed route fails here before it fails in
a school.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.main import app

CLIENT = Path(__file__).resolve().parents[2] / "api" / "src" / "modules" / "ai" / "ai.client.ts"


def _called_paths() -> set[str]:
    source = CLIENT.read_text(encoding="utf-8")
    paths = set()
    for match in re.finditer(r"\$\{this\.baseUrl\}([^`\s?]*)", source):
        path = re.sub(r"\$\{[^}]*\}", "{param}", match.group(1))
        paths.add(path)
    return paths


def _served_patterns() -> list[re.Pattern[str]]:
    patterns = []
    for route in app.openapi()["paths"]:
        pattern = "^" + re.sub(r"\{[^}]+\}", r"[^/]+", route) + "$"
        patterns.append(re.compile(pattern))
    return patterns


def test_every_client_path_is_served() -> None:
    called = _called_paths()
    assert called, "no paths found in the API's AI client; the regex or the file moved"
    served = _served_patterns()
    missing = sorted(path for path in called if not any(p.match(path.replace("{param}", "x")) for p in served))
    assert missing == [], f"the LMS calls routes this service does not serve: {missing}"
