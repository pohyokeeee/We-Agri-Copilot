"""Backtest the procurement forecast on synthetic households.

Run from backend/:  python -m scripts.backtest_forecast   (writes evidence/backtest_forecast.md)

Each household has two honey seasons (Aug-Sep 2024 and 2025). We forecast the 2025 season using only data
dated before the forecast day, at several lead times before the window opens on 2025-08-01, then compare with
what was actually paid. The households come from the same kind of assumptions the forecaster makes (monthly
payouts, pension, steady household spending), so this checks the mechanics, not real-world accuracy.
"""
import random
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlmodel import Session, SQLModel

import app.models  # noqa: F401  (registers tables)
from app.analysis.forecast import forecast_procurement
from app.db import make_engine
from app.models import BankAccount, BankCustomer, BankPayee, BankTxn, CalendarEntry, PlatformOrder
from seed.seed import CALENDAR

# seed -> cash held when the window opens, as a share of last year's honey bill (spread on purpose: some short, some not)
STRESS = {11: 0.7, 23: 0.9, 37: 1.05, 51: 0.8, 64: 1.2}
SEEDS = list(STRESS)
WINDOW_START = date(2025, 8, 1)
LEADS = list(range(7, 99, 7))  # days before the window opens
REPORT_LEAD = 21  # the demo story: about three weeks ahead
EVIDENCE = Path(__file__).resolve().parents[2] / "evidence" / "backtest_forecast.md"
PLATFORM = "集市平台 (模拟)"


def month_range(first=(2024, 1), last=(2025, 7)):
    y, m = first
    while (y, m) <= last:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def make_household(seed: int) -> dict:
    rng = random.Random(seed)
    n_sup = rng.randint(4, 8)
    base = [rng.uniform(2500, 6500) for _ in range(n_sup)]
    growth = {2024: 1.0, 2025: rng.uniform(0.9, 1.2)}
    sales = rng.uniform(10_000, 24_000)
    txns, orders = [], []  # txns: (ts, amount, direction, counterparty, channel, category, income_class)
    for year in (2024, 2025):
        for i in range(n_sup):
            for month in (8, 9):
                amt = round(base[i] * growth[year] * rng.uniform(0.8, 1.2), -1)
                txns.append((datetime(year, month, rng.randint(5, 25), 10), amt, "debit", f"供应商{i + 1}", "transfer", "supplier_honey", "other"))
    prev_total = sum(t[1] for t in txns if t[0].year == 2024)
    stress = STRESS[seed]
    # household spending set so the balance climbs back to about stress x last year's bill over the ~10 months after the 2024 season
    household = max(3000, round(sales * 0.994 + 246 - stress * prev_total / 10, -2))
    for y, m in month_range():
        gross = 0.0
        for k in range(6):
            amt = round(sales / 6 * rng.uniform(0.7, 1.3), 2)
            ts = datetime(y, m, rng.randint(1, 28), rng.randint(8, 22), rng.randint(0, 59))
            orders.append((f"BT{seed}-{y}{m:02d}-{k}", ts, amt))
            gross += amt
        last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
        txns.append((datetime(y, m, last, 10), round(gross * 0.994, 2), "credit", PLATFORM, "platform_payout", "sales", "other"))
        txns.append((datetime(y, m, 15, 9), 246.0, "credit", "社保养老金 (模拟)", "pension", "pension", "pension"))
        txns.append((datetime(y, m, 28, 18), float(household), "debit", "家庭支出 (模拟)", "card_payment", "household", "other"))
    txns.sort(key=lambda t: t[0])
    signed = lambda t: t[1] if t[2] == "credit" else -t[1]  # noqa: E731
    before = [t for t in txns if t[0].date() < WINDOW_START]
    run = low = 0.0
    for t in before:
        run += signed(t)
        low = min(low, run)
    opening = max(stress * prev_total - run, 1000 - low)
    actual = sum(t[1] for t in txns if t[5] == "supplier_honey" and t[0].year == 2025)
    return {"seed": seed, "n_sup": n_sup, "txns": txns, "orders": orders, "opening": round(opening, 2),
            "prev_total": prev_total, "actual": actual, "cash_at_start": round(opening + run, 2),
            "signed": signed}


