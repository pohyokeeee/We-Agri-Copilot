"""Public demo only (DEMO_PUBLIC=1): a per-IP and a daily budget for paid model calls.
Over budget, qwen raises LLMError, so every caller uses its deterministic template (what happens with no key), and the response
carries X-Demo-Notice so the site can say so calmly."""
import time
from collections import defaultdict, deque

from app import trace
from app.config import settings

_hits: dict[str, deque] = defaultdict(deque)
_day = ["", 0]  # [date, calls so far]  ponytail: in-memory, one process; use Redis if the service ever runs more than one instance


def allowed() -> bool:
    if not settings.demo_public:
        return True
    ctx = trace._ctx.get() or {}
    q, now, today = _hits[ctx.get("ip", "?")], time.time(), time.strftime("%Y-%m-%d")
    while q and now - q[0] > 60:
        q.popleft()
    if _day[0] != today:
        _day[:] = [today, 0]
    if len(q) >= settings.demo_per_minute or _day[1] >= settings.demo_daily_cap:
        ctx["limited"] = True
        return False
    q.append(now)
    _day[1] += 1
    return True
