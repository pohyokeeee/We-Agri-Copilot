"""Deterministic MOCK planner: known requests -> fixed, schema-valid DAGs. Unknown text -> one clarifying question.

Qwen replaces this tomorrow; these templates stay as the fallback when the LLM fails or returns an invalid DAG
(try the LLM, run tools.validate on its DAG, and on any problem call plan() below).

Templates hold no amounts of their own: money comes from earlier nodes ({"$ref": ...}) at run time. The one exception is
an amount the user said out loud ("转800"), which is parsed from the sentence, never invented.
"""
import re

from app.agent.dag import Dag, DagNode
from app.risk.untrusted import ensure_trusted

COMMANDS = ("等一下", "继续", "贷款先不要", "算了", "找人工")
QUESTION = "我没听明白。您是想：一，准备收蜂蜜的钱；二，像去年一样给六家付蜂蜜钱；还是三，给某个人转账？"
_PUNCT = re.compile(r"[\s，。,.！!？?、：:；;]")
_TRANSFER = re.compile(r"^给(?P<who>[^转]{1,10})转(?P<amount>\d+(?:\.\d+)?)元?(?P<purpose>.*)$")


def _ref(path: str) -> dict:
    return {"$ref": path}


def _n(id_, tool, label, tier="green", deps=(), args=None, undo=None) -> DagNode:
    return DagNode(id=id_, tool=tool, label_zh=label, base_tier=tier, depends_on=list(deps), args=args or {},
                   undo={"tool": undo, "args": {}} if undo else None)


def prepare_for_honey() -> Dag:
    """下个月要收蜂蜜了，帮我准备一下: S6. Compliance -> subsidies -> forecast, then reserve and financing, then the payments."""
    return Dag(nodes=[
        _n("N1", "check_compliance", "检查合规"),
        _n("N2", "match_policies", "查补贴和贷款", deps=["N1"]),
        _n("N3", "forecast_procurement", "算收蜂蜜要花多少钱", deps=["N2"]),
        _n("N4", "reserve_funds", "预留收蜂蜜的钱", "yellow", ["N3"], {"label": "收蜂蜜", "amount": _ref("N3.reserve_amount")}, "release_reserve"),
        _n("N5a", "prefill_financing", "预填贷款申请（还不会发出）", "yellow", ["N3"], {"amount": _ref("N3.loan_amount")}, "withdraw_application"),
        _n("N5b", "submit_financing", "正式发出贷款申请", "red", ["N5a"], {"application_id": _ref("N5a.application_id")}, "withdraw_application"),
        _n("N6", "schedule_conditional_transfers", "安排送货时付给六家邻居", "red", ["N4", "N5b"],
           {"suppliers": _ref("N3.suppliers"), "run_on": _ref("N3.window_start")}, "cancel_schedules"),
    ])


def pay_like_last_year() -> Dag:
    """像去年一样给六家付蜂蜜钱: last year's amounts, paid on delivery."""
    return Dag(nodes=[
        _n("P1", "plan_supplier_payments", "查去年付给各家的钱"),
        _n("P2", "schedule_conditional_transfers", "安排送货时付给各家", "red", ["P1"],
           {"suppliers": _ref("P1.suppliers"), "run_on": _ref("P1.window_start")}, "cancel_schedules"),
    ])


def one_transfer(who: str, amount: float, purpose: str) -> Dag:
    """给老李转800，蜂蜜钱: find the payee in the bank's own list, then one transfer."""
    return Dag(nodes=[
        _n("T1", "resolve_payee", f"找“{who}”", args={"query": who}),
        _n("T2", "transfer_money", f"转 {amount:g} 元", "yellow", ["T1"],
           {"payee_id": _ref("T1.payee_id"), "amount": amount, "purpose": purpose, "spoken_as": who}),
    ])


def command_of(text: str) -> str | None:
    """"等一下" etc. typed or tapped as a button."""
    ensure_trusted(text, "指令")
    t = _PUNCT.sub("", text)
    return t if t in COMMANDS else None


def plan(text: str) -> Dag | str:
    """A Dag for a known request, else the clarifying question (a str). Only the user's own words may be planned:
    text from order notes, payee notes or merchant names is Untrusted and is refused here."""
    ensure_trusted(text, "计划")
    t = _PUNCT.sub("", text)
    if "收蜂蜜" in t and "准备" in t:
        return prepare_for_honey()
    if "像去年一样" in t and "蜂蜜" in t:
        return pay_like_last_year()
    if m := _TRANSFER.match(t):
        amount = float(m["amount"])
        if 0 < amount <= 10_000_000:
            return one_transfer(m["who"], amount, m["purpose"])
    return QUESTION
