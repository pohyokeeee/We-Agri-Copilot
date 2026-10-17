import json
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app import clock
from app.agent.grounding import check_wording
from app.analysis.policy_match import STRUCTURE_KEYS, classify_policies, evaluate
from app.audit.chain import verify_chain
from app.models import AgentAudit, BankApproval, FinancingApplication, RulePolicy
from tests.conftest import NOON
from tests.test_bank import confirm, cosign_approve, enter_pin, pending_cosign

TODAY = date(2026, 7, 25)
SEED = Path(__file__).parents[1] / "seed" / "rules_policy.json"


def policies() -> list[RulePolicy]:
    rows = json.loads(SEED.read_text(encoding="utf-8"))
    for r in rows:
        r["deadline"] = date.fromisoformat(r["deadline"]) if r["deadline"] else None
        r["last_checked"] = date.fromisoformat(r["last_checked"])
    return [RulePolicy(**r) for r in rows]


BASE = {"region": "示范县 (模拟)", "structure": "individual", "sectors": ["agriculture", "apiculture"], "cultivated_mu": 3.0,
        "coop_member": False, "coop_members": 0, "operating_months": 35, "financing_need": 7500.0}
PROFILES = [  # ten synthetic businesses
    BASE,
    BASE | {"structure": "cooperative", "coop_member": True, "coop_members": 8},
    BASE | {"structure": "cooperative", "coop_member": True, "coop_members": 3},
    BASE | {"structure": "company"},
    BASE | {"structure": "个体工商户", "financing_need": 0.0},
    BASE | {"cultivated_mu": None},
    BASE | {"region": "邻县 (模拟)"},
    BASE | {"operating_months": 6},
    BASE | {"financing_need": 150_000.0},
    BASE | {"sectors": ["agriculture"], "financing_need": 250_000.0, "cultivated_mu": 0.5},
]


def ids(items):
    return {i["policy_id"] for i in items}


@pytest.mark.parametrize("profile", PROFILES)
def test_may_qualify_never_has_an_unmet_rule(profile):
    out = classify_policies(policies(), profile, TODAY)
    assert sum(len(v) for v in out.values()) == 5  # every policy lands in exactly one group
    for item in out["may_qualify"]:
        assert item["rules_unmet"] == [] and item["rules_met"] and item["simulated"] is True
    for item in out["if_you"]:  # blocked ONLY by what kind of business you are
        assert item["rules_unmet"] and {r["key"] for r in item["rules_unmet"]} <= STRUCTURE_KEYS
    for item in out["not_eligible"]:
        assert {r["key"] for r in item["rules_unmet"]} - STRUCTURE_KEYS
    for item in out["may_qualify"] + out["if_you"]:  # wording: "may qualify", never a promise or an instruction
        assert check_wording(item["summary_zh"])["ok"]
        assert "你符合" not in item["summary_zh"] and "您符合" not in item["summary_zh"] and "应该申请" not in item["summary_zh"]


def test_specific_outcomes_of_the_synthetic_profiles():
    by = [classify_policies(policies(), p, TODAY) for p in PROFILES]
    assert ids(by[0]["may_qualify"]) == {"demo_bank_agri_loan_a", "demo_bank_agri_loan_b", "demo_county_cultivated_land_subsidy",
                                         "demo_county_working_capital_interest_subsidy"}
    assert ids(by[0]["if_you"]) == {"demo_county_coop_only_scheme"}  # needs a co-op: "如果加入合作社"
    assert by[0]["if_you"][0]["badge_zh"] == "如果加入合作社"
    assert "demo_county_coop_only_scheme" in ids(by[1]["may_qualify"])  # a co-op with 8 members
    assert "demo_county_coop_only_scheme" in ids(by[2]["if_you"])  # 3 members: not enough yet
    assert "demo_bank_agri_loan_a" in ids(by[3]["if_you"])  # a company is not on loan A's list: only its kind of business blocks it
    assert "demo_county_working_capital_interest_subsidy" in ids(by[4]["not_eligible"])  # no financing need
    assert "demo_county_cultivated_land_subsidy" in ids(by[5]["not_eligible"])  # unknown land area is not "met"
    assert not by[6]["may_qualify"] and not by[6]["if_you"]  # another county: nothing
    assert {"demo_bank_agri_loan_a", "demo_bank_agri_loan_b"} <= ids(by[7]["not_eligible"])  # too new
    assert "demo_bank_agri_loan_b" in ids(by[8]["not_eligible"]) and "demo_bank_agri_loan_a" in ids(by[8]["may_qualify"])  # over B's cap
    assert not ({"demo_bank_agri_loan_a", "demo_bank_agri_loan_b", "demo_county_cultivated_land_subsidy"} & ids(by[9]["may_qualify"]))


