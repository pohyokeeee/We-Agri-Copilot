from sqlmodel import Session, select

from app import trace
from app.audit import chain
from app.audit.router import mask
from app.models import AgentAudit
from tests.test_bank import enter_pin, pending_cosign

BODY = {"customer_id": 1, "payee_id": 1, "amount": 500, "purpose": "蜂蜜钱"}


def pay_yellow(client, headers=None):
    """Start -> confirm -> execute, sending a trace header only on the first call. Returns (trace_id, execute response)."""
    first = client.post("/bank/transfers", json=BODY, headers=headers or {})
    ap = first.json()
    tid = first.headers["x-trace-id"]
    token = client.post(f"/bank/approvals/{ap['approval_id']}/confirm").json()["approval_token"]
    return tid, client.post("/bank/transfers", json=BODY | {"approval_token": token})


def rows(engine):
    with Session(engine) as s:
        return [(r.id, r.prev_hash, r.hash, r.ts, r.actor, r.event, r.payload) for r in s.exec(select(AgentAudit).order_by(AgentAudit.id))]


def test_a_transfer_flow_is_one_ordered_trace_with_matching_hashes(client, world):
    tid, done = pay_yellow(client)  # the later calls carry no header: the approval carries the trace
    assert done.status_code == 200 and done.headers["x-trace-id"] == tid
    t = client.get(f"/trace/{tid}").json()
    assert [x["event"] for x in t["steps"]] == ["approval_requested", "confirmed", "transfer_executed"]
    assert [x["seq"] for x in t["steps"]] == [1, 2, 3] and t["status"] == "已完成" and "转账 500 元" in t["summary_zh"]
    assert [x["endpoint"] for x in t["steps"]] == ["POST /bank/transfers", "POST /bank/approvals/1/confirm", "POST /bank/transfers"]
    first, _, last = t["steps"]
    assert (first["tier_base"], first["tier_final"], first["approval"]) == ("yellow", "yellow", {"method": "none", "result": "pending"})
    assert (last["tier_base"], last["tier_final"], last["approval"]) == ("yellow", "yellow", {"method": "confirm", "result": "executed"})
    assert (last["balance_before"], last["balance_after"]) == (10_000, 9_500) and last["detail"]["amount"] == 500

    db = {r[0]: r for r in rows(world)}
    for prev, step in zip([None, *t["steps"]], t["steps"]):
        _, prev_hash, hash_, ts, actor, event, payload = db[step["row_id"]]
        assert (step["prev_hash"], step["hash"]) == (prev_hash, hash_)
        assert chain._digest(prev_hash, ts, actor, event, payload) == step["hash"]  # the hash really covers this row
        assert payload["trace_id"] == tid  # stored in the audit row itself
        if prev:
            assert step["prev_hash"] == prev["hash"]  # nothing else happened in between: the steps chain directly
    verify = client.get("/audit/verify").json()
    assert verify == {"ok": True, "rows_checked": len(db), "first_broken_id": None}


def test_recent_lists_traces_newest_first_with_status_and_limit(seeded):
    client, _ = seeded
    ids = []
    for h in ("trace-aaaa-0001", "trace-bbbb-0002", "trace-cccc-0003"):
        ids.append(client.post("/analysis/policy-match", json={}, headers={"X-Trace-Id": h}).headers["x-trace-id"])
    assert ids == ["trace-aaaa-0001", "trace-bbbb-0002", "trace-cccc-0003"]
    r = client.get("/trace/recent", params={"limit": 2}).json()
    assert [x["trace_id"] for x in r] == ["trace-cccc-0003", "trace-bbbb-0002"]
    assert r[0]["status"] == "已完成" and r[0]["summary_zh"] == "补贴匹配" and r[0]["steps"] == 1 and r[0]["endpoint"] == "POST /analysis/policy-match"
    assert client.get("/trace/recent", params={"limit": 0}).status_code == 422
    assert client.get("/trace/does-not-exist").status_code == 404


def test_client_trace_header_is_used_but_only_if_well_formed(client):
    ok = client.post("/bank/transfers", json=BODY, headers={"X-Trace-Id": "demo-trace-0001"})
    assert ok.headers["x-trace-id"] == "demo-trace-0001"
    bad = client.post("/bank/transfers", json=BODY, headers={"X-Trace-Id": "bad id; drop table"})
    assert bad.headers["x-trace-id"] != "bad id; drop table" and len(bad.headers["x-trace-id"]) == 16  # untrusted: replaced


