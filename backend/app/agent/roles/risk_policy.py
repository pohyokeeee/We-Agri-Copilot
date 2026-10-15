"""Risk/policy role: explains tiers and compliance. Cannot execute anything."""

ALLOWED_TOOLS = frozenset({"risk.classify", "analysis.compliance", "analysis.policy_match", "bank.balance"})


def explain_tier(tier_result: dict) -> str:
    """Plain-language (Mandarin) explanation of a tier result. The tier itself is never decided here."""
    # TODO
    raise NotImplementedError
