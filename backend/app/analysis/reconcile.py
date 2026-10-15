"""Sales record: match platform orders to bank payouts and tag income_class."""
from sqlmodel import Session


def reconcile(session: Session, customer_id: int) -> dict:
    """Match platform_order rows to monthly platform payouts (net of fee) and tag each order
    own_produce / resale (supplier purchases vs sales volume) / processed.

    Returns {matched, unmatched_orders, unmatched_payouts, tagged: {own_produce, resale, processed}}.
    Deterministic: the LLM never assigns a tag or an amount.
    """
    # TODO: group orders by (platform, month), compare with payout net of fee, tag from product + supplier payments
    raise NotImplementedError


def detect_anomalies(session: Session, customer_id: int) -> list[dict]:
    """Flag duplicate charges and unusual (night / new payee) payments. Returns [{kind, txn_ids, reason}]."""
    # TODO: seed plants one duplicate card charge and one night payment to a new payee
    raise NotImplementedError
