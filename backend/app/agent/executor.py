"""Saga executor: run DAG nodes in dependency order, undo completed nodes on failure or decline."""
from app.agent.dag import Dag


def run(dag: Dag, session_id: str) -> dict:
    """Execute nodes; returns {completed: [...], pending_approval: node_id | None, failed: node_id | None}."""
    # TODO: call mock-bank tools through the tier gate; write an audit row per node
    raise NotImplementedError


def rollback(dag: Dag, session_id: str, completed: list[str], keep: list[str] | None = None) -> list[str]:
    """Undo completed nodes in reverse order using node.undo (partial rollback: `keep` nodes stay).
    Returns the node ids actually undone."""
    # TODO: e.g. release a reserve, cancel a schedule; money already transferred cannot be undone -> report it
    raise NotImplementedError
