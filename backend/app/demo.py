"""Demo-only: put the whole demo back to its first state. Not part of the bank; refused unless it is clearly a local or demo server."""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from app.config import settings
from app.db import get_session

router = APIRouter(prefix="/demo", tags=["demo only"])
LOCAL = {"127.0.0.1", "::1", "localhost"}


@router.post("/reset")
def reset(request: Request, s: Session = Depends(get_session)):
    """Reseed the database (same fixed seed, so the same state every time) and forget every agent session."""
    if not (settings.demo_public or (request.client and request.client.host in LOCAL)):
        raise HTTPException(403, "重置演示只能在本机使用（共用的演示服务器需要设置 DEMO_PUBLIC=1）")
    from app.agent import graph
    from seed.seed import seed

    eng = s.get_bind()
    s.close()  # drop_all needs the connection back
    out = seed(eng)
    sv = graph.saver()  # agent sessions live in the LangGraph checkpoints
    with sv.lock:
        for table in ("checkpoints", "writes"):
            try:
                sv.conn.execute(f"DELETE FROM {table}")
            except sqlite3.OperationalError:  # the table appears with the first agent session; none yet = nothing to clear
                pass
        sv.conn.commit()
    return {"status": "reset", **out}
