from pathlib import Path

from sqlmodel import Session, select

from app.audit.chain import verify_chain
from app.models import AgentAudit, BankCustomer

SEED_DIR = Path(__file__).parents[1] / "seed"


def approve(client, approval, pin="123456"):
    """Run challenge -> verify for an approval; returns the verify response."""
    ch = client.post("/bank/auth/mfa/challenge", json={"approval_id": approval["approval_id"]}).json()
    return client.post("/bank/auth/mfa/verify", json={**ch, "pin": pin})


def test_green_blocked_then_approved_then_executed(client, world):
    body = {"customer_id": 1, "payee_id": 1, "amount": 500}
    r = client.post("/bank/transfers", json=body)
    assert r.status_code == 202 and r.json()["tier"] == "yellow" and not r.json()["requires_cosigner"]
    assert client.get("/bank/balance").json()["balance"] == 10_000  # nothing moved yet

    v = approve(client, r.json())
    assert v.status_code == 200 and v.json()["status"] == "approved"
    token = v.json()["approval_token"]

    # token is bound to the exact request
    assert client.post("/bank/transfers", json={**body, "amount": 501, "approval_token": token}).status_code == 403
    ok = client.post("/bank/transfers", json={**body, "approval_token": token})
    assert ok.status_code == 200
    assert (ok.json()["balance_before"], ok.json()["balance_after"]) == (10_000, 9_500)
    assert client.post("/bank/transfers", json={**body, "approval_token": token}).status_code == 403  # single use

    with Session(world) as s:
        row = [a for a in s.exec(select(AgentAudit)) if a.event == "transfer_executed"][0]
        assert (row.payload["balance_before"], row.payload["balance_after"]) == (10_000, 9_500)
        assert verify_chain(s) == (True, None)


def test_new_payee_is_red_and_needs_cosigner(client):
    r = client.post("/bank/transfers", json={"customer_id": 1, "payee_id": 2, "amount": 100})
    assert r.status_code == 202 and r.json()["tier"] == "red" and r.json()["requires_cosigner"]
    v = approve(client, r.json())
    assert v.json()["status"] == "pending" and v.json()["approval_token"] is None  # PIN alone is not enough

    pend = client.get("/bank/approvals", params={"cosigner_id": 2}).json()
    assert [p["approval_id"] for p in pend] == [r.json()["approval_id"]]
    bad = client.post(f"/bank/approvals/{pend[0]['approval_id']}/cosign", json={"cosigner_id": 1, "pin": "123456"})
    assert bad.status_code == 403  # Wang cannot co-sign for himself
    c = client.post(f"/bank/approvals/{pend[0]['approval_id']}/cosign", json={"cosigner_id": 2, "pin": "654321"})
    assert c.json()["status"] == "approved"
    done = client.post("/bank/transfers", json={"customer_id": 1, "payee_id": 2, "amount": 100,
                                                "approval_token": c.json()["approval_token"]})
    assert done.status_code == 200 and done.json()["balance_after"] == 9_900


def test_cosigner_decline_blocks(client):
    r = client.post("/bank/transfers", json={"customer_id": 1, "payee_id": 2, "amount": 100}).json()
    approve(client, r)
    c = client.post(f"/bank/approvals/{r['approval_id']}/cosign", json={"cosigner_id": 2, "pin": "654321", "approve": False})
    assert c.json()["status"] == "declined" and c.json()["approval_token"] is None


def test_lock_after_three_bad_pins_reads_still_work(client):
    r = client.post("/bank/transfers", json={"customer_id": 1, "payee_id": 1, "amount": 100}).json()
    assert [approve(client, r, "000000").status_code for _ in range(3)] == [401, 401, 423]
    assert client.get("/bank/balance").status_code == 200
    assert client.get("/bank/transactions").status_code == 200
    assert client.post("/bank/transfers", json={"customer_id": 1, "payee_id": 1, "amount": 100}).status_code == 423
    assert approve(client, r).status_code == 423  # even the right PIN is refused now


def test_unlock_needs_cosigner(client, world):
    client.post("/bank/security/lock", json={"customer_id": 1})
    r = client.post("/bank/security/unlock", json={"customer_id": 1})
    assert r.status_code == 202 and r.json()["tier"] == "red" and r.json()["requires_cosigner"]
    c = client.post(f"/bank/approvals/{r.json()['approval_id']}/cosign", json={"cosigner_id": 2, "pin": "654321"})
    assert client.post("/bank/security/unlock", json={"customer_id": 1, "approval_token": c.json()["approval_token"]}).status_code == 200
    with Session(world) as s:
        assert not s.get(BankCustomer, 1).locked


def test_reserve_reduces_available_and_release_restores(client):
    r = client.post("/bank/reserves", json={"customer_id": 1, "label": "honey season", "amount": 2000}).json()
    tok = approve(client, r).json()["approval_token"]
    made = client.post("/bank/reserves", json={"customer_id": 1, "label": "honey season", "amount": 2000, "approval_token": tok})
    assert made.status_code == 200
    assert client.get("/bank/balance").json()["available"] == 8_000
    assert client.delete(f"/bank/reserves/{made.json()['reserve_id']}").status_code == 200
    assert client.get("/bank/balance").json()["available"] == 10_000


def test_payee_fuzzy_search(client):
    assert [p["name"] for p in client.get("/bank/payees", params={"q": "老李"}).json()] == ["李国强"]
    assert client.get("/bank/payees", params={"q": "李国"}).json()[0]["known"] is True


def test_orders_import_idempotent_and_note_stays_data(client):
    csv_text = (SEED_DIR / "orders" / "livestream_sample.csv").read_text(encoding="utf-8")
    first = client.post("/bank/orders/import", params={"platform": "livestream"}, json={"csv": csv_text}).json()
    assert first["new"] == 12
    again = client.post("/bank/orders/import", params={"platform": "livestream"}, json={"csv": csv_text}).json()
    assert (again["new"], again["skipped"]) == (0, 12)
    assert client.get("/bank/balance").json()["balance"] == 10_000  # the injected "transfer 5000" note did nothing
    assert client.post("/bank/orders/import", params={"platform": "marketplace"}, json={"csv": csv_text}).status_code == 422
