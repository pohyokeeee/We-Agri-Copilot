"""Feature 2: subsidy and loan matching against the single SIMULATED county table. Deterministic, no LLM.

Wording is always "可能符合" (may qualify): the bank or the county office decides. Nothing is ever sent to a government system.
An unknown fact counts as NOT met, so an item reaches may_qualify only when every rule is positively satisfied.
"""
import math
from datetime import date, datetime, time

from sqlmodel import Session, select

from app import clock
from app.agent.grounding import assert_wording
from app.analysis.common import n, shift_months
from app.analysis.reconcile import reconcile_range
from app.audit import chain
from app.models import BankAccount, BankCustomer, BankPayee, BankTxn, RulePolicy

STALE_DAYS = 180
SIMULATED_LABEL = "模拟县 · 数据为演示"
DEFAULT_PROFILE = {"region": "示范县 (模拟)", "structure": "individual", "activity": ["apiculture", "produce"],
                   "cultivated_mu": None, "coop_member": False, "coop_members": 0}
STRUCTURE_KEYS = {"entity", "min_members"}  # rules about what kind of business you are; the only ones "if you" can fix
ENTITY_ZH = {"individual": "个人", "个体工商户": "个体工商户", "cooperative": "合作社", "company": "公司"}
JOIN_ZH = {"cooperative": "加入合作社", "个体工商户": "登记为个体工商户", "company": "成立公司", "individual": "以个人身份经营"}
SECTOR_ZH = {"agriculture": "农业", "apiculture": "养蜂"}
SECTORS_OF = {"apiculture": {"apiculture", "agriculture"}, "produce": {"agriculture"}}  # beekeeping is agriculture too


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + b.month - a.month


def build_profile(s: Session, cust: BankCustomer, acct: BankAccount, financing_need: float, structure: str | None = None,
                  today: date | None = None) -> dict:
    """What the matcher knows: declared facts on the customer, plus numbers read from the sales record and the bank data."""
    today = today or clock.today()
    declared = {**DEFAULT_PROFILE, **(cust.profile or {})}
    month_start = datetime(today.year, today.month, 1)
    year = reconcile_range(s, cust.id, shift_months(month_start, -12), month_start)
    firsts = [p.first_paid_at for p in s.exec(select(BankPayee).where(BankPayee.customer_id == cust.id)) if p.first_paid_at]
    firsts.append(s.exec(select(BankTxn.ts).where(BankTxn.account_id == acct.id).order_by(BankTxn.ts)).first() or datetime.now())
    return {
        "region": declared["region"], "structure": structure or declared["structure"], "activity": declared["activity"],
        "sectors": sorted({x for a in declared["activity"] for x in SECTORS_OF.get(a, {a})}),
        "cultivated_mu": declared["cultivated_mu"], "coop_member": declared["coop_member"], "coop_members": declared["coop_members"],
        "operating_months": max(0, _months_between(min(firsts).date(), today)),
        "income_by_class": year["by_class"], "financing_need": float(financing_need), "today": today.isoformat(),
    }


def _check(key: str, want, p: dict) -> tuple[bool, str]:
    """One rule -> (met, plain Chinese). Unknown rule keys and unknown facts are NOT met."""
    if key == "entity":
        names = "、".join(ENTITY_ZH[w] for w in want)
        return p["structure"] in want, f"经营方式是{names}（您目前是{ENTITY_ZH[p['structure']]}）"
    if key == "min_members":
        if p["structure"] != "cooperative" and not p["coop_member"]:
            return False, f"合作社成员至少{want}人（您目前不是合作社成员）"
        return p["coop_members"] >= want, f"合作社成员至少{want}人（现有{p['coop_members']}人）"
    if key == "sector":
        return want in p["sectors"], f"从事{SECTOR_ZH.get(want, want)}"
    if key == "land_use":
        return bool(p["cultivated_mu"]), "有耕地"
    if key == "min_cultivated_mu":
        mu = p["cultivated_mu"]
        have = f"您有{mu:g}亩" if mu is not None else "还没有耕地面积记录"
        return mu is not None and mu >= want, f"耕地至少{want}亩（{have}）"
    if key == "loan_purpose":
        return p["financing_need"] > 0, "借钱用来周转（目前预测有资金缺口）" if p["financing_need"] > 0 else "借钱用来周转（目前预测没有资金缺口）"
    if key == "min_operating_months":
        return p["operating_months"] >= want, f"经营满{want}个月（您已经营约{p['operating_months']}个月）"
    if key == "max_amount":
        return p["financing_need"] <= want, f"借款不超过{want:,}元（预计需要{n(p['financing_need'])}元）"
    return False, f"无法判断：{key}"


