from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import init_db
from app.mockbank import router as bank_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="We-Agri-Copilot 元农民 (Mock Bank — simulated accounts)", lifespan=lifespan)
app.include_router(bank_router)


@app.get("/health")
def health():
    return {"status": "ok", "notice": "SIMULATED ACCOUNTS - synthetic data only"}
