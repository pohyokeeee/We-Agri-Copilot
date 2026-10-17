from datetime import timedelta
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app import clock
from app.audit.chain import verify_chain
from app.mockbank.numerals import amount_zh
from app.models import AgentAudit, BankApproval, BankCustomer
from tests.conftest import NOON

SEED_DIR = Path(__file__).parents[1] / "seed"


# ---------- helpers: each is one step of the real flow ----------
def start(client, payee_id, amount, purpose="蜂蜜钱", token=None):
    body = {"customer_id": 1, "payee_id": payee_id, "amount": amount, "purpose": purpose}
    return client.post("/bank/transfers", json=body | ({"approval_token": token} if token else {}))


def confirm(client, ap):
    return client.post(f"/bank/approvals/{ap['approval_id']}/confirm")


def enter_pin(client, ap, pin="123456"):
    ch = client.post("/bank/auth/mfa/challenge", json={"approval_id": ap["approval_id"]}).json()
    return client.post("/bank/auth/mfa/verify", json={**ch, "pin": pin})


def cosign_approve(client, request_id, cosigner_id=2, pin="654321"):
    return client.post(f"/cosign/{request_id}/approve", json={"cosigner_id": cosigner_id, "pin": pin})


def pending_cosign(client):
    return client.get("/cosign/pending", params={"cosigner_id": 2}).json()


def pay_yellow(client, payee_id, amount, purpose="蜂蜜钱"):
    ap = start(client, payee_id, amount, purpose).json()
    assert ap["tier"] == "yellow", ap
    tok = confirm(client, ap).json()["approval_token"]
    return start(client, payee_id, amount, purpose, tok)


def red_until_cosign(client, amount=100):
    """New payee 2: confirm -> PIN -> co-sign request waiting. Returns (approval, cosign request)."""
    ap = start(client, 2, amount).json()
    assert ap["tier"] == "red" and ap["requires_cosigner"] and ap["next"] == "confirm"
    assert confirm(client, ap).json()["next"] == "pin"
    after_pin = enter_pin(client, ap).json()
    assert after_pin["next"] == "cosign" and after_pin["approval_token"] is None
    (req,) = pending_cosign(client)
    return ap, req


def balance(client):
    return client.get("/bank/balance").json()["balance"]


def audits(engine, event):
    with Session(engine) as s:
        return [a.payload for a in s.exec(select(AgentAudit)) if a.event == event]


# ---------- tiers and the approval flow ----------
def test_yellow_confirm_path_is_audited(client, world):
    ap = start(client, 1, 500).json()
    assert (ap["tier"], ap["tier_base"], ap["next"], ap["requires_pin"], ap["requires_cosigner"]) == ("yellow", "yellow", "confirm", False, False)
    assert balance(client) == 10_000  # nothing moves before approval
    ok = confirm(client, ap).json()
    assert ok["status"] == "approved" and ok["approval_token"]  # yellow: a confirm is enough, no PIN
    done = start(client, 1, 500, token=ok["approval_token"])
    assert done.status_code == 200
    assert (done.json()["balance_before"], done.json()["balance_after"]) == (10_000, 9_500)

    executed = audits(world, "transfer_executed")[0]
    assert (executed["tier_base"], executed["tier_final"], executed["method"], executed["result"]) == ("yellow", "yellow", "confirm", "executed")
    assert (executed["balance_before"], executed["balance_after"]) == (10_000, 9_500)
    for event in ("approval_requested", "confirmed", "transfer_executed"):  # every step carries the full record
        row = audits(world, event)[0]
        assert {"tier_base", "tier_final", "reasons", "method", "result", "balance_before", "balance_after"} <= set(row)
    with Session(world) as s:
        assert verify_chain(s) == (True, None)


