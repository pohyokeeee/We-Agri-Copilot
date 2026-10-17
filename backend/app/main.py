from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.analysis.router import router as analysis_router
from app.db import init_db
from app.mockbank import router as bank_router
from app.mockbank.cosign import router as cosign_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="We-Agri-Copilot 元农民 (Mock Bank — simulated accounts)", lifespan=lifespan)
app.include_router(bank_router)
app.include_router(cosign_router)
app.include_router(analysis_router)


@app.get("/health")
def health():
    return {"status": "ok", "notice": "SIMULATED ACCOUNTS - synthetic data only"}
