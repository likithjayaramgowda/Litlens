"""
Citation Assistant — service layer.

Public surface
--------------
suggest_citations(user_id, paragraph, project_id, citation_style)
    → list[SuggestionDict]

verify_draft(user_id, full_text, project_id)
    → list[AnnotationDict]

get_draft(user_id, project_id) → dict | None
save_draft(user_id, project_id, title, content, citation_style) → dict

format_bibliography(papers, citation_style) → str

LLM calls use the OpenRouter free-tier (quick model) via a single non-streaming
completion — citations are short, structured JSON responses.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache

from supabase import create_client, Client

from app.core.config import settings
from app.services.retrieval_service import retrieve_chunks

logger = logging.getLogger(__name__)

# ── Supabase service client ───────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _service_client() -> Client:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Supabase service-role credentials are not configured.")
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# ── LLM (non-streaming single completion) ─────────────────────────────────────

_OR_BASE_URL = "https://openrouter.ai/api/v1"
_OR_HEADERS = {"HTTP-Referer": "https://litlens.app", "X-Title": "LitLens"}
# Use the quick model — short JSON responses only
_CITATION_MODEL = "meta-llama/llama-3.3-70b-instruct:free"


async def _llm_json(prompt: str, max_tokens: int = 1_024) -> dict | list:
    """
    Single (non-streaming) LLM completion that returns parsed JSON.
    Falls back to an empty dict on failure so callers can degrade gracefully.
    """
    if not settings.OPENROUTER_API_KEY:
        logger.warning("OPENROUTER_API_KEY not set — citation LLM skipped.")
        return {}

    try:
        from openai import AsyncOpenAI  # lazy import

        client = AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url=_OR_BASE_URL,
            default_headers=_OR_HEADERS,
        )
        response = await client.chat.completions.create(
            model=_CITATION_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            stream=False,
        )
        raw = response.choices[0].message.content or "{}"
        # Strip markdown code fences if the model wraps in ```json ... ```
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw.strip())
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("LLM returned non-JSON for citation call: %s", exc)
        return {}
    except Exception as exc:
        logger.warning("Citation LLM call failed: %s", exc)
        return {}


# ── Citation suggestion ───────────────────────────────────────────────────────

async def suggest_citations(
    user_id: str,
    paragraph: str,
    project_id: str | None,
    citation_style: str = "APA",
    paper_ids: list[str] | None = None,
) -> list[dict]:
    """
    Given a paragraph, retrieve the most relevant paper chunks then ask the
    LLM whether the text needs citations and which papers best support it.

    Returns a list of suggestion dicts:
        paper_id, paper_title, page_number, confidence, reason, excerpt
    """
    if not paragraph.strip():
        return []

    logger.info("[CITATIONS] suggest paragraph=%r (len=%d)", paragraph[:120], len(paragraph))

    chunks = retrieve_chunks(
        user_id,
        paragraph,
        n_results=12,
        paper_ids=paper_ids or None,
    )

    if not chunks:
        logger.info("[CITATIONS] no chunks retrieved for user=%s project=%s", user_id, project_id)
        return []

    # Log retrieval results for debugging
    for c in chunks[:5]:
        logger.info(
            "[CITATIONS] chunk score=%.3f paper=%r page=%d text=%r",
            c["relevance_score"], c["paper_title"], c["page_number"], c["text"][:80],
        )

    # Fast-path: skip LLM entirely when any chunk is very highly similar.
    _FAST_PATH_SIM = 0.82
    fast_path_chunks = [c for c in chunks if c["relevance_score"] >= _FAST_PATH_SIM]
    if fast_path_chunks:
        logger.info(
            "[CITATIONS] fast-path triggered (%d chunks >= %.2f) — skipping LLM",
            len(fast_path_chunks), _FAST_PATH_SIM,
        )
        seen_fp: set[str] = set()
        fast_suggestions: list[dict] = []
        for c in fast_path_chunks:
            if c["paper_id"] in seen_fp or len(fast_suggestions) >= 3:
                break
            seen_fp.add(c["paper_id"])
            fast_suggestions.append({
                "paper_id": c["paper_id"],
                "paper_title": c["paper_title"],
                "page_number": c["page_number"],
                "confidence": "strong",
                "reason": "This text closely matches content from this paper.",
                "excerpt": c["text"][:300],
                "needs_citation": True,
            })
        return fast_suggestions

    # Chunks above this threshold are considered highly relevant — we will
    # always suggest them regardless of the LLM's needs_citation decision.
    _HIGH_SIM = 0.65
    _MOD_SIM  = 0.45
    high_sim_chunks = [c for c in chunks if c["relevance_score"] >= _HIGH_SIM]
    mod_sim_chunks  = [c for c in chunks if _MOD_SIM <= c["relevance_score"] < _HIGH_SIM]

    # Build a compact context block (paper title, page, excerpt)
    context_lines: list[str] = []
    seen_keys: set[tuple[str, int]] = set()
    for c in chunks:
        key = (c["paper_id"], c["page_number"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        excerpt = c["text"][:250].replace("\n", " ")
        context_lines.append(
            f'- paper_id="{c["paper_id"]}" | title="{c["paper_title"]}" '
            f'| page={c["page_number"]} | score={c["relevance_score"]:.2f} | excerpt: "{excerpt}"'
        )

    context_block = "\n".join(context_lines)

    prompt = f"""You are a citation assistant for academic writing. Your job is to identify which papers support the given text.