def test_daily_cumulative_crossing_1000_becomes_red(client):
    assert pay_yellow(client, 1, 600).status_code == 200  # 600 today: still yellow
    ap = start(client, 1, 500).json()  # 600 + 500 = 1,100 > 1,000
    assert (ap["tier_base"], ap["tier"]) == ("red", "red")
    assert any("daily total" in r for r in ap["reasons"]) and ap["requires_pin"]


def test_new_payee_red_needs_pin_and_cosigner(client, world):
    ap, req = red_until_cosign(client)
    assert "新的收款人" in req["reasons_zh"] and "新人" in req["summary_zh"] and "100" in req["summary_zh"] and "一百元" in req["summary_zh"]
    assert start(client, 2, 100).json()["status"] == "pending"  # without a token it only asks again, nothing executes
    assert cosign_approve(client, req["id"], cosigner_id=1, pin="123456").status_code == 403  # Wang cannot co-sign for himself
    assert cosign_approve(client, req["id"], pin="000000").status_code == 401  # wrong co-signer PIN does nothing
    assert cosign_approve(client, req["id"]).json()["status"] == "approved"
    granted = client.get(f"/bank/approvals/{ap['approval_id']}").json()
    assert granted["status"] == "approved" and granted["approval_token"]
    done = start(client, 2, 100, token=granted["approval_token"])
    assert done.status_code == 200 and done.json()["balance_after"] == 9_900
    executed = audits(world, "transfer_executed")[0]
    assert (executed["tier_base"], executed["tier_final"], executed["method"]) == ("red", "red", "confirm+pin+cosign")
    assert "new payee" in executed["reasons"]
    for event in ("pin_verified", "cosign_requested", "cosign_approved"):
        assert audits(world, event)[0]["result"] in ("ok", "pending", "approved")


def test_token_cannot_be_reused(client, world):
    ap = start(client, 1, 500).json()
    tok = confirm(client, ap).json()["approval_token"]
    assert start(client, 1, 500, token=tok).status_code == 200
    again = start(client, 1, 500, token=tok)
    assert again.status_code == 403 and "already used" in again.json()["detail"]
    assert balance(client) == 9_500  # paid once only
    assert "rejected" in audits(world, "token_rejected")[0]["result"]  # the refusal is on the record too


def test_tampered_request_is_rejected(client):
    ap = start(client, 1, 500, purpose="蜂蜜钱").json()
    tok = confirm(client, ap).json()["approval_token"]
    assert start(client, 1, 501, "蜂蜜钱", tok).status_code == 403  # amount changed
    assert start(client, 1, 500, "别的用途", tok).status_code == 403  # purpose changed
    assert start(client, 2, 500, "蜂蜜钱", tok).status_code == 403  # payee changed
    assert balance(client) == 10_000
    assert start(client, 1, 500, "蜂蜜钱", tok).status_code == 200  # the exact request still works: rejections do not spend it


def test_token_expires_after_five_minutes(client, monkeypatch):
    ap = start(client, 1, 500).json()
    tok = confirm(client, ap).json()["approval_token"]
    monkeypatch.setattr(clock, "now", lambda: NOON + timedelta(minutes=5, seconds=1))
    late = start(client, 1, 500, token=tok)
    assert late.status_code == 403 and "expired" in late.json()["detail"]
    assert balance(client) == 10_000


def test_cosigner_decline_executes_nothing(client, world):
    ap, req = red_until_cosign(client)
    assert client.post(f"/cosign/{req['id']}/decline", json={"cosigner_id": 2}).json()["status"] == "declined"
    after = client.get(f"/bank/approvals/{ap['approval_id']}").json()
    assert after["status"] == "declined" and after["approval_token"] is None
    assert pending_cosign(client) == [] and balance(client) == 10_000
    assert cosign_approve(client, req["id"]).status_code == 409  # a declined request cannot be approved afterwards
    assert audits(world, "cosign_declined")[0]["result"] == "declined"


