"""
LLM router — OpenRouter free-tier + optional DeepSeek BYOK.

Free-tier (server-side, one key):
  Uses the OpenRouter API (OpenAI-compatible) with OPENROUTER_API_KEY from .env.
  Three model tiers the user can toggle:

    quick        — zhipu/glm-4.5-air:free          Fast, good for simple Q&A
    deep         — deepseek/deepseek-r1:free        671B reasoning model with <think> traces
    long-context — nvidia/nemotron-3-super-120b-a12b:free  ~1M context for many papers

  On any 429 response, automatically retries with "openrouter/auto" (OpenRouter
  picks whichever free model is available at that moment).

BYOK (optional, DeepSeek direct):
  If the caller passes X-LLM-API-Key, queries go to api.deepseek.com directly
  instead of OpenRouter. Key lives only in the request header / sessionStorage.

Public surface
--------------
TIERS               — ordered list of tier metadata dicts (for the frontend toggle)
BYOK_PROVIDERS      — DeepSeek entry (for settings modal / test-connection)
stream_free_tier(messages, max_tokens, tier)   — async generator, server keys
stream_byok(provider, model, api_key, messages, max_tokens) — user BYOK
test_connection(provider, model, api_key)       — BYOK probe
"""
from __future__ import annotations

from typing import AsyncIterator

from app.core.config import settings

# ── OpenRouter constants ──────────────────────────────────────────────────────

_OR_BASE_URL = "https://openrouter.ai/api/v1"
_OR_HEADERS = {
    "HTTP-Referer": "https://litlens.app",
    "X-Title": "LitLens",
}
_OR_FALLBACK_MODEL = "openrouter/auto"

# ── Model tier catalogue ──────────────────────────────────────────────────────

TIERS: list[dict] = [
    {
        "id": "quick",
        "label": "Quick",
        "model": "zhipu/glm-4.5-air:free",
        "description": "Fast responses for simple questions and quick lookups.",
        "icon": "⚡",
    },
    {
        "id": "deep",
        "label": "Deep Thinking",
        "model": "deepseek/deepseek-r1:free",
        "description": "671B reasoning model. Shows thinking process. Best for complex cross-paper analysis.",
        "icon": "🧠",
    },
    {
        "id": "long-context",
        "label": "Long Context",
        "model": "nvidia/nemotron-3-super-120b-a12b:free",
        "description": "Up to 1M token context. Best when you have many papers loaded.",
        "icon": "📚",
    },
]

_TIER_MODEL: dict[str, str] = {t["id"]: t["model"] for t in TIERS}

# ── BYOK provider catalogue ───────────────────────────────────────────────────

BYOK_PROVIDERS: dict[str, dict] = {
    "deepseek": {
        "name": "DeepSeek",
        "needs_key": True,
        "key_label": "API Key",
        "key_placeholder": "sk-...",
        "models": [
            {"id": "deepseek-chat",     "name": "DeepSeek V3 (Chat)"},
            {"id": "deepseek-reasoner", "name": "DeepSeek R1 (Reasoner)"},
        ],
    },
}

# ── Rate-limit detection ──────────────────────────────────────────────────────

def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(s in msg for s in ("429", "rate limit", "resource exhausted", "quota", "too many"))


# ── Core streaming via OpenAI SDK ─────────────────────────────────────────────

async def _stream_openai_compat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    extra_headers: dict | None = None,
) -> AsyncIterator[str]:
    """Shared streaming logic for any OpenAI-compatible endpoint."""
    from openai import AsyncOpenAI  # lazy import

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        default_headers=extra_headers or {},
    )
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,          # type: ignore[arg-type]
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


# ── Public API ────────────────────────────────────────────────────────────────

async def stream_free_tier(
    messages: list[dict],
    max_tokens: int = 2_048,
    tier: str = "quick",
) -> AsyncIterator[str]:
    """
    Async generator — streams tokens from the chosen free-tier model via
    OpenRouter.  On a 429, automatically falls back to ``openrouter/auto``
    (OpenRouter picks whichever free model is available).

    Parameters
    ----------
    messages  : list of {"role": ..., "content": ...} dicts
    max_tokens: output token cap
    tier      : one of "quick" | "deep" | "long-context"
    """
    if not settings.OPENROUTER_API_KEY:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. "
            "Get a free key at openrouter.ai/keys and add it to .env."
        )

    model = _TIER_MODEL.get(tier, _TIER_MODEL["quick"])

    # First attempt: chosen tier model
    gen = _stream_openai_compat(
        base_url=_OR_BASE_URL,
        api_key=settings.OPENROUTER_API_KEY,
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        extra_headers=_OR_HEADERS,
    )
    try:
        first = await gen.__anext__()
    except StopAsyncIteration:
        await gen.aclose()
        return
    except Exception as exc:
        await gen.aclose()
        print(f"[LLM] {model} failed ({exc!r}), falling back to openrouter/auto", flush=True)
        if _is_rate_limit(exc) or True:   # any error → try auto fallback
            # Fallback: openrouter/auto picks an available free model
            fallback = _stream_openai_compat(
                base_url=_OR_BASE_URL,
                api_key=settings.OPENROUTER_API_KEY,
                model=_OR_FALLBACK_MODEL,
                messages=messages,
                max_tokens=max_tokens,
                extra_headers=_OR_HEADERS,
            )
            try:
                async for tok in fallback:
                    yield tok
                return
            finally:
                await fallback.aclose()
        raise

    # Primary model responded — stream the rest.
    print(f"[LLM] Serving via OpenRouter/{model} (tier={tier})", flush=True)
    try:
        yield first
        async for tok in gen:
            yield tok
    finally:
        await gen.aclose()


async def stream_byok(
    provider: str,
    model: str,
    api_key: str,
    messages: list[dict],
    max_tokens: int = 2_048,
) -> AsyncIterator[str]:
    """
    Stream from a user-supplied BYOK provider.

    Currently supports:
      deepseek — routes to api.deepseek.com (OpenAI-compatible)
      ollama   — routes to local Ollama instance; api_key carries the base URL
    """
    provider = provider.lower()

    if provider == "deepseek":
        gen = _stream_openai_compat(
            base_url="https://api.deepseek.com",
            api_key=api_key,
            model=model,
            messages=messages,
            max_tokens=max_tokens,
        )
    elif provider == "ollama":
        base_url = api_key or "http://localhost:11434"
        # Ollama also supports an OpenAI-compatible /v1 endpoint
        gen = _stream_openai_compat(
            base_url=f"{base_url.rstrip('/')}/v1",
            api_key="ollama",   # Ollama ignores the key but SDK requires non-empty
            model=model,
            messages=messages,
            max_tokens=max_tokens,
        )
    else:
        raise ValueError(f"Unknown BYOK provider '{provider}'. Supported: deepseek, ollama")

    try:
        async for tok in gen:
            yield tok
    finally:
        await gen.aclose()


async def test_connection(
    provider: str,
    model: str,
    api_key: str,
) -> dict:
    """
    Send a minimal probe to a BYOK provider.  Returns ``{"ok": True}`` or
    ``{"ok": False, "error": "..."}``.  Never raises.
    """
    probe = [{"role": "user", "content": "Reply with just the word 'ok'."}]
    gen = stream_byok(provider=provider, model=model, api_key=api_key,
                      messages=probe, max_tokens=10)
    try:
        first = await gen.__anext__()
        return {"ok": True, "sample": first.strip()}
    except StopAsyncIteration:
        return {"ok": True, "sample": ""}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        await gen.aclose()
