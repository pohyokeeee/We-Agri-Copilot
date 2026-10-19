"""Standing reserve rules (E14b): "move 1% of every resale payout into a tax pot".

Setting a rule up is 🟡 (read-back + confirm). After that the rule runs by itself whenever a payout tagged "resale" arrives.
The pot is an earmark like any reserve: the balance stays, the available money shrinks by exactly the percentage.
"""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import clock
from app.db import get_session
from app.mockbank import service as svc
from app.models import AgentAudit, BankAccount, BankCustomer, BankReserve, BankTxn, PlatformOrder, ReserveRule

router = APIRouter(prefix="/bank", tags=["reserve rules (simulated)"])
SAMPLES = Path(__file__).resolve().parents[2] / "seed" / "orders"
POT_LABEL = "税金预留"
SOURCE = "resale_payout"


class ReserveRuleIn(BaseModel):
    customer_id: int = 1
    percent: float = Field(0.01, gt=0, le=0.2)  # 0.01 = 1%
    approval_token: str | None = None


class DemoPayoutIn(BaseModel):
    customer_id: int = 1
    amount: float = Field(8000.0, gt=0, le=1_000_000)
    income_class: Literal["resale", "own_produce", "other"] = "resale"


def pot_total(s: Session, customer_id: int) -> float:
    rows = s.exec(select(BankReserve).where(BankReserve.customer_id == customer_id, BankReserve.label == POT_LABEL,
                                            BankReserve.status == "active"))
    return round(sum(r.amount for r in rows), 2)


def apply_reserve_rules(s: Session, cust: BankCustomer, acct: BankAccount, txn: BankTxn) -> list[dict]:
    """Call this for every payout that arrives. Only resale-tagged platform payouts move anything."""
    if txn.direction != "credit" or txn.channel != "platform_payout" or txn.income_class != "resale":
        return []
    moved = []
    for rule in s.exec(select(ReserveRule).where(ReserveRule.customer_id == cust.id, ReserveRule.status == "active",
                                                  ReserveRule.source == SOURCE)):
        amount = round(txn.amount * rule.percent, 2)
        if amount <= 0:
            continue
        pot_before, free_before = pot_total(s, cust.id), round(acct.balance - svc.reserved_total(s, cust.id), 2)
        s.add(BankReserve(customer_id=cust.id, label=POT_LABEL, amount=amount, created_at=clock.now()))
        s.flush()
        pot_after, free_after = pot_total(s, cust.id), round(acct.balance - svc.reserved_total(s, cust.id), 2)
        svc.audit_step(s, "tax_reserve_moved", cust.id, actor=f"reserve rule #{rule.id}", method="rule", result=f"moved {amount:g} to the tax pot",
                       balance_before=acct.balance, balance_after=acct.balance, payout_id=txn.id, payout_amount=txn.amount,
                       percent=rule.percent, moved=amount, pot_before=pot_before, pot_after=pot_after,
                       available_before=free_before, available_after=free_after)
        moved.append({"rule_id": rule.id, "moved": amount, "pot_total": pot_after})
    return moved


