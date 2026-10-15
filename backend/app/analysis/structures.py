"""Business-structure comparison: A individual / B 个体工商户 / C cooperative / D company."""
from sqlmodel import Session

STRUCTURES = ("A_individual", "B_geti", "C_cooperative", "D_company")


def compare_structures(session: Session, customer_id: int) -> dict:
    """Compute estimated VAT / IIT / EIT per structure from the sales record and rule_tax.

    Returns {structure: {cells: [{label, value, rule_id, citation_url, status}], assumptions: [...]}}.
    Information, not a recommendation: no 'best' field.
    """
    # TODO: deterministic calc per structure; each cell cites a rule_id (comparison UI shows a citation icon per cell)
    raise NotImplementedError
