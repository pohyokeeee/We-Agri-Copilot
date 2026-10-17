"""Agent chain tests. They double as evidence runs: S6 up to the first interrupt, pause/resume, partial and full rollback,
handover, and a refused or tampered plan. The planner is the deterministic mock; every decision below is the code's."""
import pytest
from sqlmodel import Session, select

from app.agent import executor, planner_mock, tools
from app.agent.dag import Dag, DagNode
from app.audit.chain import verify_chain
from app.mockbank.service import reserved_total
from app.models import (
    AgentAudit, AgentHandover, AgentPlan, BankAccount, BankApproval, BankReserve, BankSchedule, BankTxn, FinancingApplication,
)
from tests.test_bank import cosign_approve, enter_pin, pending_cosign

S6 = "下个月要收蜂蜜了，帮我准备一下"


# ---------- helpers ----------
def say(client, text, sid="s1"):
    return client.post("/agent/message", json={"session_id": sid, "text": text})


def cmd(client, name, sid="s1"):
    return client.post("/agent/command", json={"session_id": sid, "command": name})


def token_for(client, approval):
    """Take a bank approval to the point where it holds a token: confirm, then PIN and co-signer if the bank asks."""
    aid = approval["approval_id"]
    v = client.post(f"/bank/approvals/{aid}/confirm").json()
    if v["next"] == "pin":
        v = enter_pin(client, v).json()
    if v["next"] == "cosign":
        (req,) = [r for r in pending_cosign(client) if r["approval_id"] == aid]
        assert cosign_approve(client, req["id"]).status_code == 200
        v = client.get(f"/bank/approvals/{aid}").json()
    assert v["next"] == "ready", v
    return v["approval_token"]


def approve_pending(client, view, sid="s1"):
    p = view["pending"]
    return client.post("/agent/approve", json={"session_id": sid, "node_id": p["node_id"], "token": token_for(client, p["approval"])})


def run_to(client, node_id, sid="s1"):
    """Start S6 and approve steps until `node_id` is the one waiting."""
    v = say(client, S6, sid).json()
    while v["pending"]["node_id"] != node_id:
        r = approve_pending(client, v, sid)
        assert r.status_code == 200, r.text
        v = r.json()
    return v


def statuses(view):
    return {n["id"]: n["status"] for n in view["nodes"]}


def snapshot(engine):
    """The effective state of the bank: money, earmarks, live schedules and applications."""
    with Session(engine) as s:
        return {
            "balance": s.get(BankAccount, 1).balance, "reserved": reserved_total(s, 1),
            "active_reserves": len(s.exec(select(BankReserve).where(BankReserve.status == "active")).all()),
            "scheduled": len(s.exec(select(BankSchedule).where(BankSchedule.status == "scheduled")).all()),
            "live_applications": len(s.exec(select(FinancingApplication).where(FinancingApplication.status != "withdrawn")).all()),
            "txns": len(s.exec(select(BankTxn)).all()),
        }


# ---------- S6 up to the first interrupt ----------
def test_s6_runs_the_green_steps_then_stops_for_the_reserve(seeded):
    client, engine = seeded
    start = snapshot(engine)
    r = say(client, S6)
    v = r.json()
    assert r.status_code == 200 and v["status"] == "waiting" and v["utterance"] == S6
    assert statuses(v) == {"N1": "done", "N2": "done", "N3": "done", "N4": "waiting", "N5a": "pending", "N5b": "pending", "N6": "pending"}
    assert [n["marker"] for n in v["nodes"][:3]] == ["🟢"] * 3  # analysis is green
    assert "合规" in v["nodes"][0]["summary_zh"] and "补贴" in v["nodes"][1]["summary_zh"] and "预测" in v["nodes"][2]["summary_zh"]

    p = v["pending"]
    assert p["node_id"] == "N4" and "预留" in p["readback_zh"] and "元" in p["readback_zh"]
    live = client.get(f"/bank/approvals/{p['approval']['approval_id']}").json()
    assert live["action"] == "reserve" and p["approval"]["tier"] == live["tier"] == v["nodes"][3]["tier"]  # the tier is the engine's
    assert live["tier"] in ("yellow", "red") and live["next"] == "confirm"
    assert snapshot(engine) == start  # nothing moved: it is only asking

    # the amount was not in the plan: it is the forecast's reserve, read at run time
    with Session(engine) as s:
        plan = s.get(AgentPlan, v["plan_id"])
        n4 = next(n for n in plan.dag_json["dag"]["nodes"] if n["id"] == "N4")
        assert n4["args"]["amount"] == {"$ref": "N3.reserve_amount"} and plan.state["nodes"]["N4"]["body"]["amount"] > 0
        assert plan.state["nodes"]["N4"]["body"]["amount"] == plan.state["nodes"]["N3"]["result"]["reserve_amount"]


