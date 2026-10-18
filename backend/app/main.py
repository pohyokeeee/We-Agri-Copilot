from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app import trace
from app.agent.router import router as agent_router
from app.analysis.router import router as analysis_router
from app.audit.router import audit_router, trace_router
from app.db import init_db
from app.mockbank.router import router as bank_router
from app.mockbank.cosign import router as cosign_router
from app.mockbank.financing import router as financing_router
from app.mockbank.rules import router as rules_router
from app.mockbank.schedules import router as schedules_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="We-Agri-Copilot 元农民 (Mock Bank — simulated accounts)", lifespan=lifespan)
app.include_router(agent_router)
app.include_router(trace_router)
app.include_router(audit_router)
app.include_router(bank_router)
app.include_router(cosign_router)
app.include_router(financing_router)
app.include_router(schedules_router)
app.include_router(rules_router)
app.include_router(analysis_router)


@app.middleware("http")
async def trace_every_request(request: Request, call_next):
    """Start (or continue, via X-Trace-Id) the trace; hand the id back so the client can pass it on."""
    ctx = trace.begin(request.headers.get("x-trace-id"), f"{request.method} {request.url.path}")
    response = await call_next(request)
    response.headers["X-Trace-Id"] = ctx["trace_id"]  # may differ from the request's: an approval's own trace wins
    return response


@app.get("/health")
def health():
    return {"status": "ok", "notice": "SIMULATED ACCOUNTS - synthetic data only"}
