from pathlib import Path

from app.rag.chunk import chunk_text
from app.rag.store import Chunk, VectorStore


def test_chunking_respects_paragraphs_and_size() -> None:
    text = "\n\n".join(["Para one. " * 20, "Para two. " * 20, "x" * 2000])
    chunks = chunk_text(text, max_chars=500, overlap=50)
    assert all(len(c) <= 500 for c in chunks)
    assert any(c.startswith("Para one") for c in chunks)
    assert chunk_text("") == []


def test_store_ranks_similar_vectors_and_scopes_by_organisation(tmp_path: Path) -> None:
    store = VectorStore(tmp_path / "rag.sqlite")
    chunks = [
        Chunk("d1:0", "d1", "org1", "c1", "l1", "Fractions", "adding fractions"),
        Chunk("d1:1", "d1", "org1", "c1", "l1", "Fractions", "photosynthesis"),
        Chunk("d2:0", "d2", "org2", "c9", "l9", "Other", "adding fractions"),
    ]
    store.replace_document("d1", chunks[:2], [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
    store.replace_document("d2", chunks[2:], [[1.0, 0.0, 0.0]])
    hits = store.search([0.9, 0.1, 0.0], "org1", k=2)
    assert [h.chunk.id for h in hits] == ["d1:0", "d1:1"]
    assert hits[0].score > hits[1].score
    assert store.search([1.0, 0.0, 0.0], "org2")[0].chunk.id == "d2:0"
    assert store.search([1.0, 0.0, 0.0], "org1", course_id="nope") == []
    assert store.count("org1") == 2
    store.replace_document("d1", chunks[:1], [[0.0, 0.0, 1.0]])
    assert store.count("org1") == 1
    assert store.delete_document("d2") == 1
