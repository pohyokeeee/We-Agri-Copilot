from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app import trace
from app.config import settings
from app.agent.router import router as agent_router
from app.analysis.router import router as analysis_router
from app.audit.router import audit_router, trace_router
from app.db import init_db
from app.demo import router as demo_router
from app.mockbank.router import router as bank_router
from app.mockbank.cosign import router as cosign_router
from app.mockbank.financing import router as financing_router
from app.mockbank.rules import router as rules_router
from app.mockbank.schedules import router as schedules_router
from app.voice.router import router as voice_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


# a public demo has no interactive docs and no cross-origin callers: the site is served from the same URL
PUBLIC = settings.demo_public
app = FastAPI(title="We-Agri-Copilot 元农民 (Mock Bank — simulated accounts)", lifespan=lifespan,
              docs_url=None if PUBLIC else "/docs", redoc_url=None, openapi_url=None if PUBLIC else "/openapi.json")
ROUTERS = [agent_router, trace_router, audit_router, bank_router, cosign_router, financing_router, schedules_router, rules_router, voice_router, analysis_router, demo_router]
for r in ROUTERS:
    app.include_router(r)  # the Mini Program and the tests
    app.include_router(r, prefix="/api")  # the website: one origin, API under /api


if not PUBLIC:  # public demo = same origin only, CORS stays closed
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                       allow_origin_regex=settings.cors_origin_regex, allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Trace-Id"])


@app.middleware("http")
async def trace_every_request(request: Request, call_next):
    """Start (or continue, via X-Trace-Id) the trace; hand the id back so the client can pass it on."""
    ctx = trace.begin(request.headers.get("x-trace-id"), f"{request.method} {request.url.path}")
    ctx["ip"] = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()  # behind Render's proxy
    response = await call_next(request)
    if ctx.get("limited"):
        response.headers["X-Demo-Notice"] = "limited"  # a model call was refused (demo budget): the answer came from a template
    response.headers["X-Trace-Id"] = ctx["trace_id"]  # may differ from the request's: an approval's own trace wins
    return response


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok", "notice": "SIMULATED ACCOUNTS - synthetic data only", "demo": settings.demo_public}


# The built website (web/dist), when it exists: files as they are, anything else is the single page app. Added last, so every API route wins.
DIST = Path(settings.web_dist)
if (DIST / "index.html").is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def site(path: str, request: Request):
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST.resolve() in f.parents:
            return FileResponse(f)
        if "text/html" not in request.headers.get("accept", ""):  # a page load, not an API call: unknown API paths stay 404
            raise HTTPException(404)
        return FileResponse(DIST / "index.html")
