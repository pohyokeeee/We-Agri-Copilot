"""LangGraph wiring: one graph node per DAG node, in dependency order, with a SQLite checkpointer.

The real state of a plan lives in the database (AgentPlan.state), so commands such as "算了" never have to edit a
checkpoint. LangGraph supplies what it is good at: running the nodes in order, pausing inside a node that needs an
approval (interrupt), and resuming from the saved position with the approved token (Command(resume=token)).
On resume the interrupted node runs again from its top, so a node must do nothing irreversible before it asks.
"""
import sqlite3
from pathlib import Path
from typing import Callable, TypedDict

from app.config import settings


class State(TypedDict):
    plan_id: int


_savers: dict[str, object] = {}  # one SqliteSaver per database path


def saver():
    path = settings.checkpoint_db
    if path not in _savers:
        from langgraph.checkpoint.sqlite import SqliteSaver

        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        _savers[path] = SqliteSaver(sqlite3.connect(path, check_same_thread=False))  # FastAPI runs endpoints on worker threads
    return _savers[path]


def build(order: list[str], run_node: Callable):
    """Compile the chain n1 -> n2 -> ... for this plan's nodes. Same order every time, so a saved run can resume."""
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import interrupt

    g = StateGraph(State)
    for nid in order:
        g.add_node(nid, lambda state, _id=nid: run_node(_id, state["plan_id"], interrupt) or {})
    g.add_edge(START, order[0])
    for a, b in zip(order, order[1:]):
        g.add_edge(a, b)
    g.add_edge(order[-1], END)
    return g.compile(checkpointer=saver())


def run(order: list[str], thread: str, plan_id: int, run_node: Callable, resume: str = "") -> str | None:
    """Start the plan, or continue it from where it stopped. Returns the node waiting for approval, or None if it finished."""
    from langgraph.types import Command

    g = build(order, run_node)
    cfg = {"configurable": {"thread_id": thread}}
    snap = g.get_state(cfg)
    if snap.next:
        g.invoke(Command(resume=resume), cfg)
    elif not snap.values:
        g.invoke({"plan_id": plan_id}, cfg)
    else:
        return None  # already finished
    snap = g.get_state(cfg)
    return snap.next[0] if snap.next else None
