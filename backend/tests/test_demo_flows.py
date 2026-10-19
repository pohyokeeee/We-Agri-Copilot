"""Demo tools and the tax estimate: reset, suspicious import, payout + tax pot, co-sign separation, threshold boundary."""
from datetime import datetime

import pytest
from sqlmodel import Session, select

from app.analysis.tax_estimate import FOOTER
from app.config import settings
from app.models import AgentAudit, BankCustomer, PlatformOrder, ReserveRule
from tests.test_bank import cosign_approve, red_until_cosign


def _events(engine, event):
    with Session(engine) as s:
        return [a for a in s.exec(select(AgentAudit)) if a.event == event]


def _rule(engine, percent=0.01):
    with Session(engine) as s:
        s.add(ReserveRule(customer_id=1, percent=percent, source="resale_payout", created_at=datetime(2026, 7, 25, 12)))
        s.commit()


# ---------- reset ----------
def test_reset_is_refused_unless_local_or_public(seeded):
    client, _ = seeded
    assert client.post("/demo/reset").status_code == 403  # the test client is not a loopback address


def test_reset_restores_the_seed_state(seeded, monkeypatch):
    client, engine = seeded
    monkeypatch.setattr(settings, "demo_public", True)
    first = client.get("/bank/balance").json()
    _rule(engine)
    client.post("/bank/demo/payouts", json={"amount": 5000})
    client.post("/bank/demo/orders/import-suspicious")
    assert client.get("/bank/security/status").json()["locked"]

    out = client.post("/demo/reset").json()
    assert out["status"] == "reset"
    assert client.get("/bank/balance").json() == first
    assert client.get("/bank/security/status").json()["locked"] is False
    assert client.get("/bank/reserves/rules").json() == {"rules": [], "pot_total": 0.0}
    with Session(engine) as s:
        assert len(s.exec(select(PlatformOrder)).all()) == out["orders"]
        assert [a.event for a in s.exec(select(AgentAudit))] == ["seeded"]  # a fresh chain, nothing left from before


# ---------- suspicious import ----------
def test_suspicious_import_flags_and_locks_every_time(seeded):
    client, engine = seeded
    for n in (1, 2):
        r = client.post("/bank/demo/orders/import-suspicious").json()
        assert r["new"] == 1 and len(r["flagged"]) == 1 and r["locked"] is True  # a NEW order each time, never "already imported"
        assert r["flagged"][0]["order_id"] == f"MK-S{n:04d}"
        assert client.get("/bank/security/status").json()["message_zh"] == "发现可疑内容，已暂停转账，查询不受影响"
        assert client.get("/bank/balance").status_code == 200  # reads stay open
        with Session(engine) as s:  # a human unlocks (the real path is PIN + co-signer); here we only need the lock off again
            c = s.get(BankCustomer, 1)
            c.locked, c.lock_reason = False, ""
            s.add(c)
            s.commit()
    assert len(_events(engine, "injection_flagged")) == 2


def test_locked_account_refuses_transfers_after_import(seeded):
    client, _ = seeded
    client.post("/bank/demo/orders/import-suspicious")
    r = client.post("/bank/transfers", json={"customer_id": 1, "payee_id": 1, "amount": 10, "purpose": "x"})
    assert r.status_code == 423


# ---------- payout and the tax pot ----------
def test_payout_moves_exactly_one_percent_when_the_rule_is_on(seeded):
    client, engine = seeded
    _rule(engine)
    r = client.post("/bank/demo/payouts", json={"amount": 8000}).json()
    assert r["moved"] == 80.0 and r["pot_total"] == 80.0
    assert r["balance_after"] - r["balance_before"] == 8000  # the earmark does not touch the balance
    assert round(r["available_after"] - r["available_before"], 2) == 7920.0


def test_rule_off_then_applied_to_that_payout_once(seeded):
    client, engine = seeded
    r = client.post("/bank/demo/payouts", json={"amount": 8000}).json()
    assert r["moved"] == 0 and r["pot_total"] == 0
    _rule(engine)  # the farmer approved the rule afterwards
    a = client.post(f"/bank/demo/payouts/{r['payout_id']}/apply-reserve-rules").json()
    assert a["moved"] == 80.0 and a["pot_total"] == 80.0
    assert client.post(f"/bank/demo/payouts/{r['payout_id']}/apply-reserve-rules").status_code == 409  # never twice


