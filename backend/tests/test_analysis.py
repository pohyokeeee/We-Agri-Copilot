from datetime import datetime
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.agent.grounding import check_wording
from app.analysis.reconcile import monthly_class_totals, reconcile_range
from app.audit.chain import verify_chain
from app.models import AgentAudit, BankTxn, PlatformOrder
from app.tax.vat import vat_due

ORDERS = Path(__file__).parents[1] / "seed" / "orders"
WINDOW = (datetime(2025, 7, 1), datetime(2026, 7, 1))


def events(engine, event):
    with Session(engine) as s:
        return [a for a in s.exec(select(AgentAudit)) if a.event == event]


def test_import_both_platform_styles(seeded):
    client, _ = seeded
    for platform, f in (("marketplace", "marketplace_sample.csv"), ("livestream", "livestream_sample.csv")):
        r = client.post("/bank/orders/import", params={"platform": platform}, json={"csv": (ORDERS / f).read_text(encoding="utf-8")})
        assert r.json()["new"] == 12


def test_reconcile_finds_gap_and_resale_share(seeded):
    client, engine = seeded
    r = client.get("/bank/income/reconcile", params={"period": "2026-Q2"}).json()
    g = r["gap_breakdown"]
    assert r["gap"] > 0 and g["resale"] > 0 and g["missed_payout"] == 0
    assert r["gap"] == pytest.approx(sum(g.values()), abs=0.02)  # buckets explain the whole gap
    assert r["platform_reported"] == pytest.approx(r["record_total"] + r["gap"], abs=0.02)
    assert 0.005 < r["platform_fees"] / r["platform_reported"] < 0.007  # the 0.6% fee seeded
    with Session(engine) as s:
        year = reconcile_range(s, 1, *WINDOW)
    assert 0.36 < year["by_class"]["resale"] / sum(year["by_class"].values()) < 0.41
    assert events(engine, "income_reconciled")  # audited


def test_missed_payout_and_needs_confirmation(seeded):
    client, engine = seeded
    with Session(engine) as s:
        june = s.exec(select(BankTxn).where(BankTxn.channel == "platform_payout", BankTxn.counterparty.contains("直播"),
                                            BankTxn.ts >= datetime(2026, 6, 1))).one()
        s.delete(june)
        s.add(PlatformOrder(id="MK-X1", platform="marketplace", ts=datetime(2026, 6, 5), product="神秘商品", qty=1,
                            amount=50.0, imported_at=datetime(2026, 7, 1)))
        s.commit()
    r = client.get("/bank/income/reconcile", params={"period": "2026-Q2"}).json()
    assert r["gap_breakdown"]["missed_payout"] > 0  # the deleted livestream payout
    assert r["gap_breakdown"]["needs_confirmation"] == 50.0  # not guessed
    assert r["needs_confirmation"] == [{"product": "神秘商品", "orders": 1, "amount": 50.0}]
    # the extra small order must not break the marketplace payout match
    assert r["gap"] == pytest.approx(sum(r["gap_breakdown"].values()), abs=0.02)


def test_statement(seeded):
    client, engine = seeded
    r = client.get("/bank/income/statement", params={"year": 2026}).json()
    assert len(r["months"]) == 6 and r["pension"] == 246 * 6
    assert r["totals"]["total"] == pytest.approx(sum(m["total"] for m in r["months"]), abs=0.02)
    assert r["totals"]["needs_confirmation"] == 0
    assert events(engine, "income_statement")


