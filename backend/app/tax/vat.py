"""VAT threshold check (MOF/SAT Announcement 2026 No.10 as seeded in rules_tax.json).

Exempt only while sales are strictly BELOW the threshold; REACHING it taxes the FULL amount.
`rule` is the rule_tax row's rate_or_threshold dict, so the numbers live in the rule table, not here.
Information only - not tax advice.
"""


def vat_due(sales: float, period: str, rule: dict, own_produce: bool = False) -> dict:
    """period: 'month' | 'quarter' | 'occasion'. Returns {exempt, taxable_base, vat}."""
    if own_produce:  # VAT Law Art. 24: farmers' own primary produce is exempt, whatever the amount
        return {"exempt": True, "taxable_base": 0.0, "vat": 0.0}
    limit = rule["thresholds"][period]
    if sales < limit:
        return {"exempt": True, "taxable_base": 0.0, "vat": 0.0}
    return {"exempt": False, "taxable_base": sales, "vat": round(sales * rule["levy_rate"], 2)}