TASK: Determine which papers from the library best support or relate to the text below.

TEXT TO ANALYSE:
{paragraph}

AVAILABLE PAPER EXCERPTS (from the user's library, with similarity scores):
{context_block}

IMPORTANT RULES:
- "needs_citation" is true for ANY text containing factual claims, data, results, system names, or content that appears sourced. When in doubt return true. Never return empty suggestions if any excerpt shows textual overlap.
- If ANY paper excerpt overlaps with, paraphrases, or is the original source for the text, it MUST be suggested.
- "confidence" must be exactly one of: "strong" (score>0.70), "moderate" (score 0.45-0.70), "weak" (score<0.45).
- Return at most 4 suggestions, best first by score.

Respond with ONLY valid JSON — no explanations, no markdown fences:
{{
  "needs_citation": true,
  "reason": "one sentence explaining why a citation is needed",
  "suggestions": [
    {{
      "paper_id": "exact paper_id from above",
      "paper_title": "exact title from above",
      "page_number": 1,
      "confidence": "strong",
      "reason": "one sentence why this paper supports the text"
    }}
  ]
}}"""

    result = await _llm_json(prompt, max_tokens=800)
    logger.info("[CITATIONS] LLM result: needs_citation=%s suggestions=%d",
                result.get("needs_citation") if isinstance(result, dict) else "?",
                len(result.get("suggestions", [])) if isinstance(result, dict) else 0)

    # Validate and normalise LLM suggestions
    suggestions: list[dict] = []
    seen_paper_ids: set[str] = set()

    if isinstance(result, dict):
        raw_suggestions = result.get("suggestions", [])
        if isinstance(raw_suggestions, list):
            for s in raw_suggestions:
                if not isinstance(s, dict):
                    continue
                matched_chunk = next(
                    (c for c in chunks if c["paper_id"] == s.get("paper_id")), None
                )
                pid = s.get("paper_id", "")
                if pid:
                    seen_paper_ids.add(pid)
                suggestions.append({
                    "paper_id": pid,
                    "paper_title": s.get("paper_title", "Unknown"),
                    "page_number": int(s.get("page_number") or 1),
                    "confidence": s.get("confidence", "moderate")
                        if s.get("confidence") in ("strong", "moderate", "weak")
                        else "moderate",
                    "reason": s.get("reason", ""),
                    "excerpt": matched_chunk["text"][:300] if matched_chunk else "",
                    "needs_citation": True,
                })

    # --- Similarity-threshold override ---
    # If the LLM returned no suggestions but we have high-similarity chunks,
    # build suggestions directly from them. This handles the case where the LLM
    # incorrectly decides "no citation needed" for text pasted directly from a paper.
    fallback_chunks = high_sim_chunks or (mod_sim_chunks if not suggestions else [])
    for c in fallback_chunks:
        if c["paper_id"] in seen_paper_ids:
            continue  # already covered by LLM
        if len(suggestions) >= 4:
            break
        score = c["relevance_score"]
        confidence = "strong" if score >= 0.80 else ("moderate" if score >= 0.65 else "weak")
        suggestions.append({
            "paper_id": c["paper_id"],
            "paper_title": c["paper_title"],
            "page_number": c["page_number"],
            "confidence": confidence,
            "reason": f"This text closely matches content from this paper (similarity {score:.0%}).",
            "excerpt": c["text"][:300],
            "needs_citation": True,
        })
        seen_paper_ids.add(c["paper_id"])

    logger.info(
        "[CITATIONS] suggest user=%s project=%s → %d suggestions (high_sim=%d, llm=%d)",
        user_id, project_id, len(suggestions), len(high_sim_chunks),
        len(result.get("suggestions", [])) if isinstance(result, dict) else 0,
    )
    return suggestions


# ── Draft verification ────────────────────────────────────────────────────────

def _split_paragraphs(text: str) -> list[str]:
    """Split plain text or stripped HTML into non-empty paragraph strings."""
    # Remove simple HTML tags for analysis
    stripped = re.sub(r"<[^>]+>", " ", text)
    parts = [p.strip() for p in re.split(r"\n{2,}|<\/p>", stripped)]
    return [p for p in parts if len(p) > 30]


async def verify_draft(
    user_id: str,
    full_text: str,
    project_id: str | None,
    paper_ids: list[str] | None = None,
) -> list[dict]:
    """
    Scan the full draft text and return paragraph-level annotation dicts:
        paragraph, status, message, suggestion

    Status values:
        "correct"  — citation present and well-supported
        "weak"     — citation present but a better paper is available
        "wrong"    — citation present but not supported
        "missing"  — no citation but one is needed
        "ok"       — no claim requiring citation
    """
    paragraphs = _split_paragraphs(full_text)
    if not paragraphs:
        return []

    # Retrieve a broad set of chunks once (up to 20) to cover the whole draft
    combined_query = " ".join(p[:200] for p in paragraphs[:5])
    chunks = retrieve_chunks(user_id, combined_query, n_results=20, paper_ids=paper_ids or None)

    if not chunks:
        # No papers — every claim is "missing"
        return [
            {
                "paragraph": p[:120] + ("…" if len(p) > 120 else ""),
                "status": "missing",
                "message": "No papers uploaded to verify against.",
                "suggestion": "Upload relevant papers to this project first.",
            }
            for p in paragraphs
        ]

    context_lines: list[str] = []
    seen: set[tuple[str, int]] = set()
    for c in chunks[:15]:
        key = (c["paper_id"], c["page_number"])
        if key in seen:
            continue
        seen.add(key)
        excerpt = c["text"][:200].replace("\n", " ")
        context_lines.append(
            f'- "{c["paper_title"]}" p.{c["page_number"]}: "{excerpt}"'
        )

    context_block = "\n".join(context_lines)
    draft_excerpt = "\n\n".join(f"[Para {i+1}] {p}" for i, p in enumerate(paragraphs[:12]))

    prompt = f"""You are a citation verification assistant for academic writing.

TASK: For each numbered paragraph below, determine whether its citations are correct,
weak, wrong, or missing — based on the available paper excerpts.

DRAFT PARAGRAPHS:
{draft_excerpt}

AVAILABLE PAPER EXCERPTS:
{context_block}

Respond with ONLY valid JSON — no markdown fences:
{{
  "paragraphs": [
    {{
      "paragraph": "first 80 chars of the paragraph text",
      "status": "correct",
      "message": "one sentence assessment",
      "suggestion": "one sentence fix or confirmation"
    }}
  ]
}}

Status must be exactly one of: "correct", "weak", "wrong", "missing", "ok".
- "correct"  : a citation exists and the excerpts clearly support the claim.
- "weak"     : a citation exists but a stronger paper excerpt is available.
- "wrong"    : a citation exists but the excerpts do NOT support the claim.
- "missing"  : a factual claim is made with no citation and the excerpts could support it.
- "ok"       : no factual claim requiring a citation.

Return one entry per paragraph in order."""

    result = await _llm_json(prompt, max_tokens=1_200)

    annotations: list[dict] = []
    if isinstance(result, dict):
        raw = result.get("paragraphs", [])
        if isinstance(raw, list):
            for item in raw:
                if not isinstance(item, dict):
                    continue
                status = item.get("status", "ok")
                if status not in ("correct", "weak", "wrong", "missing", "ok"):
                    status = "ok"
                annotations.append({
                    "paragraph": item.get("paragraph", "")[:120],
                    "status": status,
                    "message": item.get("message", ""),
                    "suggestion": item.get("suggestion", ""),
                })

    # Fallback: if LLM returned fewer annotations than paragraphs, pad with "ok"
    while len(annotations) < len(paragraphs):
        annotations.append({
            "paragraph": paragraphs[len(annotations)][:120],
            "status": "ok",
            "message": "",
            "suggestion": "",
        })

    return annotations


# ── Bibliography formatter ────────────────────────────────────────────────────

def _extract_last_name(authors_str: str) -> str:
    """Extract the first author's last name from a comma-separated string."""
    if not authors_str:
        return "Unknown"
    first_author = authors_str.split(",")[0].strip()
    # "First Last" → "Last"
    parts = first_author.split()
    return parts[-1] if parts else first_author


def _format_author_apa(authors_str: str) -> str:
    """Format authors for APA: Last, F., & Last2, F."""
    if not authors_str:
        return "Unknown Author"
    names = [n.strip() for n in authors_str.split(",") if n.strip()]
    formatted: list[str] = []
    for name in names:
        parts = name.split()
        if len(parts) >= 2:
            last = parts[-1]
            initials = ". ".join(p[0] for p in parts[:-1]) + "."
            formatted.append(f"{last}, {initials}")
        else:
            formatted.append(name)
    if len(formatted) > 1:
        return ", ".join(formatted[:-1]) + ", & " + formatted[-1]
    return formatted[0] if formatted else "Unknown Author"


def _format_author_ieee(authors_str: str) -> str:
    """Format authors for IEEE: F. Last and F. Last2"""
    if not authors_str:
        return "Unknown"
    names = [n.strip() for n in authors_str.split(",") if n.strip()]
    formatted: list[str] = []
    for name in names:
        parts = name.split()
        if len(parts) >= 2:
            last = parts[-1]
            initials = ". ".join(p[0] for p in parts[:-1]) + "."
            formatted.append(f"{initials} {last}")
        else:
            formatted.append(name)
    return " and ".join(formatted) if formatted else "Unknown"


def format_bibliography(papers: list[dict], citation_style: str) -> str:
    """
    Format a list of paper metadata dicts into a bibliography string.

    Each paper dict must have at minimum: title, authors, year.
    Optional: page_count.

    Supported styles: APA, MLA, IEEE, Harvard, Chicago.
    """
    if not papers:
        return "No papers cited."

    style = citation_style.upper()
    lines: list[str] = []

    for i, p in enumerate(papers, start=1):
        title = p.get("title") or "Untitled"
        authors_raw = p.get("authors") or ""
        year = p.get("year") or "n.d."
        last_name = _extract_last_name(authors_raw)

        if style == "APA":
            authors = _format_author_apa(authors_raw)
            lines.append(f"{authors} ({year}). *{title}*. [PDF document].")

        elif style == "MLA":
            # Last, First. "Title." Year.
            first_author = authors_raw.split(",")[0].strip() if authors_raw else "Unknown"
            name_parts = first_author.split()
            if len(name_parts) >= 2:
                mla_name = f"{name_parts[-1]}, {' '.join(name_parts[:-1])}"
            else:
                mla_name = first_author
            lines.append(f'{mla_name}. "{title}." {year}.')

        elif style == "IEEE":
            authors = _format_author_ieee(authors_raw)
            lines.append(f"[{i}] {authors}, \"{title},\" {year}.")

        elif style == "Harvard":
            authors = _format_author_apa(authors_raw)
            lines.append(f"{authors} {year}, *{title}*, [PDF document].")

        elif style == "Chicago":
            first_author = authors_raw.split(",")[0].strip() if authors_raw else "Unknown"
            name_parts = first_author.split()
            if len(name_parts) >= 2:
                chi_name = f"{name_parts[-1]}, {' '.join(name_parts[:-1])}"
            else:
                chi_name = first_author
            lines.append(f"{chi_name}. *{title}*. {year}.")

        else:
            # Fallback to APA
            authors = _format_author_apa(authors_raw)
            lines.append(f"{authors} ({year}). *{title}*.")

    return "\n\n".join(lines)


# ── Draft CRUD ────────────────────────────────────────────────────────────────

def get_draft(user_id: str, project_id: str) -> dict | None:
    """
    Return the user's draft for a project, or None if it doesn't exist.
    """
    try:
        sb = _service_client()
        result = (
            sb.table("drafts")
            .select("id, title, content, citation_style, updated_at")
            .eq("user_id", user_id)
            .eq("project_id", project_id)
            .maybe_single()
            .execute()
        )
        return result.data
    except Exception as exc:
        logger.warning("Could not load draft for project %s: %s", project_id, exc)
        return None


def save_draft(
    user_id: str,
    project_id: str,
    title: str,
    content: str,
    citation_style: str = "APA",
) -> dict:
    """
    Upsert (insert or update) a draft for the given project.
    Returns the saved row.
    """
    sb = _service_client()
    style = citation_style if citation_style in ("APA", "MLA", "IEEE", "Harvard", "Chicago") else "APA"
    payload = {
        "user_id": user_id,
        "project_id": project_id,
        "title": title[:200].strip() or "Untitled Draft",
        "content": content,
        "citation_style": style,
    }
    result = sb.table("drafts").upsert(
        payload,
        on_conflict="user_id,project_id",
    ).execute()
    return result.data[0]
