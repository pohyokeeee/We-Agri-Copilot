"""Risk and policy role: compliance, subsidies and loans. The tiers themselves are never decided here (app.risk.tiers does)."""

ALLOWED_TOOLS = frozenset({"check_compliance", "match_policies", "prefill_financing", "submit_financing"})
