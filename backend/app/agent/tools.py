"""Tool registry: what each DAG node can do, which tier its action has, how to undo it, how to read it back.

Write tools call the same bank endpoint functions the Mini Program uses, so every tier rule, approval token check and
audit row is the real one. Without a token such a call only opens an approval (202); with the approved token it executes.
"""
import json
import math
from dataclasses import dataclass
from typing import Callable

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.agent.dag import Dag
from app.analysis.common import n
from app.analysis.compliance import check_compliance
from app.analysis.forecast import forecast_procurement
from app.analysis.policy_match import interest_subsidy_for, match_policies
from app.mockbank import financing as fin
from app.mockbank import router as bank
from app.mockbank import schedules as sched
from app.mockbank import schemas as sc
from app.mockbank import service as svc
from app.mockbank.numerals import amount_digits, amount_zh
from app.mockbank.plan import plan_transfers
from app.models import BankAccount, BankCustomer, BankPayee, FinancingApplication
from app.risk.tiers import BASE_TIER

RANK = {"green": 0, "yellow": 1, "red": 2}


class PlanRejected(ValueError):
    """The plan breaks a rule; nothing of it runs."""


class ToolError(Exception):
    def __init__(self, status: int | None, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


@dataclass
class Ctx:
    s: Session
    cust: BankCustomer
    acct: BankAccount
    args: dict  # this node's args with {"$ref"} already replaced by earlier results
    results: dict  # node id -> result


@dataclass
class Tool:
    action: str  # what the tier engine classifies this as; the plan cannot change it
    run: Callable | None = None  # read tools: ctx -> (result, summary_zh)
    prepare: Callable | None = None  # write tools: ctx -> request body, or None when there is nothing to do
    call: Callable | None = None  # (ctx, body, token) -> ("approval" | "ok", payload)
    gate: Callable | None = None  # (ctx, body) -> (action, payload) the approval token is bound to
    readback: Callable | None = None  # (ctx, body, approval view) -> sentence to read back
    done: Callable | None = None  # (ctx, body, response) -> (result, summary_zh)
    undo: str | None = None  # name in UNDO; None = cannot be undone
    ref_only: tuple = ()  # args that must come from an earlier node, never a literal in the plan


def base_tier(action: str) -> str:
    return "green" if action == "analysis" else "yellow" if action == "transfer" else BASE_TIER[action]


def _ceil100(x: float) -> float:
    return float(math.ceil(x / 100) * 100)


def call_bank(fn, *a, **k) -> tuple[str, dict]:
    """Call a bank endpoint function directly. ("approval", view) for a 202, ("ok", body) for success."""
    try:
        r = fn(*a, **k)
    except HTTPException as e:
        raise ToolError(e.status_code, str(e.detail))
    return ("approval", json.loads(r.body)) if isinstance(r, JSONResponse) else ("ok", r)


# ---------- read tools (green) ----------
def _compliance(ctx: Ctx):
    r = check_compliance(ctx.s, ctx.cust.id)
    codes = [f["code"] for f in r["flags"]]
    return {"period": r["period"], "flags": codes}, f"合规检查：有 {len(codes)} 件事要留意"


def _policies(ctx: Ctx):
    r = match_policies(ctx.s, ctx.cust.id)
    ok = r["may_qualify"]
    return ({"may_qualify": [i["policy_id"] for i in ok], "if_you": [i["policy_id"] for i in r["if_you"]],
             "interest_subsidy": any(i["kind"] == "interest_subsidy" for i in ok)}, f"可能符合 {len(ok)} 项补贴或贷款")


def _forecast(ctx: Ctx):
    fc = forecast_procurement(ctx.s, ctx.cust.id)
    if not fc["next_purchases"]:
        return {"none": True, "reserve_amount": 0.0, "loan_amount": 0.0, "suppliers": [], "window_start": None}, "最近没有要收购的东西"
    p = fc["next_purchases"][0]
    reserve = next((st["amount"] for st in fc["plan"]["steps"] if st["id"] == "reserve"), 0.0)
    loan = _ceil100(fc["gap_high"]) if fc["gap_high"] > 0 else 0.0
    suppliers = [{"payee_id": x["payee_id"], "name": x["name"], "amount": x["typical_payment"], "times": x["payments_per_season"]}
                 for x in p["suppliers"] if x["payee_id"]]
    return ({"amount_low": fc["amount_low"], "amount_high": fc["amount_high"], "gap_low": fc["gap_low"], "gap_high": fc["gap_high"],
             "gap_expected": fc["gap_expected"], "reserve_amount": reserve, "loan_amount": loan, "suppliers": suppliers,
             "window_start": p["window_start"], "window_end": p["window_end"]},
            f"预测：要花 {n(fc['amount_low'])} 到 {n(fc['amount_high'])} 元，可能差约 {n(fc['gap_expected'])} 元")


def _last_year(ctx: Ctx):
    plan = plan_transfers(ctx.s, ctx.cust, ctx.acct, "supplier_honey", "蜂蜜钱")
    sups = [{"payee_id": i["payee_id"], "name": i["name"], "amount": i["amount"], "times": i["times"]} for i in plan["items"] if i["payee_id"]]
    return {"suppliers": sups, "total": plan["total"], "window_start": plan["window_start"]}, f"去年付给 {len(sups)} 家，合计 {n(plan['total'])} 元"


def _resolve_payee(ctx: Ctx):
    found = bank.payees(customer_id=ctx.cust.id, q=ctx.args["query"], s=ctx.s)
    if not found:
        raise ToolError(None, f"没找到叫“{ctx.args['query']}”的人")
    if len(found) > 1:
        raise ToolError(None, f"您是说哪一位？{'还是'.join(p['name'] for p in found)}")  # one clarifying question, never pick silently
    return {"payee_id": found[0]["id"], "name": found[0]["name"]}, f"找到了{found[0]['name']}"


# ---------- write tools (🟡/🔴: the bank's approval flow decides) ----------
def _reserve_prepare(ctx: Ctx):
    amount = ctx.args.get("amount")
    if not amount or amount <= 0:
        return None
    return {"customer_id": ctx.cust.id, "label": ctx.args.get("label", "收蜂蜜"), "amount": float(round(amount, 2))}


def _prefill_prepare(ctx: Ctx):
    loan = ctx.args.get("amount")
    if not loan or loan <= 0:
        return None
    found = interest_subsidy_for(ctx.s, ctx.cust, ctx.acct, loan)
    options = [o for o in fin.cost_options(ctx.s, loan, None, found[0] if found else None) if o["within_limit"]]
    if not options:
        raise ToolError(None, "没有合适的贷款产品")
    best = min(options, key=lambda o: o["total_cost"] if o["cost_after_subsidy"] is None else o["cost_after_subsidy"])  # cheapest after subsidy
    return {"customer_id": ctx.cust.id, "product_id": best["product_id"], "amount": float(round(loan, 2)), "term_months": best["term_months"]}


def _submit_prepare(ctx: Ctx):
    app_id = ctx.args.get("application_id")
    return {"customer_id": ctx.cust.id, "application_id": int(app_id)} if app_id else None


def _submit_gate(ctx: Ctx, body: dict):
    a = ctx.s.get(FinancingApplication, body["application_id"])
    return "financing_submit", {"application_id": a.id, "product_id": a.product_id, "amount": a.amount}


def _submit_readback(ctx: Ctx, body: dict, view: dict):
    a = ctx.s.get(FinancingApplication, body["application_id"])
    return (f"现在正式把贷款申请发给模拟银行，借 {amount_digits(a.amount)} 元（{amount_zh(a.amount)}），{a.term_months}个月。"
            "只发给模拟银行，不会发给任何政府系统，对吗？")


def _schedule_prepare(ctx: Ctx):
    sups, run_on = ctx.args.get("suppliers") or [], ctx.args.get("run_on")
    if not sups or not run_on:
        return None
    return {"customer_id": ctx.cust.id, "purpose": "蜂蜜钱", "items": [
        {"payee_id": x["payee_id"], "amount": x["amount"], "times": x["times"], "run_on": run_on, "condition": "on_delivery"} for x in sups]}


def _transfer_prepare(ctx: Ctx):
    if not ctx.args.get("payee_id"):
        raise ToolError(None, "没有收款人")
    return {"customer_id": ctx.cust.id, "payee_id": int(ctx.args["payee_id"]), "amount": float(round(ctx.args["amount"], 2)),
            "purpose": ctx.args.get("purpose", "")}


def _transfer_readback(ctx: Ctx, body: dict, view: dict):
    return svc.readback_zh(ctx.s.get(BankPayee, body["payee_id"]).name, ctx.args.get("spoken_as"), body["amount"], body["purpose"])


TOOLS: dict[str, Tool] = {
    "check_compliance": Tool("analysis", run=_compliance),
    "match_policies": Tool("analysis", run=_policies),
    "forecast_procurement": Tool("analysis", run=_forecast),
    "plan_supplier_payments": Tool("analysis", run=_last_year),
    "resolve_payee": Tool("analysis", run=_resolve_payee),
    "reserve_funds": Tool(
        "reserve", prepare=_reserve_prepare, undo="release_reserve", ref_only=("amount",),
        call=lambda c, b, t: call_bank(bank.create_reserve, sc.ReserveIn(**b, approval_token=t), s=c.s),
        gate=lambda c, b: ("reserve", {"label": b["label"], "amount": b["amount"]}),
        readback=lambda c, b, v: f"先预留 {amount_digits(b['amount'])} 元（{amount_zh(b['amount'])}）做收蜂蜜的钱，只是把钱留出来，不转出去，对吗？",
        done=lambda c, b, o: ({"reserve_id": o["reserve_id"], "amount": b["amount"]}, f"已预留 {n(b['amount'])} 元")),
    "prefill_financing": Tool(
        "financing_prefill", prepare=_prefill_prepare, undo="withdraw_application", ref_only=("amount",),
        call=lambda c, b, t: call_bank(fin.create_draft, fin.ApplicationIn(**b, approval_token=t), s=c.s),
        gate=lambda c, b: ("financing_prefill", {"product_id": b["product_id"], "amount": b["amount"], "term_months": b["term_months"]}),
        readback=lambda c, b, v: v["readback_zh"],
        done=lambda c, b, o: ({"application_id": o["application_id"], "product": o["product"], "amount": o["amount"]},
                              f"已预填「{o['product']}」贷款草稿，借 {n(o['amount'])} 元")),
    "submit_financing": Tool(
        "financing_submit", prepare=_submit_prepare, undo="withdraw_application", gate=_submit_gate, readback=_submit_readback,
        call=lambda c, b, t: call_bank(fin.submit_application, b["application_id"], fin.SubmitIn(customer_id=b["customer_id"], approval_token=t), s=c.s),
        done=lambda c, b, o: ({"application_id": o["application_id"], "status": o["status"]}, "贷款申请已发给模拟银行")),
    "schedule_conditional_transfers": Tool(
        "schedule", prepare=_schedule_prepare, undo="cancel_schedules",
        call=lambda c, b, t: call_bank(sched.create_schedules, sched.ScheduleBatchIn(**b, approval_token=t), s=c.s),
        gate=lambda c, b: ("schedule", sched.payload_of(sched.ScheduleBatchIn(**b))),
        readback=lambda c, b, v: v["readback_zh"],
        done=lambda c, b, o: ({"batch_id": o["batch_id"], "count": o["count"], "total": o["total"]},
                              f"已安排送货时付款，共 {o['count']} 笔，合计 {n(o['total'])} 元（现在没有转钱）")),
    "transfer_money": Tool(
        "transfer", prepare=_transfer_prepare, undo=None, ref_only=("payee_id",),  # money that has left cannot be called back
        call=lambda c, b, t: call_bank(bank.transfer, sc.TransferIn(**b, approval_token=t), s=c.s),
        gate=lambda c, b: ("transfer", {"payee_id": b["payee_id"], "amount": b["amount"], "purpose": b["purpose"]}),
        readback=_transfer_readback,
        done=lambda c, b, o: ({"balance_before": o["balance_before"], "balance_after": o["balance_after"], "payee": o["payee"],
                               "amount": o["amount"]}, f"已转 {n(o['amount'])} 元给{o['payee']}")),
}


# ---------- undo (compensation) ----------
def _undo_reserve(ctx: Ctx, result: dict) -> str:
    call_bank(bank.release_reserve, result["reserve_id"], ctx.cust.id, s=ctx.s)
    return "已释放预留"


def _undo_application(ctx: Ctx, result: dict) -> str:
    try:
        call_bank(fin.withdraw_application, result["application_id"], ctx.cust.id, s=ctx.s)
    except ToolError as e:
        if e.status != 409:  # 409 = already withdrawn (the draft and the submission are one application)
            raise
    return "已撤回贷款申请"


def _undo_schedules(ctx: Ctx, result: dict) -> str:
    call_bank(sched.cancel_schedules, result["batch_id"], ctx.cust.id, s=ctx.s)
    return "已取消付款安排"


UNDO: dict[str, Callable] = {"release_reserve": _undo_reserve, "withdraw_application": _undo_application, "cancel_schedules": _undo_schedules}


# ---------- references and validation ----------
def resolve(x, results: dict):
    """Replace {"$ref": "N3.reserve_amount"} with the value an earlier node produced."""
    if isinstance(x, dict):
        if set(x) == {"$ref"}:
            node_id, _, key = x["$ref"].partition(".")
            return (results.get(node_id) or {}).get(key)
        return {k: resolve(v, results) for k, v in x.items()}
    if isinstance(x, list):
        return [resolve(v, results) for v in x]
    return x


def _refs(x) -> list[str]:
    if isinstance(x, dict):
        return [x["$ref"].partition(".")[0]] if set(x) == {"$ref"} else [r for v in x.values() for r in _refs(v)]
    return [r for v in x for r in _refs(v)] if isinstance(x, list) else []


def validate(dag: Dag) -> None:
    """Reject a plan that tries to do more than the rules allow. Raises PlanRejected; nothing runs."""
    ancestors: dict[str, set[str]] = {}
    for nid in dag.order():
        node = dag.node(nid)
        ancestors[nid] = set(node.depends_on).union(*(ancestors[d] for d in node.depends_on))
        tool = TOOLS.get(node.tool)
        if tool is None:
            raise PlanRejected(f"{nid}: 不认识的工具 {node.tool}")
        real = base_tier(tool.action)
        if RANK[node.base_tier] < RANK[real]:
            raise PlanRejected(f"{nid}: 计划把 {node.tool} 标成 {node.base_tier}，但它真正的等级不低于 {real}")
        if (node.undo or {}).get("tool") != tool.undo:
            raise PlanRejected(f"{nid}: 撤销办法和工具不匹配")
        for key in tool.ref_only:
            v = node.args.get(key)
            if not (isinstance(v, dict) and set(v) == {"$ref"}):
                raise PlanRejected(f"{nid}: {key} 必须来自前面的步骤，不能写死在计划里")
        for ref in _refs(node.args):
            if ref not in ancestors[nid]:
                raise PlanRejected(f"{nid}: 引用了不在它前面的步骤 {ref}")