def evaluate(policy: RulePolicy, profile: dict, today: date) -> dict:
    """One policy -> an item with its group. may_qualify only if nothing is unmet."""
    met, unmet = [], []

    def record(key, ok, text):
        (met if ok else unmet).append({"key": key, "text_zh": text})

    record("region", policy.region == profile["region"], f"在{policy.region}")
    if policy.deadline:
        record("deadline", policy.deadline >= today, f"在{policy.deadline}前办理" + ("" if policy.deadline >= today else "（已过期）"))
    for key, want in policy.eligibility.items():
        record(key, *_check(key, want, profile))

    structural = bool(unmet) and all(r["key"] in STRUCTURE_KEYS for r in unmet)
    group = "may_qualify" if not unmet else "if_you" if structural else "not_eligible"
    stale = bool(policy.last_checked) and (today - policy.last_checked).days > STALE_DAYS
    where, tail = policy.where_to_go or "有关窗口", "（资料已超过180天，需核实）" if stale else ""
    wanted = [w for r in unmet if r["key"] == "entity" for w in policy.eligibility["entity"]]
    join = "如果" + "或".join(JOIN_ZH[w] for w in (wanted or policy.eligibility.get("entity", ["cooperative"]))[:2])
    if group == "may_qualify":
        summary = f"可能符合：{policy.name}。{policy.benefit}。是否符合，以审核为准；办理：{where}。{tail}"
    elif group == "if_you":
        summary = f"{join}，才可能符合：{policy.name}。{policy.benefit}。现在还不具备条件。{tail}"
    else:
        summary = f"目前不符合：{'；'.join(r['text_zh'] for r in unmet)}"
    return {
        "policy_id": policy.policy_id, "group": group, "name": policy.name, "kind": policy.kind, "benefit": policy.benefit,
        "documents": policy.documents, "deadline": policy.deadline.isoformat() if policy.deadline else None,
        "where_to_go": where, "rules_met": met, "rules_unmet": unmet, "citation_url": policy.citation_url,
        "last_checked": policy.last_checked.isoformat() if policy.last_checked else None, "simulated": True,
        "needs_verification": stale, "badge_zh": "可能符合" if group == "may_qualify" else join if group == "if_you" else None,
        "summary_zh": summary,
    }


def classify_policies(policies: list[RulePolicy], profile: dict, today: date) -> dict:
    """Pure: policies + profile -> {may_qualify, if_you, not_eligible}. Wording-checked."""
    out = {"may_qualify": [], "if_you": [], "not_eligible": []}
    for pol in policies:
        item = evaluate(pol, profile, today)
        out[item["group"]].append(item)
    for item in out["may_qualify"]:
        assert not item["rules_unmet"], "a may_qualify item must have every rule met"  # guards the central promise
    assert_wording([i["summary_zh"] for g in out.values() for i in g] + [r["text_zh"] for g in out.values() for i in g for r in i["rules_met"] + i["rules_unmet"]]
                   + [i["benefit"] for g in out.values() for i in g])
    return out


def interest_subsidy_for(s: Session, cust: BankCustomer, acct: BankAccount, need: float, today: date | None = None) -> tuple[RulePolicy, dict] | None:
    """The interest-subsidy policy this customer may qualify for when borrowing `need`, else None. No audit row."""
    today = today or clock.today()
    profile = build_profile(s, cust, acct, need, today=today)
    for pol in s.exec(select(RulePolicy).where(RulePolicy.kind == "interest_subsidy")):
        item = evaluate(pol, profile, today)
        if item["group"] == "may_qualify":
            return pol, item
    return None


def match_policies(s: Session, customer_id: int, structure: str | None = None, today: date | None = None) -> dict:
    """The three groups for one customer. Audited; caller commits."""
    from app.analysis.forecast import forecast_procurement  # lazy: forecast itself uses interest_subsidy_for

    today = today or clock.today()
    cust = s.get(BankCustomer, customer_id)
    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).first()
    if not cust or not acct:
        raise LookupError("customer not found")
    fc = forecast_procurement(s, customer_id, today=today, audit=False)
    need = math.ceil(fc.get("gap_high", 0.0) / 100) * 100.0  # the loan that would cover the worst-case gap
    profile = build_profile(s, cust, acct, need, structure, today)
    groups = classify_policies(list(s.exec(select(RulePolicy).order_by(RulePolicy.policy_id))), profile, today)
    result = {
        "customer_id": customer_id, "region": profile["region"], "simulated_label": SIMULATED_LABEL, "profile": profile,
        **groups, "disclaimer": "这是信息，不是建议 · 请咨询12366",
    }
    chain.append(s, "analysis", "policy_match", {
        "customer_id": customer_id, "structure": profile["structure"], "financing_need": need,
        **{g: [i["policy_id"] for i in items] for g, items in groups.items()},
        "needs_verification": [i["policy_id"] for items in groups.values() for i in items if i["needs_verification"]]})
    return result