def test_the_whole_chain_runs_through_every_approval(seeded):
    client, engine = seeded
    start = snapshot(engine)
    v = say(client, S6).json()
    order = []
    while v["pending"]:
        order.append(v["pending"]["node_id"])
        v = approve_pending(client, v).json()
    assert order == ["N4", "N5a", "N5b", "N6"] and v["status"] == "done" and set(statuses(v).values()) == {"done"}
    now = snapshot(engine)
    assert now["active_reserves"] == 1 and now["live_applications"] == 1 and now["scheduled"] == 12  # 6 suppliers x 2 deliveries
    assert now["balance"] == start["balance"] and now["txns"] == start["txns"]  # an earmark and schedules: no money has moved
    with Session(engine) as s:
        assert s.exec(select(FinancingApplication)).one().status == "submitted"
        assert verify_chain(s) == (True, None)
    # every step, bank and agent, is in the one trace; the utterance and the DAG are on the first step
    t = client.get(f"/trace/{v['trace_id']}").json()
    events = [x["event"] for x in t["steps"]]
    assert events[0] == "agent_plan_created" and t["utterance"] == S6 and len(t["dag"]["nodes"]) == 7
    assert {"agent_node_waiting", "agent_node_done", "reserve_created", "application_drafted", "application_submitted",
            "schedules_created", "cosign_approved", "agent_plan_done"} <= set(events)
    assert t["status"] == "已完成"


# ---------- pause and resume ----------
def test_pause_blocks_approval_and_resume_continues(seeded):
    client, engine = seeded
    v = say(client, S6).json()
    token = token_for(client, v["pending"]["approval"])
    paused = cmd(client, "等一下").json()
    assert paused["status"] == "paused" and paused["paused"] is True
    blocked = client.post("/agent/approve", json={"session_id": "s1", "node_id": "N4", "token": token})
    assert blocked.status_code == 409 and "暂停" in blocked.json()["detail"]
    assert snapshot(engine)["active_reserves"] == 0  # the token was not spent
    back = cmd(client, "继续").json()
    assert back["status"] == "waiting" and back["pending"]["node_id"] == "N4"
    done = client.post("/agent/approve", json={"session_id": "s1", "node_id": "N4", "token": token}).json()
    assert statuses(done)["N4"] == "done" and done["pending"]["node_id"] == "N5a" and snapshot(engine)["active_reserves"] == 1


def test_wrong_node_or_token_changes_nothing(seeded):
    client, engine = seeded
    v = say(client, S6).json()
    bogus = client.post("/agent/approve", json={"session_id": "s1", "node_id": "N4", "token": "made-up-token"})
    assert bogus.status_code == 403
    assert client.post("/agent/approve", json={"session_id": "s1", "node_id": "N6", "token": "x"}).status_code == 409  # not the step it waits for
    assert statuses(client.get("/agent/session/s1").json())["N4"] == "waiting" and snapshot(engine)["active_reserves"] == 0
    with Session(engine) as s:
        assert any(a.event == "token_rejected" for a in s.exec(select(AgentAudit)))
    assert v["status"] == "waiting"


