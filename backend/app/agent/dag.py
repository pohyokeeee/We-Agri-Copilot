"""Task DAG schema. The planner (mock templates now, an LLM later) emits this; deterministic code validates and runs it.

A plan only says WHICH tools run in WHAT order. It never decides a tier (the tier engine does), an amount (a node reads
it from an earlier node's result via {"$ref": "N3.reserve_amount"}) or a payee (resolved from the bank's own search).
"""
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DagNode(BaseModel):
    id: str
    tool: str  # a name in app.agent.tools.TOOLS
    label_zh: str = ""  # what the farmer reads on the plan card
    args: dict = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    undo: dict | None = None  # {"tool": ..., "args": ...} compensating call, e.g. release_reserve
    base_tier: Literal["green", "yellow", "red"] = "green"  # what the planner CLAIMS; never lower than the tool's real tier


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
        self.order()  # raises on a cycle
        return self

    def order(self) -> list[str]:
        """Dependency order; ties keep the order the nodes were written in."""
        done: list[str] = []
        todo = list(self.nodes)
        while todo:
            ready = next((n for n in todo if set(n.depends_on) <= set(done)), None)
            if ready is None:
                raise ValueError("dependency cycle")
            done.append(ready.id)
            todo.remove(ready)
        return done

    def node(self, node_id: str) -> DagNode:
        return next(n for n in self.nodes if n.id == node_id)

    def digest(self) -> str:
        body = json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(body.encode()).hexdigest()
