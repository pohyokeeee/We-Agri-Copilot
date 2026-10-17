"""Pre-procurement forecast (feature 3), deterministic. The range comes from last years' payments, never one number.

Nothing here executes anything: the plan is a suggestion, each step already carries the tier the real call would get.
Dates come from app.clock.today() (the demo clock) unless a `today` is passed in (the backtest does).
"""
import calendar
import math
import statistics
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlmodel import Session, func, select

from app import clock
from app.agent.grounding import assert_wording
from app.analysis.common import n, shift_months
from app.analysis.compliance import DISCLAIMER
from app.analysis.reconcile import reconcile_range
from app.analysis.history import _history, _month_end, _next_window
from app.audit import chain
from app.mockbank.service import payee_known, reasons_zh, reserved_total, usual_amount
from app.models import (
    BankAccount, BankCustomer, BankPayee, BankProduct, BankSchedule, BankTxn, CalendarEntry, PlatformOrder,
)
from app.risk.tiers import classify, max_tier

HORIZON_DAYS = 60  # purchases starting within this many days are "next"
MARKER = {"green": "🟢", "yellow": "🟡", "red": "🔴"}
CATEGORY_ZH = {"household": "家庭开支"}


def _next_month(d: date) -> date:
    return date(d.year + d.month // 12, d.month % 12 + 1, 1)


def _ceil100(x: float) -> float:
    return float(math.ceil(x / 100) * 100)


def _occurrences(day: int, today: date, until: date) -> list[date]:
    """Dates with this day-of-month in (today, until]."""
    out, d = [], date(today.year, today.month, 1)
    while d <= until:
        dd = date(d.year, d.month, min(day, calendar.monthrange(d.year, d.month)[1]))
        if today < dd <= until:
            out.append(dd)
        d = _next_month(d)
    return out


def _cash(s: Session, cust: BankCustomer, acct: BankAccount, today: date, start: date, purchase_categories: set[str]) -> dict:
    """Cash at the window start = available balance + expected inflows - recurring and scheduled outflows. Low/high ranges."""
    reserved = reserved_total(s, cust.id)
    available = round(acct.balance - reserved, 2)
    month_start = datetime(today.year, today.month, 1)
    hist = s.exec(select(BankTxn).where(BankTxn.account_id == acct.id, BankTxn.ts >= shift_months(month_start, -12),
                                        BankTxn.ts < datetime.combine(today, time.min))).all()

    def recurring(rows, key):  # key -> {amounts, days, months} for things that happen almost every month
        g = defaultdict(lambda: {"amounts": [], "days": [], "months": set()})
        for t in rows:
            x = g[key(t)]
            x["amounts"].append(t.amount)
            x["days"].append(t.ts.day)
            x["months"].add((t.ts.year, t.ts.month))
        return {k: v for k, v in g.items() if len(v["months"]) >= 10}

    inflows, outflows = [], []
    for _, v in recurring([t for t in hist if t.income_class == "pension"], lambda t: "pension").items():
        for d in _occurrences(round(statistics.median(v["days"])), today, start):
            inflows.append({"label": "养老金", "date": d.isoformat(), "low": min(v["amounts"]), "high": max(v["amounts"])})
    for cat, v in recurring([t for t in hist if t.direction == "debit" and t.category not in purchase_categories],
                            lambda t: t.category).items():
        for d in _occurrences(round(statistics.median(v["days"])), today, start):
            outflows.append({"label": CATEGORY_ZH.get(cat, cat), "date": d.isoformat(), "low": min(v["amounts"]), "high": max(v["amounts"])})

    # platform payouts: settled on the last day of each month, net of the fee seen in the last 12 months
    year = reconcile_range(s, cust.id, shift_months(month_start, -12), month_start)
    fee = year["platform_fees"] / year["platform_reported"] if year["platform_reported"] else 0.0
    d = date(today.year, today.month, 1)
    while d <= start:
        pay_day = _month_end(d.year, d.month)
        if today < pay_day <= start:
            ms, me = datetime(d.year, d.month, 1), datetime.combine(_next_month(d), time.min)
            if (d.year, d.month) == (today.year, today.month):  # this month so far, then the run-rate for the rest
                mtd = sum(o.amount for o in s.exec(select(PlatformOrder).where(
                    PlatformOrder.ts >= ms, PlatformOrder.ts < datetime.combine(today, time.min))) if o.amount > 0)
                elapsed = today.day - 1
                low = mtd
                high = mtd + (mtd / elapsed * (calendar.monthrange(d.year, d.month)[1] - elapsed) if elapsed else 0)
            else:  # later month: same month last year
                ly = sum(o.amount for o in s.exec(select(PlatformOrder).where(
                    PlatformOrder.ts >= shift_months(ms, -12), PlatformOrder.ts < shift_months(me, -12))) if o.amount > 0)
                low = high = ly
            inflows.append({"label": "平台打款", "date": pay_day.isoformat(), "low": low * (1 - fee), "high": high * (1 - fee)})
        d = _next_month(d)

    scheduled = round(sum(x.amount for x in s.exec(select(BankSchedule).where(
        BankSchedule.customer_id == cust.id, BankSchedule.status == "scheduled",
        BankSchedule.run_on >= today, BankSchedule.run_on <= start))), 2)
    in_lo, in_hi = sum(x["low"] for x in inflows), sum(x["high"] for x in inflows)
    out_lo, out_hi = sum(x["low"] for x in outflows), sum(x["high"] for x in outflows)
    last_txn = s.exec(select(func.max(BankTxn.ts)).where(BankTxn.account_id == acct.id)).one()
    return {
        "balance": acct.balance, "reserved": reserved, "available": available, "fee_ratio": fee,
        "inflows": inflows, "outflows": outflows, "scheduled": scheduled,
        "data_until": last_txn.date().isoformat() if last_txn else None,
        "cash_low": round(available + in_lo - out_hi - scheduled, 2),
        "cash_high": round(available + in_hi - out_lo - scheduled, 2),
    }


def _plan(s: Session, cust: BankCustomer, acct: BankAccount, suppliers: list[dict], need_mid: float,
          gap_high: float, available: float, today: date) -> dict:
    """Suggested steps with the tier each would get from the tier engine. Executes nothing."""
    now = clock.now()
    payees = {p.id: p for p in s.exec(select(BankPayee).where(BankPayee.customer_id == cust.id))}
    usual = usual_amount(s, acct.id)
    steps = []

    def step(sid, kind, text, amount, tier_result, **extra):
        steps.append({"id": sid, "kind": kind, "text_zh": text, "amount": amount, "tier": tier_result["final_tier"],
                      "marker": MARKER[tier_result["final_tier"]], "reasons": tier_result["reasons"],
                      "reasons_zh": reasons_zh(tier_result["reasons"]),
                      "requires_cosigner": tier_result["requires_cosigner"], **extra})

    kw = dict(now=now, protection_mode=cust.protection_mode)
    reserve = _ceil100(min(need_mid, available))
    if reserve > 0:
        step("reserve", "reserve", f"先预留{n(reserve)}元：只是把钱留出来，不转出去",
             reserve, classify("reserve", amount=reserve, balance=acct.balance, **kw))
    financing = []
    if gap_high > 0:
        loan = _ceil100(gap_high)
        for p in s.exec(select(BankProduct)):
            if p.eligibility.get("max_amount", float("inf")) < loan:
                continue
            interest, fee = round(loan * p.apr * p.term_months / 12, 2), round(loan * p.fees, 2)
            total = round(interest + fee, 2)
            financing.append({
                "product_id": p.id, "name": p.name, "amount": loan, "apr": p.apr, "term_months": p.term_months,
                "interest": interest, "fee": fee, "total_cost": total, "total_repay": round(loan + total, 2),
                "text_zh": (f"{p.name}：借{n(loan)}元，{p.term_months}个月，年利率{p.apr:.2%}；利息约{n(interest)}元，"
                            f"手续费{n(fee)}元，合计成本{n(total)}元，到期共还{n(loan + total)}元。额度和条件以银行审核为准。")})
        step("financing_prefill", "financing_prefill", f"如果要借钱，先预填贷款申请，借{n(loan)}元（还不会发出）", loan,
             classify("financing_prefill", amount=loan, balance=acct.balance, **kw))
        step("financing_submit", "financing_submit", "您确认后，才正式发出贷款申请", loan,
             classify("financing_submit", amount=loan, balance=acct.balance, **kw))
    if suppliers:
        tiers, rows = None, []
        for sp in suppliers:
            p = payees.get(sp["payee_id"])
            r = classify("transfer", amount=sp["typical_payment"], payee_known=payee_known(p, today),
                         usual_amount=usual, balance=acct.balance, **kw)
            tiers = r if tiers is None else {**r, "final_tier": max_tier(tiers["final_tier"], r["final_tier"]),
                                             "reasons": sorted(set(tiers["reasons"]) | set(r["reasons"])),
                                             "requires_cosigner": tiers["requires_cosigner"] or r["requires_cosigner"]}
            rows.append({"name": sp["name"], "amount": sp["typical_payment"], "tier": r["final_tier"], "marker": MARKER[r["final_tier"]]})
        amts = [x["amount"] for x in rows]
        step("pay_suppliers", "transfer", f"每家送货时再付款（{len(rows)}家，单笔约{n(min(amts))}到{n(max(amts))}元）",
             round(sum(amts), 2), tiers, suppliers=rows)
    return {"steps": steps, "financing": financing, "executed": False}


def forecast_procurement(s: Session, customer_id: int, today: date | None = None, horizon_days: int = HORIZON_DAYS) -> dict:
    """See module docstring. Audited; caller commits."""
    today = today or clock.today()
    cust = s.get(BankCustomer, customer_id)
    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).first()
    if not cust or not acct:
        raise LookupError("customer not found")
    entries = s.exec(select(CalendarEntry)).all()
    windows = sorted((*_next_window(e, today), e) for e in entries if (_next_window(e, today)[0] - today).days <= horizon_days)
    payees = {p.name: p for p in s.exec(select(BankPayee).where(BankPayee.customer_id == customer_id))}

    purchases = []
    for start, end, e in windows:
        by, last, years = _history(s, acct.id, e, start, end)
        sups = []
        for name, pays in by.items():
            per = max(1, round(len(pays) / years))
            sups.append({"name": name, "payee_id": payees[name].id if name in payees else None,
                         "last_year_total": round(last.get(name, 0.0), 2), "typical_payment": round(statistics.median(pays), 2),
                         "payments_per_season": per, "amount_low": round(per * min(pays), 2), "amount_high": round(per * max(pays), 2)})
        sups.sort(key=lambda x: -x["last_year_total"])
        purchases.append({"activity": e.activity, "window_start": start.isoformat(), "window_end": end.isoformat(),
                          "days_until": (start - today).days, "suppliers": sups,
                          "amount_low": round(sum(x["amount_low"] for x in sups), 2),
                          "amount_high": round(sum(x["amount_high"] for x in sups), 2)})

    result = {"today": today.isoformat(), "next_purchases": purchases, "disclaimer": DISCLAIMER}
    if not purchases:
        result.update(assumptions=[f"未来{horizon_days}天内没有计划中的采购。"], plan={"steps": [], "financing": [], "executed": False})
        chain.append(s, "analysis", "procurement_forecast", {"customer_id": customer_id, "today": result["today"], "purchases": 0})
        return result

    first = purchases[0]["window_start"]  # cash and gap are measured against everything starting on the first date
    group = [p for p in purchases if p["window_start"] == first]
    need_lo, need_hi = sum(p["amount_low"] for p in group), sum(p["amount_high"] for p in group)
    start = date.fromisoformat(first)
    cash = _cash(s, cust, acct, today, start, {e.typical_purchase for e in entries})
    gap_low, gap_high = max(0.0, need_lo - cash["cash_high"]), max(0.0, need_hi - cash["cash_low"])
    gap_expected = max(0.0, (need_lo + need_hi) / 2 - (cash["cash_low"] + cash["cash_high"]) / 2)
    suppliers = [sp for p in group for sp in p["suppliers"]]
    plan = _plan(s, cust, acct, suppliers, (need_lo + need_hi) / 2, gap_high, cash["available"], today)

    assumptions = []
    if suppliers:
        assumptions += [
            f"金额按去年同期（{start.replace(year=start.year - 1)}起）每家的实际付款估算；今年新增的供应商没有历史，不在内。",
            "每家的范围＝去年付款次数×单次付款的最低和最高金额。"]
    else:
        assumptions.append("没有去年同期的付款记录，无法估算金额。")
    assumptions.append(f"现有余额{n(cash['balance'])}元，其中已预留{n(cash['reserved'])}元；账目数据截至{cash['data_until']}。")
    for x in cash["inflows"]:
        assumptions.append(f"预计{x['date']}流入{x['label']}{n(x['low'])}到{n(x['high'])}元。")
    for x in cash["outflows"]:
        assumptions.append(f"按历史，{x['date']}会有{x['label']}支出{n(x['low'])}到{n(x['high'])}元。")
    assumptions += [
        f"已排期的付款共{n(cash['scheduled'])}元。",
        f"平台打款每月最后一天到账，按近12个月的平台费率约{cash['fee_ratio']:.1%}扣除。",
        "借钱的利息按单利、到期一次还本付息估算。",
        "这些是估算，不是承诺；实际以后来的订单和价格为准。"]
    assert_wording(assumptions + [x["text_zh"] for x in plan["steps"]] + [x["text_zh"] for x in plan["financing"]])

    result.update(
        amount_low=round(need_lo, 2), amount_high=round(need_hi, 2),
        cash_available_low=cash["cash_low"], cash_available_high=cash["cash_high"],
        gap_low=round(gap_low, 2), gap_high=round(gap_high, 2), gap_expected=round(gap_expected, 2),
        cash_detail=cash, assumptions=assumptions, plan=plan)
    chain.append(s, "analysis", "procurement_forecast", {
        "customer_id": customer_id, "today": result["today"], "window_start": first, "amount_low": result["amount_low"],
        "amount_high": result["amount_high"], "gap_low": result["gap_low"], "gap_high": result["gap_high"],
        "steps": [x["id"] + ":" + x["tier"] for x in plan["steps"]]})
    return result
