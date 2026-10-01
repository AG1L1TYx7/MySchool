"""Versioned prompt files: front matter + body with {{placeholders}} (docs/10 section 6)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

_FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


@dataclass(frozen=True)
class Prompt:
    capability: str
    version: int
    model: str
    temperature: float
    max_output_tokens: int
    schema: str | None
    body: str
    path: Path
    placeholders: tuple[str, ...] = field(default=())

    @property
    def version_tag(self) -> str:
        """What the LMS stores with every result, e.g. 'tutor.chat@1'."""
        return f"{self.capability}@{self.version}"

    def render(self, values: dict[str, str]) -> str:
        """Fills placeholders; a missing value becomes an empty string so a prompt never leaks '{{x}}'."""
        return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), ""), self.body)


class PromptError(ValueError):
    pass


def parse_prompt(text: str, path: Path) -> Prompt:
    m = _FRONT.match(text)
    if not m:
        raise PromptError(f"{path}: missing front matter")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    body = text[m.end() :]
    try:
        return Prompt(
            capability=meta["capability"],
            version=int(meta["version"]),
            model=meta.get("model", "llama3.1:8b"),
            temperature=float(meta.get("temperature", "0.4")),
            max_output_tokens=int(meta.get("maxOutputTokens", "700")),
            schema=meta.get("schema"),
            body=body,
            path=path,
            placeholders=tuple(sorted(set(_PLACEHOLDER.findall(body)))),
        )
    except KeyError as e:
        raise PromptError(f"{path}: missing front matter key {e}") from e


class PromptLibrary:
    """Loads every <agent>/<profile>@<version>.md under the prompts directory."""

    def __init__(self, root: Path):
        self.root = root
        self._by_key: dict[tuple[str, str], list[Prompt]] = {}
        for path in sorted(root.glob("*/*@*.md")):
            prompt = parse_prompt(path.read_text(encoding="utf-8"), path)
            profile = path.stem.split("@", 1)[0]
            self._by_key.setdefault((prompt.capability, profile), []).append(prompt)
        for prompts in self._by_key.values():
            prompts.sort(key=lambda p: p.version)

    def get(self, capability: str, profile: str = "default", version: int | None = None) -> Prompt:
        candidates = self._by_key.get((capability, profile))
        if not candidates:
            # profile fallback: the file name of the only profile for that capability
            matches = [p for (cap, _), ps in self._by_key.items() if cap == capability for p in ps]
            if not matches:
                raise PromptError(f"no prompt for capability '{capability}'")
            candidates = sorted(matches, key=lambda p: p.version)
        if version is None:
            return candidates[-1]
        for p in candidates:
            if p.version == version:
                return p
        raise PromptError(f"no version {version} for '{capability}' profile '{profile}'")

    def all(self) -> list[Prompt]:
        return [p for ps in self._by_key.values() for p in ps]


@lru_cache
def get_library(root: str) -> PromptLibrary:
    return PromptLibrary(Path(root))
