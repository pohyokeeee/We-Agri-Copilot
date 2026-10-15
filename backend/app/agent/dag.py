"""Task DAG schema. The planner LLM emits this; deterministic code validates and runs it."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DagNode(BaseModel):
    id: str
    tool: str  # must be in the role's allow-list (app.agent.roles)
    args: dict = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    undo: dict | None = None  # {"tool": ..., "args": ...} compensating call, e.g. bank.reserve_release
    base_tier: Literal["green", "yellow", "red"] = "green"  # advisory; the real tier comes from app.risk.tiers


class Dag(BaseModel):
    nodes: list[DagNode]

    @model_validator(mode="after")
    def _check(self):
        ids = [n.id for n in self.nodes]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate node id")
        for n in self.nodes:
            if missing := set(n.depends_on) - set(ids):
                raise ValueError(f"{n.id} depends on unknown {missing}")
        return self
