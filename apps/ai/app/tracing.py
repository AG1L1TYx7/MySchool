"""Traces every run as a JSON line with pseudonymised identifiers (docs/10 sections 1 and 9)."""

from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any


class Tracer:
    def __init__(self, data_dir: Path, salt: str):
        self.path = data_dir / "traces.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.salt = salt
        self._lock = threading.Lock()

    def pseudonym(self, value: str | None) -> str | None:
        if value is None:
            return None
        return hashlib.sha256(f"{self.salt}:{value}".encode()).hexdigest()[:16]

    def record(self, event: dict[str, Any]) -> None:
        event = {"ts": time.time(), **event}
        line = json.dumps(event, ensure_ascii=False)
        with self._lock, self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
