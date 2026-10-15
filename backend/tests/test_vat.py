import json
from pathlib import Path

from app.tax.vat import vat_due

RULES = json.loads((Path(__file__).parents[1] / "seed" / "rules_tax.json").read_text(encoding="utf-8"))
RULE = next(r for r in RULES if r["rule_id"] == "vat_ann2026_no10_threshold")["rate_or_threshold"]


def test_monthly_boundary():
    assert vat_due(99_999, "month", RULE)["exempt"]
    r = vat_due(100_000, "month", RULE)
    assert not r["exempt"] and r["taxable_base"] == 100_000 and r["vat"] == 1000.0  # FULL amount, 1%


def test_quarterly_boundary():
    assert vat_due(299_999, "quarter", RULE)["exempt"]
    r = vat_due(300_000, "quarter", RULE)
    assert not r["exempt"] and r["taxable_base"] == 300_000


def test_per_occasion_boundary():
    assert vat_due(999, "occasion", RULE)["exempt"]
    assert not vat_due(1000, "occasion", RULE)["exempt"]


def test_own_produce_always_exempt():
    assert vat_due(5_000_000, "month", RULE, own_produce=True)["exempt"]
