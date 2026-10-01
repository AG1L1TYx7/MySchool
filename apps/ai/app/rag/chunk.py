"""Splits lesson text into overlapping chunks that fit comfortably in a context block."""

from __future__ import annotations

import re

_PARAGRAPH = re.compile(r"\n\s*\n")


def chunk_text(text: str, max_chars: int = 800, overlap: int = 120) -> list[str]:
    """Paragraph-aware chunking: joins paragraphs up to max_chars, splits long ones with overlap."""
    paragraphs = [p.strip() for p in _PARAGRAPH.split(text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for p in paragraphs:
        if len(p) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            start = 0
            while start < len(p):
                end = min(len(p), start + max_chars)
                chunks.append(p[start:end])
                if end == len(p):
                    break
                start = max(end - overlap, start + 1)
            continue
        candidate = f"{current}\n\n{p}" if current else p
        if len(candidate) <= max_chars:
            current = candidate
        else:
            chunks.append(current)
            current = p
    if current:
        chunks.append(current)
    return chunks