def test_unanswered_cosign_request_times_out(client, world, monkeypatch):
    ap, req = red_until_cosign(client)
    assert 0 < req["seconds_left"] <= 300
    monkeypatch.setattr(clock, "now", lambda: NOON + timedelta(minutes=5, seconds=1))
    assert client.get(f"/bank/approvals/{ap['approval_id']}").json()["status"] == "expired"
    assert pending_cosign(client) == [] and cosign_approve(client, req["id"]).status_code == 409
    assert balance(client) == 10_000
    assert audits(world, "cosign_expired")[0]["result"] == "expired"


def test_customer_can_cancel_midway(client):
    ap, req = red_until_cosign(client)
    assert client.post(f"/bank/approvals/{ap['approval_id']}/cancel").json()["status"] == "declined"
    assert pending_cosign(client) == [] and balance(client) == 10_000


def test_pin_only_asked_after_confirm_and_only_for_red(client):
    red = start(client, 2, 100).json()
    assert client.post("/bank/auth/mfa/challenge", json={"approval_id": red["approval_id"]}).status_code == 409  # not confirmed yet
    yellow = start(client, 1, 500).json()
    confirm(client, yellow)
    assert client.post("/bank/auth/mfa/challenge", json={"approval_id": yellow["approval_id"]}).status_code == 409  # yellow has no PIN


def test_three_bad_pins_lock_yellow_and_red_but_reads_still_work(client):
    red = start(client, 2, 100).json()
    confirm(client, red)
    assert [enter_pin(client, red, "000000").status_code for _ in range(3)] == [401, 401, 423]
    assert client.get("/bank/balance").status_code == 200 and client.get("/bank/transactions").status_code == 200
    assert client.get("/bank/payees", params={"q": "老李"}).status_code == 200
    assert start(client, 1, 500).status_code == 423  # a new yellow transfer
    assert start(client, 2, 100).status_code == 423  # a new red transfer
    assert confirm(client, red).status_code == 423  # even finishing the old one
    assert enter_pin(client, red).status_code == 423  # and the right PIN is refused now


def test_unlock_needs_cosigner(client, world):
    client.post("/bank/security/lock", json={"customer_id": 1})
    r = client.post("/bank/security/unlock", json={"customer_id": 1})
    assert r.status_code == 202 and r.json()["tier"] == "red" and r.json()["requires_cosigner"]
    (req,) = pending_cosign(client)
    assert "安全锁" in req["summary_zh"]
    approved = cosign_approve(client, req["id"])
    assert approved.status_code == 200
    token = client.get(f"/bank/approvals/{r.json()['approval_id']}").json()["approval_token"]
    assert client.post("/bank/security/unlock", json={"customer_id": 1, "approval_token": token}).status_code == 200
    with Session(world) as s:
        assert not s.get(BankCustomer, 1).locked


def test_reserve_reduces_available_and_release_restores(client):
    r = client.post("/bank/reserves", json={"customer_id": 1, "label": "honey season", "amount": 2000}).json()
    tok = confirm(client, r).json()["approval_token"]
    made = client.post("/bank/reserves", json={"customer_id": 1, "label": "honey season", "amount": 2000, "approval_token": tok})
    assert made.status_code == 200
    assert client.get("/bank/balance").json()["available"] == 8_000
    assert client.delete(f"/bank/reserves/{made.json()['reserve_id']}").status_code == 200
    assert client.get("/bank/balance").json()["available"] == 10_000


def test_approval_rows_hold_a_hash_of_the_request(client, world):
    ap = start(client, 1, 500).json()
    with Session(world) as s:
        row = s.get(BankApproval, ap["approval_id"])
        assert len(row.action_hash) == 64 and row.payload == {"payee_id": 1, "amount": 500.0, "purpose": "蜂蜜钱"}


# ---------- payees, read-back, numerals ----------
def test_payee_fuzzy_search(client):
    assert [p["name"] for p in client.get("/bank/payees", params={"q": "老李"}).json()] == ["李国强"]
    assert client.get("/bank/payees", params={"q": "李国"}).json()[0]["known"] is True
    assert client.get("/bank/payees", params={"q": "没有这个人"}).json() == []  # zero candidates


