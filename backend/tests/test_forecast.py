from datetime import date, datetime

import pytest
from sqlmodel import Session, select

from app import clock
from app.analysis.forecast import forecast_procurement
from app.audit.chain import verify_chain
from app.config import settings
from app.models import AgentAudit, BankApproval, BankReserve, BankTxn
from tests.conftest import REAL_NOW


def last_year_actual(engine):
    with Session(engine) as s:
        rows = s.exec(select(BankTxn).where(BankTxn.category == "supplier_honey", BankTxn.ts >= datetime(2025, 8, 1),
                                            BankTxn.ts < datetime(2025, 10, 1))).all()
    by = {}
    for t in rows:
        by[t.counterparty] = by.get(t.counterparty, 0) + t.amount
    return sum(by.values()), by


def test_next_purchase_window_and_range_contains_last_year(seeded):
    client, engine = seeded
    d = client.post("/analysis/procurement-forecast", json={}).json()
    assert d["today"] == "2026-07-25"
    p = d["next_purchases"][0]
    assert (p["activity"], p["window_start"], p["window_end"], p["days_until"]) == ("收购邻居蜂蜜", "2026-08-01", "2026-09-30", 7)
    assert len(p["suppliers"]) == 6
    total, by = last_year_actual(engine)
    assert p["amount_low"] <= total <= p["amount_high"] and p["amount_low"] < p["amount_high"]  # a range, not one number
    for sp in p["suppliers"]:
        assert sp["amount_low"] <= by[sp["name"]] <= sp["amount_high"]
        assert sp["last_year_total"] == by[sp["name"]] and sp["payee_id"]
    assert (d["amount_low"], d["amount_high"]) == (p["amount_low"], p["amount_high"])


def test_gap_about_2400_for_uncle_wang(seeded):
    client, _ = seeded
    d = client.post("/analysis/procurement-forecast", json={}).json()
    assert d["gap_expected"] == pytest.approx(2400, abs=300)
    assert d["gap_low"] <= d["gap_expected"] <= d["gap_high"]
    assert d["cash_available_low"] < d["cash_available_high"]
    det = d["cash_detail"]  # the arithmetic is visible: balance + inflows - outflows
    assert det["available"] == det["balance"] - det["reserved"]
    assert [x["label"] for x in det["inflows"]] == ["平台打款"] and [x["label"] for x in det["outflows"]] == ["家庭开支"]
    mid = (d["cash_available_low"] + d["cash_available_high"]) / 2
    exp = det["available"] + sum((x["low"] + x["high"]) / 2 for x in det["inflows"]) - sum((x["low"] + x["high"]) / 2 for x in det["outflows"])
    assert mid == pytest.approx(exp, abs=0.05)


def test_assumptions_plain_chinese(seeded):
    client, _ = seeded
    a = client.post("/analysis/procurement-forecast", json={}).json()["assumptions"]
    assert len(a) >= 5 and all(any("\u4e00" <= c <= "\u9fff" for c in x) for x in a)


def test_plan_steps_carry_tiers_and_full_loan_cost(seeded):
    client, engine = seeded
    before = client.get("/bank/balance").json()
    d = client.post("/analysis/procurement-forecast", json={}).json()
    plan = d["plan"]
    steps = {x["id"]: x for x in plan["steps"]}
    assert list(steps) == ["reserve", "financing_prefill", "financing_submit", "pay_suppliers"]
    assert steps["reserve"]["tier"] in ("yellow", "red") and steps["financing_prefill"]["tier"] == "yellow"
    assert steps["financing_submit"]["tier"] == "red" and steps["financing_submit"]["requires_cosigner"]  # protection mode
    assert steps["pay_suppliers"]["tier"] == "red" and len(steps["pay_suppliers"]["suppliers"]) == 6
    assert all(x["tier"] in ("green", "yellow", "red") and x["marker"] in "🟢🟡🔴" and x["text_zh"] for x in plan["steps"])
    assert plan["financing"], "a gap should bring financing options"
    for f in plan["financing"]:
        assert f["total_cost"] == pytest.approx(f["interest"] + f["fee"], abs=0.01)  # FULL cost = interest + fees
        assert f["amount"] >= d["gap_high"] and f["total_repay"] == pytest.approx(f["amount"] + f["total_cost"], abs=0.01)
    a = next(f for f in plan["financing"] if f["name"].endswith("A"))
    b = next(f for f in plan["financing"] if f["name"].endswith("B"))
    assert a["fee"] == 0 and b["fee"] > 0  # B's 0.5% fee is in its cost
    # nothing was executed
    assert plan["executed"] is False and client.get("/bank/balance").json() == before
    with Session(engine) as s:
        assert not s.exec(select(BankApproval)).all() and not s.exec(select(BankReserve)).all()


def test_audit_row_written(seeded):
    client, engine = seeded
    client.post("/analysis/procurement-forecast", json={})
    with Session(engine) as s:
        rows = [a for a in s.exec(select(AgentAudit)) if a.event == "procurement_forecast"]
        assert len(rows) == 1 and rows[0].payload["window_start"] == "2026-08-01"
        assert verify_chain(s) == (True, None)


def test_demo_clock_default_and_override(seeded, monkeypatch):
    client, _ = seeded
    monkeypatch.setattr(clock, "now", REAL_NOW)  # undo the test fixture's freeze: use the real helper
    assert settings.demo_today == "2026-07-25" and clock.today() == date(2026, 7, 25)
    monkeypatch.setattr(settings, "demo_today", "2026-05-20")
    assert clock.today() == date(2026, 5, 20)
    d = client.post("/analysis/procurement-forecast", json={}).json()
    assert d["today"] == "2026-05-20"
    assert [p["activity"] for p in d["next_purchases"]] == ["买瓶罐和标签"]  # honey is 73 days out, beyond the horizon


def test_no_upcoming_purchase(seeded):
    _, engine = seeded
    with Session(engine) as s:
        d = forecast_procurement(s, 1, today=date(2026, 5, 20), horizon_days=10)
    assert d["next_purchases"] == [] and d["assumptions"] and d["plan"]["steps"] == []


def test_backtest_runs_on_synthetic_households():
    from scripts.backtest_forecast import SEEDS, run

    rows = run(write=False)
    assert len(rows) == len(SEEDS) >= 3
    for r in rows:
        assert r["low"] > 0 and r["low"] <= r["high"] and r["actual"] > 0 and abs(r["error_pct"]) < 25
