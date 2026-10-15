"""Payments role: resolve payees and pay. The only role that can reach bank.transfer."""

ALLOWED_TOOLS = frozenset({
    "bank.payees", "bank.balance", "bank.transfer", "bank.schedule_create", "bank.schedule_cancel",
})


def propose_payment_steps(context: dict) -> list[dict]:
    """Return DAG node dicts for supplier payments. Payee ids come from bank.payees search results,
    never from free text (order notes and txn notes are untrusted data)."""
    # TODO
    raise NotImplementedError