def forecast_on(h: dict, day: date) -> dict:
    """Fresh DB holding only what was known before `day`, then the forecast as of `day`."""
    eng = make_engine("sqlite://")
    SQLModel.metadata.create_all(eng)
    known = [t for t in h["txns"] if t[0].date() < day]
    balance = round(h["opening"] + sum(h["signed"](t) for t in known), 2)
    with Session(eng) as s:
        s.add(BankCustomer(id=1, name=f"household-{h['seed']}", protection_mode=True))
        s.add(BankAccount(id=1, customer_id=1, balance=balance))
        for i in range(h["n_sup"]):
            s.add(BankPayee(customer_id=1, name=f"供应商{i + 1}", first_paid_at=datetime(2023, 1, 1)))
        s.add_all(BankTxn(account_id=1, ts=ts, amount=a, direction=d, counterparty=w, channel=ch, category=cat, income_class=inc)
                  for ts, a, d, w, ch, cat, inc in known)
        s.add_all(PlatformOrder(id=i, platform="marketplace", ts=ts, product="自家蜂蜜 500g", qty=1, amount=a, imported_at=ts)
                  for i, ts, a in h["orders"] if ts.date() < day)
        a, f, t_, c = CALENDAR[0]  # honey only
        s.add(CalendarEntry(activity=a, month_from=f, month_to=t_, typical_purchase=c))
        s.commit()
        return forecast_procurement(s, 1, today=day, horizon_days=120)


def evaluate(seed: int) -> dict:
    h = make_household(seed)
    runs = {lead: forecast_on(h, WINDOW_START - timedelta(days=lead)) for lead in LEADS}
    f = runs[REPORT_LEAD]
    mid = (f["amount_low"] + f["amount_high"]) / 2
    lead = max((L for L in LEADS if runs[L]["gap_high"] > 0), default=0)  # earliest day a gap warning was raised
    return {
        "seed": seed, "suppliers": h["n_sup"], "prev_total": h["prev_total"], "low": f["amount_low"], "high": f["amount_high"],
        "actual": h["actual"], "in_range": f["amount_low"] <= h["actual"] <= f["amount_high"],
        "error_pct": (mid - h["actual"]) / h["actual"] * 100, "cash_at_start": h["cash_at_start"],
        "true_gap": max(0.0, h["actual"] - h["cash_at_start"]), "gap_expected": f["gap_expected"], "gap_high": f["gap_high"],
        "warn_lead": lead,
    }


def run(write: bool = True) -> list[dict]:
    rows = [evaluate(s) for s in SEEDS]
    if write:
        EVIDENCE.parent.mkdir(exist_ok=True)
        EVIDENCE.write_text(report(rows), encoding="utf-8")
    return rows


def report(rows: list[dict]) -> str:
    fmt = lambda x: f"{x:,.0f}"  # noqa: E731
    lines = [
        "# Procurement forecast backtest (synthetic households)", "",
        f"Forecast of the Aug-Sep 2025 honey purchases, from data before the forecast day. Amount columns use a forecast made "
        f"{REPORT_LEAD} days before the window opens ({WINDOW_START}). Warning lead time = how many days before the window "
        f"the forecast's gap upper bound was first positive (checked every 7 days up to {LEADS[-1]}).", "",
        "| Household (seed) | Suppliers | Last year's bill | Forecast range | Actual | In range | Error of midpoint | "
        "Cash at window start | Real shortfall | Forecast gap (expected / upper) | Warning lead time |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lead = f"{r['warn_lead']} days" if r["warn_lead"] else "no warning"
        lines.append(
            f"| {r['seed']} | {r['suppliers']} | {fmt(r['prev_total'])} | {fmt(r['low'])} - {fmt(r['high'])} | {fmt(r['actual'])} | "
            f"{'yes' if r['in_range'] else 'no'} | {r['error_pct']:+.1f}% | {fmt(r['cash_at_start'])} | {fmt(r['true_gap'])} | "
            f"{fmt(r['gap_expected'])} / {fmt(r['gap_high'])} | {lead} |")
    short = [r for r in rows if r["true_gap"] > 0]
    warned = [r for r in short if r["warn_lead"] >= 7]
    lines += [
        "", f"- Actual inside the forecast range: {sum(r['in_range'] for r in rows)} of {len(rows)}.",
        f"- Mean absolute error of the midpoint: {sum(abs(r['error_pct']) for r in rows) / len(rows):.1f}%.",
        f"- Households with a real shortfall: {len(short)}; warned at least 7 days ahead: {len(warned)}.",
        f"- Warned although cash turned out enough: {sum(1 for r in rows if r['true_gap'] == 0 and r['warn_lead'])}.",
        "", "Caveat: the households are generated from the same kind of assumptions the forecaster makes (steady monthly "
        "payouts, pension and household spending; supplier bills that move up or down by up to about 20% between years). "
        "This shows the mechanics work; it is not evidence of accuracy on real farms.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    print(report(run()))