def test_unknown_rule_key_is_never_met():
    odd = RulePolicy(policy_id="x", name="x", region=BASE["region"], kind="subsidy", eligibility={"mystery": 1}, last_checked=TODAY)
    item = evaluate(odd, BASE, TODAY)
    assert item["group"] == "not_eligible" and item["rules_unmet"][0]["text_zh"].startswith("无法判断")


def test_passed_deadline_blocks():
    pol = next(p for p in policies() if p.policy_id == "demo_county_cultivated_land_subsidy")
    assert evaluate(pol, BASE, date(2026, 9, 30))["group"] == "may_qualify"  # the deadline day itself still counts
    assert evaluate(pol, BASE, date(2026, 10, 1))["group"] == "not_eligible"


def test_stale_boundary_is_180_days():
    pol = policies()[0]
    pol.last_checked = TODAY - timedelta(days=180)
    assert evaluate(pol, BASE, TODAY)["needs_verification"] is False
    pol.last_checked = TODAY - timedelta(days=181)
    item = evaluate(pol, BASE, TODAY)
    assert item["needs_verification"] is True and "需核实" in item["summary_zh"]


# ---------- the API on the seeded Uncle Wang ----------
def test_policy_match_endpoint(seeded):
    client, engine = seeded
    d = client.post("/analysis/policy-match", json={}).json()
    assert d["simulated_label"] == "模拟县 · 数据为演示" and d["profile"]["structure"] == "individual" and d["profile"]["operating_months"] >= 24
    assert d["profile"]["financing_need"] > 0 and d["profile"]["income_by_class"]["resale"] > 0  # need from the forecast, income from sales
    assert len(d["may_qualify"]) == 4 and ids(d["if_you"]) == {"demo_county_coop_only_scheme"} and d["not_eligible"] == []
    for item in d["may_qualify"]:
        assert item["rules_unmet"] == [] and item["badge_zh"] == "可能符合" and item["where_to_go"] and item["simulated"]
        assert item["needs_verification"] is False and item["documents"] and item["citation_url"] == "TODO"
    with Session(engine) as s:
        rows = [a.payload for a in s.exec(select(AgentAudit)) if a.event == "policy_match"]
        assert len(rows) == 1 and set(rows[0]["may_qualify"]) == ids(d["may_qualify"])  # exactly one row: the forecast it uses is silent
        assert verify_chain(s) == (True, None)


def test_structure_override_changes_the_groups(seeded):
    client, _ = seeded
    d = client.post("/analysis/policy-match", json={"structure": "company"}).json()
    assert ids(d["may_qualify"]) == {"demo_county_working_capital_interest_subsidy"}  # the one scheme open to companies
    assert {"demo_bank_agri_loan_a", "demo_county_coop_only_scheme"} <= ids(d["if_you"])


def test_not_eligible_is_kept_in_the_response_for_the_trace_page(seeded, monkeypatch):
    client, _ = seeded
    monkeypatch.setattr(clock, "now", lambda: datetime(2027, 1, 15, 12, 0))  # every deadline has passed
    d = client.post("/analysis/policy-match", json={}).json()
    assert {"demo_county_cultivated_land_subsidy", "demo_county_working_capital_interest_subsidy"} <= ids(d["not_eligible"])
    assert all("deadline" in {r["key"] for r in i["rules_unmet"]} for i in d["not_eligible"] if i["deadline"])
    assert not any(i["deadline"] for i in d["may_qualify"])


def test_stale_policy_is_flagged_in_the_response(seeded):
    client, engine = seeded
    with Session(engine) as s:
        pol = s.get(RulePolicy, "demo_county_working_capital_interest_subsidy")
        pol.last_checked = TODAY - timedelta(days=236)
        s.add(pol)
        s.commit()
    d = client.post("/analysis/policy-match", json={}).json()
    flagged = [i for i in d["may_qualify"] if i["needs_verification"]]
    assert [i["policy_id"] for i in flagged] == ["demo_county_working_capital_interest_subsidy"] and "需核实" in flagged[0]["summary_zh"]


