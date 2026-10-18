"""Per-role tool allow-lists. A plan may only use tools that some role owns; the planner role plans and owns none."""
from app.agent.roles import cashflow, payments, risk_policy

ROLE_TOOLS = {"cashflow": cashflow.ALLOWED_TOOLS, "payments": payments.ALLOWED_TOOLS, "risk_policy": risk_policy.ALLOWED_TOOLS}
ROLE_OF = {tool: role for role, tools in ROLE_TOOLS.items() for tool in tools}
