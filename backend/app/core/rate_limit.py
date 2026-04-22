"""
Simple in-memory sliding-window rate limiter.

Usage:
    from app.core.rate_limit import rate_limit_check

    if not rate_limit_check(user_id, "chat", max_calls=30, window_secs=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment.")
"""
from __future__ import annotations

import time
from collections import defaultdict

# {"{user_id}:{endpoint}": [timestamp, ...]}
_windows: dict[str, list[float]] = defaultdict(list)


def rate_limit_check(
    user_id: str,
    endpoint: str,
    max_calls: int,
    window_secs: int = 60,
) -> bool:
    """
    Sliding-window rate limit check.

    Trims expired timestamps on every call. Returns True if the request
    is allowed, False if the limit has been exceeded.
    """
    key = f"{user_id}:{endpoint}"
    now = time.monotonic()
    cutoff = now - window_secs

    timestamps = _windows[key]
    trimmed = [t for t in timestamps if t > cutoff]
    _windows[key] = trimmed

    if len(trimmed) >= max_calls:
        return False

    _windows[key].append(now)
    return True
