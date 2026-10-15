"""Sales record: import platform orders, match them to bank payouts, tag income_class.

Deterministic only. Orders have no customer_id (single-merchant mock), so every order is the customer's.
"""
import csv
import io
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from sqlmodel import Session, select

from app import clock
from app.analysis.common import period_bounds, shift_months
from app.audit import chain
from app.models import BankAccount, BankTxn, PlatformOrder

CLASSES = ("own_produce", "resale", "processed", "needs_confirmation")
CATALOG = json.loads((Path(__file__).resolve().parents[2] / "seed" / "product_catalog.json").read_text(encoding="utf-8"))

PAYOUT_KEYWORD = {"marketplace": "集市", "livestream": "直播"}  # text in that platform's payout counterparty
FEE_RATIO = (0.95, 1.0)  # payout / gross sales of the month; wider than the real fee so a late order still matches
LATE_DAYS = 7  # a payout may land this long after month end


# ---- one adapter per platform CSV style -> one common schema {id, ts, product, qty, amount, note} ----
def _marketplace(r: dict) -> dict:
    return {"id": r["order_id"], "ts": r["paid_at"], "product": r["product"], "qty": r["qty"],
            "amount": r["amount"], "note": r["buyer_note"]}


def _livestream(r: dict) -> dict:
    return {"id": r["订单编号"], "ts": r["下单时间"], "product": r["商品"], "qty": r["数量"],
            "amount": r["实付金额"], "note": r["买家留言"]}


ADAPTERS = {"marketplace": _marketplace, "livestream": _livestream}


def import_orders(s: Session, platform: str, text: str) -> dict:
    """Idempotent by order id. Buyer notes are stored verbatim as untrusted data and never interpreted.
    Raises ValueError with the CSV line number on a bad row."""
    new = skipped = 0
    for line, row in enumerate(csv.DictReader(io.StringIO(text.lstrip("﻿"))), start=2):
        try:
            c = ADAPTERS[platform](row)
            order = PlatformOrder(
                id=c["id"].strip(), platform=platform, ts=datetime.fromisoformat(c["ts"].strip()),
                product=c["product"].strip(), qty=int(c["qty"]), amount=float(c["amount"]),
                buyer_note_untrusted=c["note"] or "", imported_at=clock.now())
        except (KeyError, ValueError, AttributeError) as e:
            raise ValueError(f"bad {platform} CSV at line {line}: {e!r}")
        if s.get(PlatformOrder, order.id):
            skipped += 1
        else:
            s.add(order)
            s.flush()
            new += 1
    return {"platform": platform, "new": new, "skipped": skipped}


def tag(product: str) -> str | None:
    """own_produce / resale / processed from the catalog; None when no rule or conflicting rules match."""
    hits = {c["income_class"] for c in CATALOG if c["match"] in product}
    return hits.pop() if len(hits) == 1 else None


def _match(s: Session, customer_id: int, orders: list[PlatformOrder]) -> tuple[dict, float]:
    """Monthly batch match: one payout per (platform, month) whose amount is 95-100% of that month's sales.
    ponytail: batch not per-order; a missing/extra order under ~5% of the month hides inside the tolerance."""
    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).one()
    payouts = s.exec(select(BankTxn).where(BankTxn.account_id == acct.id, BankTxn.channel == "platform_payout",
                                           BankTxn.direction == "credit")).all()
    groups = defaultdict(list)
    for o in orders:
        groups[(o.platform, o.ts.year, o.ts.month)].append(o)
    used, matched, fees = set(), {}, 0.0
    for (platform, y, m), grp in sorted(groups.items()):
        gross = round(sum(o.amount for o in grp), 2)
        lo = datetime(y, m, 1)
        hi = shift_months(lo, 1) + timedelta(days=LATE_DAYS)
        hit = next((p for p in payouts if p.id not in used and PAYOUT_KEYWORD[platform] in p.counterparty
                    and lo <= p.ts < hi and gross > 0 and FEE_RATIO[0] <= p.amount / gross <= FEE_RATIO[1]), None)
        for o in grp:
            matched[o.id] = hit.id if hit else None
        if hit:
            used.add(hit.id)
            fees += gross - hit.amount
    return matched, round(fees, 2)


