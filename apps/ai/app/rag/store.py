"""SQLite + numpy vector store. School-scale (tens of thousands of chunks) without native dependencies."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Chunk:
    id: str
    doc_id: str
    organization_id: str
    course_id: str | None
    lesson_id: str | None
    title: str
    text: str


@dataclass
class Hit:
    chunk: Chunk
    score: float


class VectorStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.execute(
            """CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, organization_id TEXT NOT NULL,
                course_id TEXT, lesson_id TEXT, title TEXT NOT NULL, text TEXT NOT NULL,
                dim INTEGER NOT NULL, embedding BLOB NOT NULL)"""
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS chunks_org ON chunks(organization_id, course_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id)")
        self.conn.commit()

    def replace_document(self, doc_id: str, chunks: list[Chunk], embeddings: list[list[float]]) -> int:
        if len(chunks) != len(embeddings):
            raise ValueError("chunks and embeddings differ in length")
        with self.conn:
            self.conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
            for c, e in zip(chunks, embeddings, strict=True):
                vec = np.asarray(e, dtype=np.float32)
                norm = float(np.linalg.norm(vec)) or 1.0
                self.conn.execute(
                    "INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        c.id,
                        c.doc_id,
                        c.organization_id,
                        c.course_id,
                        c.lesson_id,
                        c.title,
                        c.text,
                        vec.size,
                        (vec / norm).tobytes(),
                    ),
                )
        return len(chunks)

    def delete_document(self, doc_id: str) -> int:
        with self.conn:
            cur = self.conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        return int(cur.rowcount)

    def search(
        self, query_embedding: list[float], organization_id: str, *, course_id: str | None = None, k: int = 5
    ) -> list[Hit]:
        sql = "SELECT id, doc_id, organization_id, course_id, lesson_id, title, text, dim, embedding FROM chunks WHERE organization_id = ?"
        params: list[object] = [organization_id]
        if course_id:
            sql += " AND course_id = ?"
            params.append(course_id)
        rows = self.conn.execute(sql, params).fetchall()
        if not rows:
            return []
        q = np.asarray(query_embedding, dtype=np.float32)
        q = q / (float(np.linalg.norm(q)) or 1.0)
        matrix = np.vstack([np.frombuffer(r[8], dtype=np.float32) for r in rows if r[7] == q.size])
        kept = [r for r in rows if r[7] == q.size]
        if not kept:
            return []
        scores = matrix @ q
        order = np.argsort(-scores)[:k]
        return [
            Hit(
                Chunk(
                    id=r[0], doc_id=r[1], organization_id=r[2], course_id=r[3], lesson_id=r[4], title=r[5], text=r[6]
                ),
                float(scores[i]),
            )
            for i, r in ((int(i), kept[int(i)]) for i in order)
        ]

    def count(self, organization_id: str | None = None) -> int:
        if organization_id:
            return int(
                self.conn.execute(
                    "SELECT COUNT(*) FROM chunks WHERE organization_id = ?", (organization_id,)
                ).fetchone()[0]
            )
        return int(self.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