# ---------- rollback ----------
def test_loan_no_thanks_undoes_only_the_financing_branch(seeded):
    client, engine = seeded
    start = snapshot(engine)
    v = run_to(client, "N5b")  # reserve done, draft done, waiting to send the application
    mid = snapshot(engine)
    assert mid["active_reserves"] == 1 and mid["live_applications"] == 1
    r = cmd(client, "贷款先不要").json()
    assert statuses(r) == {"N1": "done", "N2": "done", "N3": "done", "N4": "done", "N5a": "undone", "N5b": "dropped", "N6": "waiting"}
    assert r["pending"]["node_id"] == "N6" and "预留的钱还在" in r["notice_zh"]  # the plan moved on to the payments
    now = snapshot(engine)
    assert now["live_applications"] == 0 and now["active_reserves"] == 1 and now["reserved"] == mid["reserved"]  # the reserve stays
    assert now["balance"] == start["balance"] and now["txns"] == start["txns"]
    # the approval that was waiting for the dropped step cannot be used any more
    with Session(engine) as s:
        assert {a.action: a.status for a in s.exec(select(BankApproval))}["financing_submit"] == "declined"
    assert v["status"] == "waiting"


def test_loan_no_thanks_before_the_financing_started(seeded):
    client, engine = seeded
    say(client, S6)
    r = cmd(client, "贷款先不要").json()
    assert statuses(r)["N5a"] == statuses(r)["N5b"] == "dropped" and r["pending"]["node_id"] == "N4"
    v = r
    while v["pending"]:  # the rest still works without the loan
        v = approve_pending(client, v).json()
    assert v["status"] == "done" and statuses(v)["N6"] == "done" and snapshot(engine)["live_applications"] == 0


def test_financing_branch_is_what_depends_only_on_financing():
    dag = planner_mock.prepare_for_honey()
    assert executor._financing_branch(dag) == {"N5a", "N5b"}  # N6 also needs N4, so it stays
    nodes = [*dag.nodes, DagNode(id="N7", tool="check_compliance", depends_on=["N5b"])]
    assert executor._financing_branch(Dag(nodes=nodes)) == {"N5a", "N5b", "N7"}  # N7 needs nothing else


def test_never_mind_restores_the_starting_state_exactly(seeded):
    client, engine = seeded
    start = snapshot(engine)
    v = run_to(client, "N6")  # reserve, draft and submission are done; the payments are waiting
    assert snapshot(engine) != start
    n6_token = token_for(client, v["pending"]["approval"])  # a granted but unused token for the last step
    r = cmd(client, "算了").json()
    assert r["status"] == "cancelled" and r["pending"] is None
    assert statuses(r) == {"N1": "done", "N2": "done", "N3": "done", "N4": "undone", "N5a": "undone", "N5b": "undone", "N6": "dropped"}
    assert snapshot(engine) == start
    spent = client.post("/bank/schedules", json={"customer_id": 1, "purpose": "蜂蜜钱", "approval_token": n6_token, "items": [
        {"payee_id": 1, "amount": 4000, "times": 2, "run_on": "2026-08-01"}]})
    assert spent.status_code == 403  # the revoked token cannot be replayed
    assert snapshot(engine) == start
    assert say(client, "算了").json()["notice_zh"] == "这件事已经结束了。"  # and the plan is closed for good


def test_never_mind_after_everything_finished_undoes_it_all(seeded):
    client, engine = seeded
    start = snapshot(engine)
    v = say(client, S6).json()
    while v["pending"]:
        v = approve_pending(client, v).json()
    assert v["status"] == "done" and snapshot(engine) != start
    r = cmd(client, "算了").json()
    assert r["status"] == "cancelled" and {statuses(r)[k] for k in ("N4", "N5a", "N5b", "N6")} == {"undone"}
    assert snapshot(engine) == start
    with Session(engine) as s:  # the undo steps are on the record, newest first
        undone = [a.payload["node_id"] for a in s.exec(select(AgentAudit)) if a.event == "agent_undo"]
        assert undone == ["N6", "N5b", "N5a", "N4"]
        assert verify_chain(s) == (True, None)


# ---------- handover ----------
def test_handover_record_has_the_dag_the_state_and_the_trace(seeded):
    client, engine = seeded
    v = run_to(client, "N5a")
    r = cmd(client, "找人工").json()
    assert r["status"] == "handed_over" and r["handover_id"] and r["pending"] is None
    with Session(engine) as s:
        h = s.get(AgentHandover, r["handover_id"])
        assert h.trace_id == v["trace_id"] and h.session_id == "s1" and len(h.dag_json["dag"]["nodes"]) == 7
        assert h.state["nodes"]["N4"]["status"] == "done" and h.state["nodes"]["N5a"]["status"] == "waiting"  # how far it got
        assert {a.action: a.status for a in s.exec(select(BankApproval))}["financing_prefill"] == "declined"  # nothing left to approve
    t = client.get(f"/trace/{v['trace_id']}").json()
    last = t["steps"][-1]
    assert last["event"] == "agent_handover" and last["dag"]["nodes"] and t["status"] == "已转人工"
    assert client.post("/agent/approve", json={"session_id": "s1", "node_id": "N5a", "token": "x"}).status_code == 409
    assert snapshot(engine)["active_reserves"] == 1  # what was already done is left as it is for the person to see


