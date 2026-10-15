"""Planner role: turns a request into a Dag. Read/analysis tools only - it can never move money."""
from app.agent.dag import Dag

ALLOWED_TOOLS = frozenset({
    "bank.balance", "bank.transactions", "bank.payees", "bank.payouts",
    "analysis.reconcile", "analysis.compliance", "analysis.structures", "analysis.policy_match", "analysis.forecast",
})


def plan(transcript: str, session_id: str) -> Dag:
    """Ask the planner LLM (QWEN_PLANNER) for a Dag, then validate every node.tool against the allow-lists."""
    # TODO: S6 "下个月要收蜂蜜了，帮我准备一下" -> forecast -> reserve -> supplier payments -> financing
    raise NotImplementedError