# ---------- financing cost, with and without the subsidy ----------
def test_subsidised_cost_is_full_cost_minus_subsidy_exactly(seeded):
    client, engine = seeded
    d = client.get("/bank/products/financing", params={"amount": 20_000, "term": 12}).json()
    assert d["subsidy"]["policy_id"] == "demo_county_working_capital_interest_subsidy" and d["subsidy"]["rate"] == 0.5
    a, b = d["options"]
    # A: 4.35% x 12 months x 20,000 = 870 interest, no fee; the subsidy is half the interest
    assert (a["interest"], a["fee"], a["total_cost"], a["subsidy_amount"], a["cost_after_subsidy"]) == (870.0, 0.0, 870.0, 435.0, 435.0)
    # B: 5.10% -> 1,020 interest + 0.5% fee 100 = 1,120; the subsidy covers interest only, so 1,120 - 510 = 610
    assert (b["interest"], b["fee"], b["total_cost"], b["subsidy_amount"], b["cost_after_subsidy"]) == (1020.0, 100.0, 1120.0, 510.0, 610.0)
    for o in d["options"]:
        assert o["cost_after_subsidy"] == pytest.approx(o["total_cost"] - o["subsidy_amount"]) and o["total_repay_after_subsidy"] == pytest.approx(o["amount"] + o["cost_after_subsidy"])
        assert check_wording(o["text_zh"])["ok"] and "补贴" in o["text_zh"]
    assert "不抵手续费" in d["note_zh"]
    with Session(engine) as s:
        assert [a for a in s.exec(select(AgentAudit)) if a.event == "financing_costs_viewed"]


def test_subsidy_is_the_cap_when_interest_is_large(seeded):
    client, _ = seeded
    d = client.get("/bank/products/financing", params={"amount": 100_000, "term": 12}).json()
    a = d["options"][0]
    assert a["interest"] == 4350.0 and a["subsidy_amount"] == 2175.0  # 50% of 4,350
    d = client.get("/bank/products/financing", params={"amount": 200_000, "term": 12}).json()
    assert d["options"][0]["interest"] == 8700.0 and d["options"][0]["subsidy_amount"] == 4350.0  # still below the 5,000 cap
    d = client.get("/bank/products/financing", params={"amount": 200_000, "term": 24}).json()
    assert d["options"][0]["interest"] == 17400.0 and d["options"][0]["subsidy_amount"] == 5000.0  # capped


def test_no_subsidy_shown_when_not_in_may_qualify(seeded, monkeypatch):
    client, _ = seeded
    monkeypatch.setattr(clock, "now", lambda: datetime(2027, 1, 15, 12, 0))  # after the 2026-12-31 deadline
    d = client.get("/bank/products/financing", params={"amount": 20_000, "term": 12}).json()
    assert d["subsidy"] is None
    assert all(o["subsidy_amount"] is None and o["cost_after_subsidy"] is None and o["total_cost"] > 0 for o in d["options"])


def test_financing_inputs_are_validated(seeded):
    client, _ = seeded
    assert client.get("/bank/products/financing", params={"amount": 0}).status_code == 422
    assert client.get("/bank/products/financing", params={"amount": 5000, "term": 0}).status_code == 422


def test_forecast_plan_shows_both_costs(seeded):
    client, _ = seeded
    plan = client.post("/analysis/procurement-forecast", json={}).json()["plan"]
    for f in plan["financing"]:
        assert f["cost_after_subsidy"] == pytest.approx(f["total_cost"] - f["subsidy_amount"]) and f["subsidy_amount"] > 0


# ---------- pre-filled application: draft (yellow), submit (red), withdraw ----------
def product_id(client, suffix="A"):
    return next(o["product_id"] for o in client.get("/bank/products/financing", params={"amount": 7500}).json()["options"] if o["name"].endswith(suffix))


def new_draft(client, pid, amount=7500):
    body = {"customer_id": 1, "product_id": pid, "amount": amount}
    ap = client.post("/bank/financing/applications", json=body)
    assert ap.status_code == 202
    token = confirm(client, ap.json()).json()["approval_token"]
    return ap.json(), client.post("/bank/financing/applications", json=body | {"approval_token": token})


def test_draft_is_yellow_with_a_readback_and_prefilled_from_the_sales_record(seeded):
    client, engine = seeded
    ap, draft = new_draft(client, product_id(client))
    assert (ap["tier"], ap["tier_base"], ap["requires_pin"], ap["next"]) == ("yellow", "yellow", False, "confirm")
    assert "草稿" in ap["readback_zh"] and "七千五百元" in ap["readback_zh"] and "不会发出" in ap["readback_zh"]
    d = draft.json()
    assert draft.status_code == 200 and d["status"] == "draft" and d["submitted_to"] is None
    pre = d["prefill"]
    assert pre["applicant"] == "王建国" and pre["sales_12m"]["total"] > 200_000 and pre["payouts_12m"] > 0 and pre["operating_months"] >= 24
    assert pre["needs_from_you"] and pre["documents"] and pre["amount"] == 7500
    with Session(engine) as s:
        row = next(a.payload for a in s.exec(select(AgentAudit)) if a.event == "application_drafted")
        assert (row["tier_base"], row["tier_final"], row["method"]) == ("yellow", "yellow", "confirm")


