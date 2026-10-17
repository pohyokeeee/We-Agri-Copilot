"""Request-scoped trace context. One trace = one user action (e.g. a payment from read-back to result).

Every audit row written during a request is stamped with the trace_id and the endpoint (chain.append calls stamp()).
The id comes from the client's X-Trace-Id header (validated, it is untrusted) or is generated at the first call.
An approval remembers the trace it was born in, so the co-signer's decision and the final execution join that trace
even though they arrive in other requests, possibly from another phone.
"""
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar

_ctx: ContextVar[dict | None] = ContextVar("trace_ctx", default=None)
VALID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def begin(header: str | None, endpoint: str) -> dict:
    ctx = {"trace_id": header if header and VALID.match(header) else uuid.uuid4().hex[:16], "endpoint": endpoint, "wording": 0}
    _ctx.set(ctx)
    return ctx


def current() -> str | None:
    ctx = _ctx.get()
    return ctx["trace_id"] if ctx else None


def adopt(trace_id: str | None) -> None:
    """Continue an earlier trace (an approval's) for the rest of this request."""
    ctx = _ctx.get()
    if ctx and trace_id:
        ctx["trace_id"] = trace_id


@contextmanager
def using(trace_id: str | None):
    ctx = _ctx.get()
    if not ctx or not trace_id:
        yield
        return
    old, ctx["trace_id"] = ctx["trace_id"], trace_id
    try:
        yield
    finally:
        ctx["trace_id"] = old


def note_wording(texts: int) -> None:
    """The wording checker passed `texts` texts in this request (a failure raises instead)."""
    ctx = _ctx.get()
    if ctx:
        ctx["wording"] += texts


def stamp(payload: dict) -> dict:
    """What every audit row written inside a request also carries. Explicit keys in the payload win."""
    ctx = _ctx.get()
    if not ctx:
        return payload
    extra = {"trace_id": ctx["trace_id"], "endpoint": ctx["endpoint"]}
    if ctx["wording"]:
        extra["wording_check"] = f"pass ({ctx['wording']} texts)"
    return {**extra, **payload}
