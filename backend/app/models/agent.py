from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class AgentPlan(SQLModel, table=True):
    """One user request turned into a DAG. dag_json = {"dag": ..., "hash": sha256 of the dag}; state = live node states."""
    __tablename__ = "agent_plan"
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    customer_id: int = 1
    utterance: str = ""
    trace_id: str = ""
    dag_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    state: dict = Field(default_factory=dict, sa_column=Column(JSON))  # {order, nodes{id: {...}}, pending, notice_zh}
    status: str = "running"  # running | waiting | paused | done | failed | cancelled | handed_over
    paused: bool = False


class AgentAudit(SQLModel, table=True):
    __tablename__ = "agent_audit"
    id: int | None = Field(default=None, primary_key=True)
    prev_hash: str
    hash: str
    ts: str  # ISO string (naive CST) - hashed verbatim, so no datetime round-trip drift
    actor: str
    event: str
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))


class AgentHandover(SQLModel, table=True):
    """"找人工": everything a human needs to take over - the plan, how far it got, and the trace to look at."""
    __tablename__ = "agent_handover"
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    plan_id: int
    trace_id: str
    reason: str = ""
    dag_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    state: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: str = ""