def test_draft_above_the_product_limit_is_refused(seeded):
    client, _ = seeded
    r = client.post("/bank/financing/applications", json={"product_id": product_id(client, "B"), "amount": 150_000})
    assert r.status_code == 422


def test_submit_without_red_approval_is_refused(seeded):
    client, engine = seeded
    pid = product_id(client)
    _, draft = new_draft(client, pid)
    aid = draft.json()["application_id"]
    r = client.post(f"/bank/financing/applications/{aid}/submit", json={})
    assert r.status_code == 202 and r.json()["tier"] == "red" and r.json()["requires_pin"] and r.json()["requires_cosigner"]  # asks, does not submit
    assert client.get(f"/bank/financing/applications/{aid}").json()["status"] == "draft"
    assert client.post(f"/bank/financing/applications/{aid}/submit", json={"approval_token": "made-up"}).status_code == 403
    # a yellow token (from another draft's confirm) cannot stand in for the red approval
    second = {"customer_id": 1, "product_id": pid, "amount": 5000}
    other = client.post("/bank/financing/applications", json=second).json()
    yellow_token = confirm(client, other).json()["approval_token"]
    assert client.post(f"/bank/financing/applications/{aid}/submit", json={"approval_token": yellow_token}).status_code == 403
    assert client.get(f"/bank/financing/applications/{aid}").json()["status"] == "draft"
    with Session(engine) as s:
        assert len([a for a in s.exec(select(AgentAudit)) if a.event == "token_rejected"]) == 2


def test_submit_goes_through_pin_and_cosigner_then_can_be_withdrawn(seeded):
    client, engine = seeded
    _, draft = new_draft(client, product_id(client))
    aid = draft.json()["application_id"]
    ap = client.post(f"/bank/financing/applications/{aid}/submit", json={}).json()
    assert ap["next"] == "confirm"
    assert confirm(client, ap).json()["next"] == "pin"
    assert enter_pin(client, ap).json()["next"] == "cosign"
    (req,) = pending_cosign(client)
    assert "贷款申请" in req["summary_zh"] and "惠农流动贷" in req["summary_zh"] and "七千五百元" in req["summary_zh"]
    assert client.get(f"/bank/financing/applications/{aid}").json()["status"] == "draft"  # still nothing sent
    assert cosign_approve(client, req["id"]).status_code == 200
    token = client.get(f"/bank/approvals/{ap['approval_id']}").json()["approval_token"]
    done = client.post(f"/bank/financing/applications/{aid}/submit", json={"approval_token": token})
    assert done.status_code == 200 and done.json()["status"] == "submitted" and "没有发给任何政府系统" in done.json()["submitted_to"]
    assert client.post(f"/bank/financing/applications/{aid}/submit", json={"approval_token": token}).status_code == 409  # not twice
    with Session(engine) as s:
        row = next(a.payload for a in s.exec(select(AgentAudit)) if a.event == "application_submitted")
        assert (row["tier_base"], row["tier_final"], row["method"]) == ("red", "red", "confirm+pin+cosign")
        assert verify_chain(s) == (True, None)
    gone = client.delete(f"/bank/financing/applications/{aid}")
    assert gone.status_code == 200 and gone.json()["status"] == "withdrawn" and gone.json()["submitted_to"] is None
    assert client.delete(f"/bank/financing/applications/{aid}").status_code == 409


def test_withdraw_a_draft_and_locked_account_blocks_new_drafts(seeded):
    client, engine = seeded
    pid = product_id(client)
    _, draft = new_draft(client, pid)
    assert client.delete(f"/bank/financing/applications/{draft.json()['application_id']}").json()["status"] == "withdrawn"
    with Session(engine) as s:
        assert s.exec(select(FinancingApplication)).one().status == "withdrawn"
    client.post("/bank/security/lock", json={"customer_id": 1})
    assert client.post("/bank/financing/applications", json={"product_id": pid, "amount": 5000}).status_code == 423
    assert client.get("/bank/products/financing", params={"amount": 5000}).status_code == 200  # reading costs still works