def test_compliance_flags_cite_rules(seeded):
    client, engine = seeded
    r = client.post("/analysis/compliance", json={}).json()
    assert r["period"] == "2026-Q2" and 2 <= len(r["flags"]) <= 4
    assert {f["code"] for f in r["flags"]} >= {"RESALE_SHARE", "RECONCILIATION_GAP", "VAT_THRESHOLD"}
    for f in r["flags"]:
        assert f["rule_ids"] and set(f["rule_ids"]) <= set(r["rules"])
        assert check_wording(f["plain_text_zh"])["ok"]
    share = next(f for f in r["flags"] if f["code"] == "RESALE_SHARE")["numbers"]["resale_share"]
    assert 0.36 < share < 0.41
    vat = next(f for f in r["flags"] if f["code"] == "VAT_THRESHOLD")["numbers"]
    assert vat["quarter_status"] == vat["month_status"] == "below" and vat["quarter_threshold"] == 300_000
    assert r["disclaimer"] == "这是信息，不是建议 · 请咨询12366"
    assert events(engine, "compliance_checked")
    with Session(engine) as s:
        assert verify_chain(s) == (True, None)


@pytest.mark.parametrize("month_resale,status", [(99_999.0, "below"), (100_000.0, "reached")])
def test_compliance_month_threshold_boundary(seeded, month_resale, status):
    client, engine = seeded
    with Session(engine) as s:
        have = monthly_class_totals(s, datetime(2026, 6, 1), datetime(2026, 7, 1))["2026-06"]["resale"]
        s.add(PlatformOrder(id="MK-BIG", platform="marketplace", ts=datetime(2026, 6, 20), product="邻家蜂蜜 500g", qty=1,
                            amount=round(month_resale - have, 2), imported_at=datetime(2026, 7, 1)))
        s.commit()
    vat = next(f for f in client.post("/analysis/compliance", json={}).json()["flags"] if f["code"] == "VAT_THRESHOLD")
    assert vat["numbers"]["month_status"] == status  # REACHING 100,000 counts as reached


def test_vat_due_threshold_comes_from_rule_row(seeded):
    _, engine = seeded
    from app.models import RuleTax

    with Session(engine) as s:
        rule = s.get(RuleTax, "vat_ann2026_no10_threshold").rate_or_threshold
    assert vat_due(99_999, "month", rule)["exempt"] and not vat_due(100_000, "month", rule)["exempt"]
    assert vat_due(100_000, "month", rule)["taxable_base"] == 100_000
    assert not vat_due(300_000, "quarter", rule)["exempt"]


def test_structures_table(seeded):
    client, engine = seeded
    r = client.post("/analysis/structures", json={}).json()
    assert [c["key"] for c in r["columns"]] == ["A_individual", "B_geti", "C_cooperative", "D_company"]
    assert [x["key"] for x in r["rows"]] == ["vat", "income_tax", "paperwork"]
    for row in r["rows"]:
        assert set(row["cells"]) == {c["key"] for c in r["columns"]}
        for cell in row["cells"].values():
            assert cell["rule_ids"] and set(cell["rule_ids"]) <= set(r["rules"])
            assert cell["status"] in ("verified", "recall")
            assert check_wording(cell["text_zh"])["ok"]
            if cell["status"] == "recall":
                assert cell["text_zh"] == "待核实" and cell["value"] is None
    cells = {(row["key"], k): c for row in r["rows"] for k, c in row["cells"].items()}
    assert cells["vat", "C_cooperative"]["status"] == "recall"  # co-op rule is 'recall'
    assert cells["vat", "B_geti"]["status"] == "verified" and cells["vat", "B_geti"]["value"] == 0.0
    assert cells["income_tax", "B_geti"]["value"] > 0  # his estimated taxable income
    assert events(engine, "structures_compared")


@pytest.mark.parametrize("text", [
    "你应该注册个体工商户", "您应该选择合作社", "建议你注册公司", "建议您去注册", "您的蜂蜜免税",
    "您免征增值税", "我帮你申报增值税", "可以去报税", "代办注册", "提交材料",
])
def test_wording_checker_rejects(text):
    assert not check_wording(text)["ok"]


def test_wording_checker_accepts_rule_style_text():
    assert check_wording("规则：自产初级农产品免征增值税；转卖部分达到门槛则全额计税。请咨询12366。")["ok"]


def test_bad_period_422(seeded):
    client, _ = seeded
    assert client.post("/analysis/compliance", json={"period": "2026Q2"}).status_code == 422
    assert client.get("/bank/income/reconcile", params={"period": "x"}).status_code == 422
