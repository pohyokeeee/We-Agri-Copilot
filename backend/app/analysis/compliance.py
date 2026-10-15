"""Tax compliance check - cited information, never advice, never filing."""
from sqlmodel import Session


def check_compliance(session: Session, customer_id: int, period: str) -> dict:
    """Compare the sales record with rule_tax rows (VAT threshold, platform reporting, late-fee exposure).

    Returns {findings: [{rule_id, status, message, citation_url, rule_status}], disclaimer}.
    Every finding carries its rule_id + citation; rows with status 'recall' must be marked unverified.
    """
    # TODO: use app.tax.vat.vat_due; never state a conclusion without a rule_id
    raise NotImplementedError
