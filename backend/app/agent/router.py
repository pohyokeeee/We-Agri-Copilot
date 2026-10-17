"""Agent endpoints. The text goes to the mock planner (an LLM later); everything that matters is decided by code."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.agent import executor, tools
from app.db import get_session

router = APIRouter(prefix="/agent", tags=["agent (mock planner, deterministic)"])


class MessageIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=200)
    customer_id: int = 1


class ApproveIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    node_id: str = Field(min_length=1, max_length=16)
    token: str = Field(min_length=1, max_length=200)  # from the bank's approval flow, never made up by the plan


class CommandIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    command: Literal["等一下", "继续", "贷款先不要", "算了", "找人工"]


def _plan(s: Session, session_id: str):
    plan = executor.latest(s, session_id)
    if not plan:
        raise HTTPException(404, "没有这个会话")
    return plan


def _run(s: Session, fn, *a):
    try:
        result = fn(*a)
    except tools.PlanRejected as e:
        raise HTTPException(422, f"计划被拒绝：{e}")
    except executor.AgentError as e:
        raise HTTPException(e.status, e.detail)
    s.commit()
    return result


@router.post("/message")
def message(body: MessageIn, s: Session = Depends(get_session)):
    return _run(s, executor.message, s, body.session_id, body.customer_id, body.text)


@router.post("/approve")
def approve(body: ApproveIn, s: Session = Depends(get_session)):
    return _run(s, executor.approve, s, _plan(s, body.session_id), body.node_id, body.token)


@router.post("/command")
def command(body: CommandIn, s: Session = Depends(get_session)):
    return _run(s, executor.command, s, _plan(s, body.session_id), body.command)


@router.get("/session/{session_id}")
def session(session_id: str, s: Session = Depends(get_session)):
    return executor.view(s, _plan(s, session_id))