@router.post("/reserves/rules")
def create_rule(body: ReserveRuleIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    payload = {"percent": float(body.percent), "source": SOURCE, "pot": POT_LABEL}
    tier, ap, used = svc.gate(s, cust, "reserve_rule", 0.0, payload, body.approval_token, balance=acct.balance)
    if ap:
        s.commit()
        readback = f"设一条规矩：以后每收到一笔转卖货款，就自动把 {body.percent * 100:g}% 留出来做税金。只是留出来，不转走，对吗？"
        return JSONResponse(status_code=202, content={**svc.approval_view(ap), "readback_zh": readback})
    rule = ReserveRule(customer_id=cust.id, percent=body.percent, source=SOURCE, created_at=clock.now())
    s.add(rule)
    s.flush()
    svc.audit_step(s, "reserve_rule_created", cust.id, ap=used, tier=tier, method=svc.method_of(used) if used else "none",
                   result="rule created", rule_id=rule.id, percent=rule.percent)
    s.commit()
    return {"status": "created", "rule_id": rule.id, "percent": rule.percent}


@router.get("/reserves/rules")
def list_rules(customer_id: int = 1, s: Session = Depends(get_session)):
    svc.get_customer(s, customer_id)
    rules = s.exec(select(ReserveRule).where(ReserveRule.customer_id == customer_id, ReserveRule.status == "active")).all()
    return {"rules": [{"rule_id": r.id, "percent": r.percent, "source": r.source} for r in rules], "pot_total": pot_total(s, customer_id)}


@router.delete("/reserves/rules/{rule_id}")
def stop_rule(rule_id: int, customer_id: int = 1, s: Session = Depends(get_session)):
    """Undo of our own rule, so no approval gate. What it already put in the pot stays there."""
    cust, _ = svc.get_customer(s, customer_id)
    svc.ensure_unlocked(cust)
    rule = s.get(ReserveRule, rule_id)
    if not rule or rule.customer_id != cust.id or rule.status != "active":
        raise HTTPException(404, "active rule not found")
    rule.status = "stopped"
    s.add(rule)
    svc.audit_step(s, "reserve_rule_stopped", cust.id, method="customer", result="rule stopped", rule_id=rule.id)
    s.commit()
    return {"status": "stopped"}


# ---------- demo: the outside world, so the rule can be shown live ----------
@router.post("/demo/payouts")
def demo_payout(body: DemoPayoutIn, s: Session = Depends(get_session)):
    """Simulate ONE new platform payout (resale by default). Not an approval-gated action: it stands for money arriving."""
    cust, acct = svc.get_customer(s, body.customer_id)
    before = acct.balance
    free_before = round(before - svc.reserved_total(s, cust.id), 2)
    acct.balance = round(before + body.amount, 2)
    txn = BankTxn(account_id=acct.id, ts=clock.now(), amount=float(round(body.amount, 2)), direction="credit",
                  counterparty="集市平台 (模拟)", channel="platform_payout", category="sales", income_class=body.income_class)
    s.add(txn)
    s.flush()
    svc.audit_step(s, "payout_received", cust.id, actor="platform (demo)", method="demo", result="credited",
                   balance_before=before, balance_after=acct.balance, payout_id=txn.id, amount=txn.amount, income_class=txn.income_class)
    moved = apply_reserve_rules(s, cust, acct, txn)
    s.commit()
    return {"payout_id": txn.id, "amount": txn.amount, "income_class": txn.income_class, "balance_before": before,
            "balance_after": acct.balance, "moved": sum(m["moved"] for m in moved), "pot_total": pot_total(s, cust.id),
            "available_before": free_before, "available_after": round(acct.balance - svc.reserved_total(s, cust.id), 2)}


@router.post("/demo/payouts/{payout_id}/apply-reserve-rules")
def demo_apply_reserve_rules(payout_id: int, customer_id: int = 1, s: Session = Depends(get_session)):
    """The rule was switched on (and approved) AFTER this payout arrived: let it act on this payout, once.
    With no active rule nothing moves."""
    cust, acct = svc.get_customer(s, customer_id)
    svc.ensure_unlocked(cust)
    txn = s.get(BankTxn, payout_id)
    if not txn or txn.account_id != acct.id:
        raise HTTPException(404, "payout not found")
    if any(r.payload.get("payout_id") == payout_id for r in s.exec(select(AgentAudit).where(AgentAudit.event == "tax_reserve_moved"))):
        raise HTTPException(409, "the rule has already acted on this payout")
    free_before = round(acct.balance - svc.reserved_total(s, cust.id), 2)
    moved = apply_reserve_rules(s, cust, acct, txn)
    s.commit()
    return {"payout_id": txn.id, "amount": txn.amount, "balance_before": acct.balance, "balance_after": acct.balance,
            "moved": sum(m["moved"] for m in moved), "pot_total": pot_total(s, cust.id),
            "available_before": free_before, "available_after": round(acct.balance - svc.reserved_total(s, cust.id), 2)}


@router.post("/demo/orders/import-sample")
def demo_import_sample(platform: Literal["marketplace", "livestream"] = "livestream", customer_id: int = 1,
                       s: Session = Depends(get_session)):
    """Import the sample export shipped in seed/orders (the livestream one carries the planted injection note)."""
    cust, _ = svc.get_customer(s, customer_id)
    result = svc.import_orders_guarded(s, cust, platform, (SAMPLES / f"{platform}_sample.csv").read_text(encoding="utf-8"))
    s.commit()
    return result


@router.post("/demo/orders/import-suspicious")
def demo_import_suspicious(customer_id: int = 1, s: Session = Depends(get_session)):
    """A NEW marketplace order every call (fresh id) whose buyer note reads like an instruction. It goes through the normal
    import -> injection detector -> safety lock path; nothing here acts on the note."""
    from seed.seed import INJECTION  # the same planted sentence as the seed data

    cust, _ = svc.get_customer(s, customer_id)
    n = len(s.exec(select(PlatformOrder.id).where(PlatformOrder.id.like("MK-S%"))).all()) + 1
    when = clock.now().isoformat(timespec="seconds")
    csv_text = f'order_id,paid_at,product,qty,amount,buyer_note\nMK-S{n:04d},{when},自家蜂蜜 500g,1,88,"{INJECTION}"\n'
    result = svc.import_orders_guarded(s, cust, "marketplace", csv_text)
    s.commit()
    return result