# ---------- invalid and tampered plans ----------
def node(id_, tool, tier="green", deps=(), args=None, undo=None):
    return DagNode(id=id_, tool=tool, base_tier=tier, depends_on=list(deps), args=args or {}, undo={"tool": undo, "args": {}} if undo else None)


@pytest.mark.parametrize("nodes,why", [
    ([node("A", "wire_money_abroad")], "不认识"),
    ([node("A", "reserve_funds", "green", args={"amount": {"$ref": "A.x"}}, undo="release_reserve")], "标成 green"),  # lowered tier
    ([node("A", "reserve_funds", "yellow", args={"amount": 5000.0}, undo="release_reserve")], "写死"),  # amount typed into the plan
    ([node("A", "reserve_funds", "yellow", args={}, undo="release_reserve")], "写死"),
    ([node("A", "reserve_funds", "yellow", args={"amount": {"$ref": "A.x"}})], "撤销"),  # no way to undo it
    ([node("A", "check_compliance", undo="release_reserve")], "撤销"),
    ([node("A", "check_compliance"), node("B", "transfer_money", "yellow", ["A"], {"payee_id": 1, "amount": 5.0})], "写死"),  # payee typed in
    ([node("A", "check_compliance", args={"x": {"$ref": "B.y"}}), node("B", "match_policies")], "不在它前面"),
])
def test_invalid_plans_are_rejected(nodes, why):
    with pytest.raises(tools.PlanRejected, match=why):
        tools.validate(Dag(nodes=nodes))


def test_schema_errors_never_get_that_far():
    with pytest.raises(ValueError, match="cycle"):
        Dag(nodes=[node("A", "check_compliance", deps=["B"]), node("B", "check_compliance", deps=["A"])])
    with pytest.raises(ValueError, match="unknown"):
        Dag(nodes=[node("A", "check_compliance", deps=["Z"])])
    with pytest.raises(ValueError, match="duplicate"):
        Dag(nodes=[node("A", "check_compliance"), node("A", "match_policies")])


def test_an_invalid_plan_from_the_planner_is_refused_and_nothing_runs(seeded, monkeypatch):
    client, engine = seeded
    start = snapshot(engine)
    bad = Dag(nodes=[node("N1", "reserve_funds", "yellow", args={"label": "x", "amount": 40_000.0}, undo="release_reserve")])
    monkeypatch.setattr(planner_mock, "plan", lambda text: bad)
    r = say(client, S6)
    assert r.status_code == 422 and "写死" in r.json()["detail"]
    assert snapshot(engine) == start
    with Session(engine) as s:
        assert not s.exec(select(AgentPlan)).all()  # nothing was stored
        row = next(a for a in s.exec(select(AgentAudit)) if a.event == "agent_plan_rejected")
        assert "rejected" in row.payload["result"] and row.payload["utterance"] == S6 and row.payload["dag"]["nodes"]


def test_a_plan_changed_in_the_database_is_stopped(seeded):
    client, engine = seeded
    v = say(client, S6).json()
    token = token_for(client, v["pending"]["approval"])
    with Session(engine) as s:  # someone edits the stored plan: a literal amount for the reserve
        plan = s.get(AgentPlan, v["plan_id"])
        dag = {**plan.dag_json["dag"]}
        dag["nodes"] = [{**n, "args": {**n["args"], "amount": 999_999.0}} if n["id"] == "N4" else n for n in dag["nodes"]]
        plan.dag_json = {**plan.dag_json, "dag": dag}
        s.add(plan)
        s.commit()
    r = client.post("/agent/approve", json={"session_id": "s1", "node_id": "N4", "token": token})
    assert r.status_code == 409 and "改动" in r.json()["detail"]
    assert snapshot(engine)["active_reserves"] == 0 and client.get("/agent/session/s1").json()["status"] == "rejected"


