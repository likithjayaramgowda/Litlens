"""PDF parsing utilities using PyMuPDF (imported as fitz)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import fitz  # PyMuPDF


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class PageText:
    page: int
    text: str


@dataclass
class PaperMetadata:
    title: str
    authors: str
    year: int | None
    page_count: int


# ── Helpers ───────────────────────────────────────────────────────────────────

_YEAR_RE = re.compile(r"\b(19\d{2}|20[012]\d)\b")


def _first_year(text: str) -> int | None:
    """Return the first plausible publication year found in *text*."""
    m = _YEAR_RE.search(text)
    return int(m.group()) if m else None


def _clean(s: str) -> str:
    """Strip and collapse whitespace."""
    return " ".join(s.split())


# ── Public API ────────────────────────────────────────────────────────────────

def extract_metadata(doc: fitz.Document, filename: str) -> PaperMetadata:
    """
    Extract title, authors, and year from *doc*.

    Strategy (in order of preference):
    1. Use embedded PDF metadata (``doc.metadata``).
    2. Fall back to first-page text heuristics when metadata is absent.
    3. Derive title from filename as a last resort.
    """
    meta = doc.metadata or {}

    title   = _clean(meta.get("title",  "") or "")
    authors = _clean(meta.get("author", "") or "")
    year    = _first_year((meta.get("creationDate", "") or "") + " " + (meta.get("modDate", "") or ""))

    # ── First-page heuristics ─────────────────────────────────────────────────
    if doc.page_count > 0:
        page = doc[0]

        # get_text("blocks") → [(x0,y0,x1,y1, text, block_no, block_type), ...]
        # block_type == 0 means text block (not image)
        raw_blocks = [
            _clean(b[4])
            for b in page.get_text("blocks")
            if b[6] == 0 and _clean(b[4])
        ]
        lines = [l for block in raw_blocks for l in block.splitlines() if l.strip()]

        if not title and lines:
            # The first sufficiently long line is almost always the title.
            title = next((l for l in lines if len(l) > 10), lines[0])[:300]

        if not authors and len(lines) > 1:
            # Author lines typically follow the title and contain commas, "and",
            # superscript affiliations, or e-mail patterns.
            for line in lines[1:8]:
                if re.search(r"\band\b|,\s*[A-Z]|@|\bUniversity\b", line, re.IGNORECASE):
                    if not re.search(r"\bAbstract\b|\bKeywords\b", line, re.IGNORECASE):
                        authors = line[:300]
                        break

        if not year:
            year = _first_year(page.get_text())

    # ── Filename fallback for title ───────────────────────────────────────────
    if not title:
        stem = filename.removesuffix(".pdf").replace("_", " ").replace("-", " ")
        title = stem[:300]

    return PaperMetadata(
        title=title,
        authors=authors,
        year=year,
        page_count=doc.page_count,
    )


def extract_pages(doc: fitz.Document) -> list[PageText]:
    """
    Return per-page plain text.

    Used by the Phase 2.2 chunking pipeline. Preserves page numbers so that
    citations can reference the exact source page.
    """
    return [
        PageText(page=i + 1, text=page.get_text())
        for i, page in enumerate(doc)
    ]
