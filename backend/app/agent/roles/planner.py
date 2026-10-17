"""Planner role: turns a request into a Dag. Read/analysis tools only - it can never move money."""
from app.agent.dag import Dag

ALLOWED_TOOLS = frozenset({
    "bank.balance", "bank.transactions", "bank.payees", "bank.payouts",
    "analysis.reconcile", "analysis.compliance", "analysis.structures", "analysis.policy_match", "analysis.forecast",
})


def plan(transcript: str, session_id: str) -> Dag | str:
    """A Dag for a known request, else one clarifying question.

    Today: the deterministic templates in planner_mock. With the LLM: ask QWEN_PLANNER for a Dag, run tools.validate on it,
    and on any failure or invalid Dag fall back to planner_mock.plan(transcript).
    """
    from app.agent import planner_mock

    return planner_mock.plan(transcript)