def test_a_plan_whose_hash_was_also_rewritten_is_caught_by_the_audit_anchor(seeded):
    client, engine = seeded
    v = say(client, S6).json()
    with Session(engine) as s:  # a harmless-looking label change, with the stored hash recomputed to match
        plan = s.get(AgentPlan, v["plan_id"])
        dag = {**plan.dag_json["dag"], "nodes": [{**n, "label_zh": "别的名字"} if n["id"] == "N1" else n for n in plan.dag_json["dag"]["nodes"]]}
        plan.dag_json = {"dag": dag, "hash": Dag.model_validate(dag).digest()}
        s.add(plan)
        s.commit()
    r = cmd(client, "继续")
    assert r.status_code == 409 and "审计记录" in r.json()["detail"]


# ---------- the simpler requests ----------
def test_pay_like_last_year_schedules_six_suppliers(seeded):
    client, engine = seeded
    txns = snapshot(engine)["txns"]
    v = say(client, "像去年一样给六家付蜂蜜钱").json()
    assert statuses(v) == {"P1": "done", "P2": "waiting"} and "6 家" in v["nodes"][0]["summary_zh"]
    assert v["pending"]["approval"]["tier"] == "red" and "6家" in v["pending"]["readback_zh"] and "送货时才转" in v["pending"]["readback_zh"]
    done = approve_pending(client, v).json()
    assert done["status"] == "done"
    assert snapshot(engine)["scheduled"] == 12 and snapshot(engine)["txns"] == txns  # twelve payments waiting for delivery, none made


def test_a_single_transfer_and_its_one_way_nature(seeded):
    client, engine = seeded
    before = snapshot(engine)["balance"]
    v = say(client, "给老李转800，蜂蜜钱").json()
    assert statuses(v) == {"T1": "done", "T2": "waiting"} and "李国强" in v["nodes"][0]["summary_zh"]
    assert v["pending"]["readback_zh"] == "给老李（李国强）转 800 元（八百元），蜂蜜钱，对吗？" and v["pending"]["approval"]["tier"] == "yellow"
    done = approve_pending(client, v).json()
    assert done["status"] == "done" and snapshot(engine)["balance"] == before - 800
    r = cmd(client, "算了").json()
    assert r["status"] == "cancelled" and "不能撤销" in r["notice_zh"] and snapshot(engine)["balance"] == before - 800  # money that left stays


def test_unknown_text_gets_one_question_and_ambiguous_names_stop(seeded):
    client, engine = seeded
    q = say(client, "今天天气怎么样").json()
    assert q["status"] == "question" and q["question_zh"] == planner_mock.QUESTION and not q["nodes"]
    assert say(client, "算了", "fresh").json()["question_zh"] == "现在没有在办的事。"
    amb = say(client, "给老转800，蜂蜜钱", "s2").json()
    assert amb["status"] == "failed" and "哪一位" in amb["nodes"][0]["error"]
    with Session(engine) as s:
        assert not s.exec(select(AgentAudit).where(AgentAudit.event == "reserve_created")).all()


def test_commands_work_as_text_too(seeded):
    client, _ = seeded
    say(client, S6)
    assert say(client, "等一下！").json()["status"] == "paused"
    assert say(client, "继续").json()["status"] == "waiting"
    assert say(client, "下个月要收蜂蜜了，帮我准备一下").json()["notice_zh"].startswith("上一件事还没办完")  # one thing at a time


def test_a_cancelled_approval_is_asked_again_on_continue(seeded):
    client, engine = seeded
    v = say(client, S6).json()
    first = v["pending"]["approval"]["approval_id"]
    assert client.post(f"/bank/approvals/{first}/cancel").json()["status"] == "declined"  # "取消，不办了" on the approval card
    again = cmd(client, "继续").json()
    assert again["status"] == "waiting" and again["pending"]["node_id"] == "N4"
    assert again["pending"]["approval"]["approval_id"] != first and again["pending"]["approval"]["status"] == "pending"
    assert snapshot(engine)["active_reserves"] == 0
    done = approve_pending(client, again).json()  # and the new approval works
    assert statuses(done)["N4"] == "done"
