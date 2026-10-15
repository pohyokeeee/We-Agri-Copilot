from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class AgentPlan(SQLModel, table=True):
    __tablename__ = "agent_plan"
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    dag_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = "draft"  # draft | running | interrupted | done | rolled_back


class AgentAudit(SQLModel, table=True):
    __tablename__ = "agent_audit"
    id: int | None = Field(default=None, primary_key=True)
    prev_hash: str
    hash: str
    ts: str  # ISO string (naive CST) - hashed verbatim, so no datetime round-trip drift
    actor: str
    event: str
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