def test_several_candidates_come_back_together(seeded):
    client, _ = seeded
    found = [p["name"] for p in client.get("/bank/payees", params={"q": "老"}).json()]
    assert {"李国强", "赵三"} <= set(found) and len(found) >= 2  # the client must ask which one, never pick
    assert [p["name"] for p in client.get("/bank/payees", params={"q": "老李"}).json()] == ["李国强"]  # exact hit, no look-alike 老赵
    assert {"李国强", "赵三"} <= {p["name"] for p in client.get("/bank/payees", params={"q": "老理"}).json()}  # no exact hit: fuzzy, several


def test_readback_is_a_template_with_digits_and_numerals(client):
    body = {"customer_id": 1, "payee_id": 1, "amount": 800, "purpose": "蜂蜜钱", "spoken_as": "老李"}
    assert client.post("/bank/transfers/readback", json=body).json()["text_zh"] == "给老李（李国强）转 800 元（八百元），蜂蜜钱，对吗？"
    plain = client.post("/bank/transfers/readback", json=body | {"spoken_as": None, "amount": 4250}).json()["text_zh"]
    assert plain == "给李国强转 4,250 元（四千二百五十元），蜂蜜钱，对吗？"


@pytest.mark.parametrize("x,zh", [(800, "八百元"), (4250, "四千二百五十元"), (10050, "一万零五十元"), (12.5, "十二元五角"),
                                  (100000, "十万元"), (2005, "二千零五元"), (1000, "一千元"), (0.05, "零元零五分"), (100005, "十万零五元")])
def test_chinese_numerals(x, zh):
    assert amount_zh(x) == zh


# ---------- the plan: "like last year" ----------
def test_plan_like_last_year_flags_new_supplier(seeded):
    client, engine = seeded
    before = balance(client)
    plan = client.post("/bank/transfers/plan", json={"customer_id": 1}).json()
    assert plan["executed"] is False and len(plan["items"]) == 6
    assert (plan["window_start"], plan["window_end"]) == ("2026-08-01", "2026-09-30")
    for item in plan["items"]:
        assert item["tier"] == "red" and item["amount"] > 1000 and item["times"] == 2 and item["payee_id"]
        assert ("new payee" in item["reasons"]) == (item["name"] == "周小军")  # only the supplier first paid within the year
    new = next(i for i in plan["items"] if i["name"] == "周小军")
    assert "新的收款人" in new["reasons_zh"] and new["tier_base"] == "red"
    assert plan["total"] == pytest.approx(sum(i["amount"] * i["times"] for i in plan["items"]))
    assert balance(client) == before  # nothing executed, nothing created
    with Session(engine) as s:
        assert not s.exec(select(BankApproval)).all()
    row = audits(engine, "transfer_plan")[0]
    assert row["result"].startswith("planned") and len(row["items"]) == 6 and "balance_before" in row


def test_plan_unknown_category_404(seeded):
    client, _ = seeded
    assert client.post("/bank/transfers/plan", json={"category": "nothing"}).status_code == 404


# ---------- order import (unchanged behaviour) ----------
def test_orders_import_idempotent_and_note_stays_data(client):
    csv_text = (SEED_DIR / "orders" / "livestream_sample.csv").read_text(encoding="utf-8")
    first = client.post("/bank/orders/import", params={"platform": "livestream"}, json={"csv": csv_text}).json()
    assert first["new"] == 12
    again = client.post("/bank/orders/import", params={"platform": "livestream"}, json={"csv": csv_text}).json()
    assert (again["new"], again["skipped"]) == (0, 12)
    assert client.get("/bank/balance").json()["balance"] == 10_000  # the injected "transfer 5000" note did nothing
    assert client.post("/bank/orders/import", params={"platform": "marketplace"}, json={"csv": csv_text}).status_code == 422
