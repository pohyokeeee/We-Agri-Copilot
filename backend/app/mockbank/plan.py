"""POST /bank/transfers/plan: "pay the six suppliers like last year". A plan only: nothing is executed here."""
import statistics

from fastapi import HTTPException
from sqlmodel import Session, select

from app import clock
from app.analysis.history import _history, _next_window
from app.mockbank.service import audit_step, payee_known, reasons_zh, usual_amount
from app.models import BankAccount, BankCustomer, BankPayee, CalendarEntry
from app.risk.tiers import classify


def plan_transfers(s: Session, cust: BankCustomer, acct: BankAccount, category: str, purpose: str) -> dict:
    """One item per supplier paid last year in the same window: the amount of their typical single payment, how many
    times, and the tier that payment would get. Audited; caller commits."""
    entry = s.exec(select(CalendarEntry).where(CalendarEntry.typical_purchase == category)).first()
    if not entry:
        raise HTTPException(404, f"no calendar entry for {category}")
    today = clock.today()
    start, end = _next_window(entry, today)
    by, last, years = _history(s, acct.id, entry, start, end)
    payees = {p.name: p for p in s.exec(select(BankPayee).where(BankPayee.customer_id == cust.id))}
    usual = usual_amount(s, acct.id)
    items = []
    for name, pays in by.items():
        p = payees.get(name)
        amount, times = round(statistics.median(pays), 2), max(1, round(len(pays) / years))
        # each payment is made on its own delivery day, so the day's running total starts at 0
        t = classify("transfer", now=clock.now(), amount=amount, payee_known=payee_known(p, today), daily_total=0.0,
                     usual_amount=usual, balance=acct.balance, protection_mode=cust.protection_mode)
        items.append({
            "payee_id": p.id if p else None, "name": name, "amount": amount, "times": times,
            "last_year_total": round(last.get(name, 0.0), 2), "purpose": purpose,
            "tier_base": t["base_tier"], "tier": t["final_tier"], "reasons": t["reasons"], "reasons_zh": reasons_zh(t["reasons"]),
            "requires_cosigner": t["requires_cosigner"],
        })
    items.sort(key=lambda x: -x["last_year_total"])
    result = {"customer_id": cust.id, "category": category, "purpose": purpose, "window_start": start.isoformat(),
              "window_end": end.isoformat(), "items": items, "total": round(sum(i["amount"] * i["times"] for i in items), 2),
              "executed": False}
    audit_step(s, "transfer_plan", cust.id, method="none", result="planned (nothing executed)", items=[
        {"name": i["name"], "amount": i["amount"], "tier_base": i["tier_base"], "tier_final": i["tier"], "reasons": i["reasons"]}
        for i in items])
    return result