def reconcile_range(s: Session, customer_id: int, start: datetime, end: datetime) -> dict:
    """Every positive order lands in exactly one bucket, first rule wins:
    needs_confirmation (unknown product) > missed_payout > resale > record (own_produce/processed).
    reported = record + resale + missed_payout + needs_confirmation; gap = reported - record_total,
    where record_total is net of refunds (negative orders), so gap = resale + refunds + missed + needs_confirmation."""
    orders = s.exec(select(PlatformOrder).where(PlatformOrder.ts >= start, PlatformOrder.ts < end)).all()
    matched, fees = _match(s, customer_id, orders)
    by_class = dict.fromkeys(CLASSES, 0.0)
    gap = {"resale": 0.0, "refunds": 0.0, "missed_payout": 0.0, "needs_confirmation": 0.0}
    unknown = defaultdict(lambda: [0, 0.0])
    reported = record = 0.0
    for o in orders:
        if o.amount < 0:
            gap["refunds"] += -o.amount
            continue
        reported += o.amount
        cls = tag(o.product)
        by_class[cls or "needs_confirmation"] += o.amount
        if cls is None:
            gap["needs_confirmation"] += o.amount
            unknown[o.product][0] += 1
            unknown[o.product][1] += o.amount
        elif matched[o.id] is None:
            gap["missed_payout"] += o.amount
        elif cls == "resale":
            gap["resale"] += o.amount
        else:
            record += o.amount
    record_total = record - gap["refunds"]
    r = lambda d: {k: round(v, 2) for k, v in d.items()}  # noqa: E731
    return {
        "platform_reported": round(reported, 2), "record_total": round(record_total, 2),
        "gap": round(reported - record_total, 2), "gap_breakdown": r(gap), "by_class": r(by_class),
        "platform_fees": fees, "orders": len(orders),
        "needs_confirmation": [{"product": p, "orders": c, "amount": round(a, 2)} for p, (c, a) in sorted(unknown.items())],
    }


def reconcile(s: Session, customer_id: int, period: str) -> dict:
    """period 'YYYY-Qn'. Audited; caller commits."""
    start, end = period_bounds(period)
    result = {"period": period, **reconcile_range(s, customer_id, start, end)}
    chain.append(s, "analysis", "income_reconciled", {"customer_id": customer_id, "period": period,
                 "gap": result["gap"], "gap_breakdown": result["gap_breakdown"]})
    return result


def monthly_class_totals(s: Session, start: datetime, end: datetime) -> dict[str, dict]:
    """{'2026-04': {own_produce, resale, processed, needs_confirmation}} over positive orders, rounded to fen."""
    out: dict[str, dict] = defaultdict(lambda: dict.fromkeys(CLASSES, 0.0))
    for o in s.exec(select(PlatformOrder).where(PlatformOrder.ts >= start, PlatformOrder.ts < end)):
        if o.amount > 0:
            out[f"{o.ts.year}-{o.ts.month:02d}"][tag(o.product) or "needs_confirmation"] += o.amount
    return {m: {k: round(v, 2) for k, v in c.items()} for m, c in sorted(out.items())}


def income_statement(s: Session, customer_id: int, year: int) -> dict:
    """Sales by month and class from platform orders, plus pension and payouts received. Audited; caller commits."""
    start, end = datetime(year, 1, 1), datetime(year + 1, 1, 1)
    months = monthly_class_totals(s, start, end)
    totals = {c: round(sum(m[c] for m in months.values()), 2) for c in CLASSES}
    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).one()
    txns = s.exec(select(BankTxn).where(BankTxn.account_id == acct.id, BankTxn.direction == "credit",
                                        BankTxn.ts >= start, BankTxn.ts < end)).all()
    result = {
        "year": year,
        "months": [{"month": m, **c, "total": round(sum(c.values()), 2)} for m, c in months.items()],
        "totals": {**totals, "total": round(sum(totals.values()), 2)},
        "pension": round(sum(t.amount for t in txns if t.income_class == "pension"), 2),
        "payouts_received": round(sum(t.amount for t in txns if t.channel == "platform_payout"), 2),
    }
    chain.append(s, "analysis", "income_statement", {"customer_id": customer_id, "year": year, "totals": result["totals"]})
    return result


def detect_anomalies(session: Session, customer_id: int) -> list[dict]:
    """Flag duplicate charges and unusual (night / new payee) payments. Returns [{kind, txn_ids, reason}]."""
    # TODO: seed plants one duplicate card charge and one night payment to a new payee
    raise NotImplementedError