def test_cosigner_on_another_phone_joins_the_same_trace(client):
    first = client.post("/bank/transfers", json=BODY | {"payee_id": 2, "amount": 100})
    tid, ap = first.headers["x-trace-id"], first.json()
    client.post(f"/bank/approvals/{ap['approval_id']}/confirm")
    enter_pin(client, ap)
    (req,) = pending_cosign(client)
    other = {"X-Trace-Id": "daughters-phone-0001"}  # the daughter's client knows nothing about this trace
    approved = client.post(f"/cosign/{req['id']}/approve", json={"cosigner_id": 2, "pin": "654321"}, headers=other)
    assert approved.headers["x-trace-id"] == tid
    token = client.get(f"/bank/approvals/{ap['approval_id']}", headers=other).json()["approval_token"]
    done = client.post("/bank/transfers", json=BODY | {"payee_id": 2, "amount": 100, "approval_token": token}, headers=other)
    assert done.status_code == 200 and done.headers["x-trace-id"] == tid
    t = client.get(f"/trace/{tid}").json()
    assert [x["event"] for x in t["steps"]] == ["approval_requested", "confirmed", "pin_verified", "cosign_requested", "cosign_approved",
                                                "transfer_executed"]
    executed = t["steps"][-1]
    assert (executed["tier_base"], executed["tier_final"], executed["approval"]["method"]) == ("red", "red", "confirm+pin+cosign")
    assert "新的收款人" in executed["reasons_zh"] and t["status"] == "已完成"
    assert client.get("/trace/daughters-phone-0001").status_code == 404  # no second, orphan trace


def test_a_refused_token_is_part_of_the_trace(client):
    first = client.post("/bank/transfers", json=BODY)
    tid, ap = first.headers["x-trace-id"], first.json()
    token = client.post(f"/bank/approvals/{ap['approval_id']}/confirm").json()["approval_token"]
    assert client.post("/bank/transfers", json=BODY | {"amount": 501, "approval_token": token}).status_code == 403
    t = client.get(f"/trace/{tid}").json()
    refused = next(x for x in t["steps"] if x["event"] == "token_rejected")
    assert refused["approval"]["result"].startswith("rejected") and "differs" in refused["approval"]["result"]


def test_wording_check_result_is_recorded_on_analysis_steps(seeded):
    client, _ = seeded
    tid = client.post("/analysis/compliance", json={}).headers["x-trace-id"]
    step = client.get(f"/trace/{tid}").json()["steps"][0]
    assert step["event"] == "compliance_checked" and step["wording_check"].startswith("pass")


def test_account_numbers_are_masked(client, world):
    trace.begin("mask-test-0001", "TEST /mask")
    try:
        with Session(world) as s:
            chain.append(s, "test", "locked", {"customer_id": 1, "account_no": "6222020200112233445", "note": "call 13800000001 now",
                                               "nested": {"card": "1234567890123456"}})
            s.commit()
    finally:
        trace._ctx.set(None)  # do not leak this trace into other tests
    detail = client.get("/trace/mask-test-0001").json()["steps"][0]["detail"]
    assert detail["account_no"] == "***************3445" and detail["note"] == "call *******0001 now"
    assert detail["nested"]["card"] == "************3456"
    assert mask("short 1234567") == "short 1234567"  # under 8 digits is left alone


def test_tampering_a_row_breaks_the_audit_verify(client, world):
    tid, _ = pay_yellow(client)
    ok = client.get("/audit/verify").json()
    assert ok["ok"] is True and ok["rows_checked"] == len(rows(world))
    victim = client.get(f"/trace/{tid}").json()["steps"][1]  # the "confirmed" step
    with Session(world) as s:
        row = s.get(AgentAudit, victim["row_id"])
        row.payload = {**row.payload, "result": "approved by someone else"}
        s.add(row)
        s.commit()
    bad = client.get("/audit/verify").json()
    assert bad["ok"] is False and bad["first_broken_id"] == victim["row_id"]
    assert bad["rows_checked"] == [r[0] for r in rows(world)].index(victim["row_id"]) + 1  # it stopped at the first bad row
