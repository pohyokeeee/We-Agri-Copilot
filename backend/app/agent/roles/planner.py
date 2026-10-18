"""Planner role: turns a request into a Dag. It plans and owns no tool; it can only compose what other roles own."""
from app.agent.dag import Dag

ALLOWED_TOOLS: frozenset[str] = frozenset()


def plan(transcript: str, session_id: str) -> Dag | str:
    """A Dag for a request, else one clarifying question. See app.agent.planner."""
    from app.agent import planner

    return planner.plan(transcript)[0]
