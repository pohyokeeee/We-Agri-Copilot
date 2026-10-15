"""Subsidy and loan matching against the single SIMULATED county table."""
from sqlmodel import Session


def match_policies(session: Session, customer_id: int) -> list[dict]:
    """Return rule_policy rows the customer *may qualify* for.

    Each item: {policy_id, name, wording: 'may qualify', met: [...], unmet: [...], documents, deadline, simulated}.
    Never says 'qualifies' or 'approved'; always labels simulated=True rows.
    """
    # TODO: evaluate rule_policy.eligibility JSON against customer facts + sales record
    raise NotImplementedError
