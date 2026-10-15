"""Cash-flow role: forecast, cash gap, reserves."""

ALLOWED_TOOLS = frozenset({
    "bank.balance", "bank.transactions", "bank.payouts", "analysis.reconcile", "analysis.forecast",
    "bank.reserve_create", "bank.reserve_release",
})


def propose_cashflow_steps(context: dict) -> list[dict]:
    """Return DAG node dicts for reserves / financing pre-fill given forecast + gap. Amounts come from tools."""
    # TODO
    raise NotImplementedError