def test_own_produce_payout_moves_nothing(seeded):
    client, engine = seeded
    _rule(engine)
    r = client.post("/bank/demo/payouts", json={"amount": 8000, "income_class": "own_produce"}).json()
    assert r["moved"] == 0


# ---------- family confirmation ----------
def test_farmer_cannot_approve_a_cosign_request(client, world):
    ap, req = red_until_cosign(client)
    assert cosign_approve(client, req["id"], cosigner_id=1, pin="123456").status_code == 403  # his own id and PIN
    view = client.get(f"/bank/approvals/{ap['approval_id']}").json()
    assert view["next"] == "cosign" and view["approval_token"] is None  # still waiting for the daughter
    assert client.get("/cosign/pending", params={"cosigner_id": 1}).json() == []  # nothing is waiting for him to approve


# ---------- tax estimate ----------
def _orders(engine, resale_amount, own_amount=0.0, month=7):
    with Session(engine) as s:
        for o in s.exec(select(PlatformOrder).where(PlatformOrder.ts >= datetime(2026, 7, 1))).all():
            s.delete(o)
        s.add(PlatformOrder(id="T-RESALE", platform="marketplace", ts=datetime(2026, month, 3, 10), product="邻家蜂蜜 500g", qty=1,
                            amount=resale_amount, imported_at=datetime(2026, 7, 25)))
        if own_amount:
            s.add(PlatformOrder(id="T-OWN", platform="marketplace", ts=datetime(2026, month, 4, 10), product="自家蜂蜜 500g", qty=1,
                                amount=own_amount, imported_at=datetime(2026, 7, 25)))
        s.commit()


@pytest.mark.parametrize("resale, status", [(99_999.99, "below"), (100_000.0, "reached")])
def test_month_threshold_boundary(seeded, resale, status):
    client, engine = seeded
    _orders(engine, resale)
    r = client.post("/analysis/tax-estimate", json={}).json()
    assert r["vat_status"] == status  # exempt only strictly BELOW; reaching it taxes the whole amount
    assert r["vat"] == (0.0 if status == "below" else round(resale * 0.01, 2))


def test_quarter_threshold_and_citations(seeded):
    client, engine = seeded
    with Session(engine) as s:
        for o in s.exec(select(PlatformOrder).where(PlatformOrder.ts >= datetime(2026, 7, 1))).all():
            s.delete(o)
        for i, m in enumerate((7, 7, 7)):
            s.add(PlatformOrder(id=f"Q{i}", platform="marketplace", ts=datetime(2026, 7, 1 + i, 9), product="邻家蜂蜜 500g", qty=1,
                                amount=99_999.0, imported_at=datetime(2026, 7, 25)))
        s.commit()
    r = client.post("/analysis/tax-estimate", json={"period": "2026-Q3"}).json()
    assert r["vat_status"] == "reached" and r["vat"] == round(299_997 * 0.01, 2)  # July alone is over the month threshold
    assert {"vat_ann2026_no10_threshold", "eit_small_low_profit", "vat_law_art24_own_produce"} <= set(r["rule_ids"])
    assert set(r["rule_ids"]) <= set(r["rules"])
    assert r["footer_zh"] == FOOTER and r["structure_zh"] == "个人"


def test_own_produce_is_listed_apart_and_never_taxed(seeded):
    client, engine = seeded
    _orders(engine, 5_000.0, own_amount=20_000.0)
    r = client.post("/analysis/tax-estimate", json={}).json()
    assert (r["own_produce"], r["resale"]) == (20_000.0, 5_000.0)
    assert r["vat"] == 0.0 and r["income_tax_high"] == 250.0  # 5% of the resale margin only
    assert r["total_low"] == 0.0 and r["total_high"] == r["reserve_amount"] == 250.0
    assert "申报" not in "".join(r["assumptions"]) and "你应该" not in "".join(r["assumptions"])


def test_reserving_the_estimate_is_a_yellow_approval(seeded):
    client, _ = seeded
    r = client.post("/analysis/tax-estimate", json={}).json()
    res = client.post("/bank/reserves", json={"label": r["reserve_label"], "amount": r["reserve_amount"]})
    assert res.status_code == 202 and res.json()["tier"] == "yellow"  # needs read-back + confirm, nothing reserved yet
    assert client.get("/bank/balance").json()["reserved"] == 0
