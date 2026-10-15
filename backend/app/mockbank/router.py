import secrets
from difflib import SequenceMatcher
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app import clock
from app.analysis import reconcile as recon
from app.audit import chain
from app.db import get_session
from app.mockbank import schemas as sc
from app.mockbank import service as svc
from app.models import BankApproval, BankCustomer, BankPayee, BankReserve, BankTxn

router = APIRouter(prefix="/bank", tags=["mock bank (simulated)"])

def _pending(ap: BankApproval) -> JSONResponse:
    return JSONResponse(status_code=202, content=svc.approval_view(ap))


# ---------- reads (green) ----------
@router.get("/balance")
def balance(customer_id: int = 1, s: Session = Depends(get_session)):
    _, acct = svc.get_customer(s, customer_id)
    reserved = svc.reserved_total(s, customer_id)
    return {"account_id": acct.id, "balance": acct.balance, "reserved": reserved,
            "available": round(acct.balance - reserved, 2)}


@router.get("/transactions")
def transactions(customer_id: int = 1, limit: int = 50, s: Session = Depends(get_session)):
    _, acct = svc.get_customer(s, customer_id)
    return s.exec(select(BankTxn).where(BankTxn.account_id == acct.id).order_by(BankTxn.ts.desc()).limit(limit)).all()


@router.get("/payees")
def payees(customer_id: int = 1, q: str | None = None, s: Session = Depends(get_session)):
    """Fuzzy search on name/aliases/phone/note: substring hit = 1.0, else best similarity >= 0.5 on name/aliases."""
    out = []
    for p in s.exec(select(BankPayee).where(BankPayee.customer_id == customer_id)):
        names = [p.name, *p.aliases]
        if not q:
            score = 1.0
        elif any(q.lower() in f.lower() for f in [*names, p.phone, p.note]):
            score = 1.0
        else:
            score = max(SequenceMatcher(None, q.lower(), n.lower()).ratio() for n in names)
        if score >= 0.5:
            out.append({**p.model_dump(), "known": p.first_paid_at is not None, "score": round(score, 2)})
    return sorted(out, key=lambda d: -d["score"])


@router.get("/payouts")
def payouts(customer_id: int = 1, s: Session = Depends(get_session)):
    _, acct = svc.get_customer(s, customer_id)
    return s.exec(select(BankTxn).where(BankTxn.account_id == acct.id, BankTxn.channel == "platform_payout")
                  .order_by(BankTxn.ts.desc())).all()


# ---------- state changes (tiered) ----------
@router.post("/transfers")
def transfer(body: sc.TransferIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    payee = s.get(BankPayee, body.payee_id)
    if not payee or payee.customer_id != cust.id:
        raise HTTPException(404, "payee not found")
    payload = {"payee_id": payee.id, "amount": body.amount}
    tier, ap = svc.gate(
        s, cust, "transfer", body.amount, payload, body.approval_token,
        payee_known=payee.first_paid_at is not None, daily_total=svc.daily_total(s, acct.id),
        usual_amount=svc.usual_amount(s, acct.id), balance=acct.balance,
    )
    if ap:
        s.commit()
        return _pending(ap)
    available = acct.balance - svc.reserved_total(s, cust.id)
    if body.amount > available:
        raise HTTPException(409, f"insufficient available funds ({available:.2f})")  # rolls back token use
    before = acct.balance
    acct.balance = round(before - body.amount, 2)
    now = clock.now()
    s.add(BankTxn(account_id=acct.id, ts=now, amount=body.amount, direction="debit", counterparty=payee.name,
                  channel="transfer", category="supplier"))
    payee.first_paid_at = payee.first_paid_at or now
    chain.append(s, "mockbank", "transfer_executed", {**payload, "tier": tier["final_tier"],
                 "balance_before": before, "balance_after": acct.balance})
    s.commit()
    return {"status": "executed", "balance_before": before, "balance_after": acct.balance}


@router.post("/reserves")
def create_reserve(body: sc.ReserveIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    payload = {"label": body.label, "amount": body.amount}
    tier, ap = svc.gate(s, cust, "reserve", body.amount, payload, body.approval_token, balance=acct.balance)
    if ap:
        s.commit()
        return _pending(ap)
    if body.amount > acct.balance - svc.reserved_total(s, cust.id):
        raise HTTPException(409, "insufficient available funds to reserve")
    r = BankReserve(customer_id=cust.id, label=body.label, amount=body.amount, created_at=clock.now())
    s.add(r)
    s.flush()
    chain.append(s, "mockbank", "reserve_created", {"reserve_id": r.id, **payload, "tier": tier["final_tier"],
                 "balance_before": acct.balance, "balance_after": acct.balance})
    s.commit()
    return {"status": "created", "reserve_id": r.id}


@router.delete("/reserves/{reserve_id}")
def release_reserve(reserve_id: int, customer_id: int = 1, s: Session = Depends(get_session)):
    # Undo of our own earmark (saga rollback), so no approval gate; still blocked while locked and always audited.
    cust, acct = svc.get_customer(s, customer_id)
    svc.ensure_unlocked(cust)
    r = s.get(BankReserve, reserve_id)
    if not r or r.customer_id != cust.id or r.status != "active":
        raise HTTPException(404, "active reserve not found")
    r.status = "released"
    chain.append(s, "mockbank", "reserve_released", {"reserve_id": r.id, "amount": r.amount,
                 "balance_before": acct.balance, "balance_after": acct.balance})
    s.commit()
    return {"status": "released"}


@router.post("/orders/import")
def import_orders(body: sc.OrdersImportIn, platform: Literal["marketplace", "livestream"], s: Session = Depends(get_session)):
    """Idempotent by order id. Not gated: platform data, not money movement (also allowed while locked)."""
    try:
        result = recon.import_orders(s, platform, body.csv)
    except ValueError as e:
        raise HTTPException(422, str(e))
    chain.append(s, "mockbank", "orders_imported", result)
    s.commit()
    return result


@router.get("/income/statement")
def income_statement(year: int, customer_id: int = 1, s: Session = Depends(get_session)):
    svc.get_customer(s, customer_id)
    result = recon.income_statement(s, customer_id, year)
    s.commit()
    return result


@router.get("/income/reconcile")
def income_reconcile(period: str, customer_id: int = 1, s: Session = Depends(get_session)):
    svc.get_customer(s, customer_id)
    try:
        result = recon.reconcile(s, customer_id, period)
    except ValueError as e:
        raise HTTPException(422, str(e))
    s.commit()
    return result


# ---------- auth / approvals ----------
@router.post("/auth/mfa/challenge")
def mfa_challenge(body: sc.MfaChallengeIn, s: Session = Depends(get_session)):
    ap = s.get(BankApproval, body.approval_id)
    if not ap or ap.status != "pending":
        raise HTTPException(404, "no pending approval")
    ap.challenge = secrets.token_hex(4)
    s.add(ap)
    s.commit()
    return {"approval_id": ap.id, "challenge": ap.challenge, "method": "pin6"}


def _check_pin(s: Session, who: BankCustomer, pin: str):
    """None if PIN ok; else a JSONResponse (failure already committed so the counter/lock persist)."""
    if who.locked:
        raise HTTPException(423, "account is locked")
    if svc.check_pin(pin, who.pin_hash):
        who.failed_pins = 0
        s.add(who)
        return None
    locked = svc.record_pin_failure(s, who)
    s.commit()
    return JSONResponse(status_code=423 if locked else 401,
                        content={"detail": "locked after 3 wrong PINs" if locked else "wrong PIN", "locked": locked})


@router.post("/auth/mfa/verify")
def mfa_verify(body: sc.MfaVerifyIn, s: Session = Depends(get_session)):
    ap = s.get(BankApproval, body.approval_id)
    if not ap or ap.status != "pending" or not ap.challenge or not secrets.compare_digest(ap.challenge, body.challenge):
        raise HTTPException(404, "no matching pending challenge")
    if err := _check_pin(s, s.get(BankCustomer, ap.customer_id), body.pin):
        return err
    ap.pin_ok = True
    svc.maybe_approve(ap)
    s.add(ap)
    chain.append(s, "mockbank", "pin_verified", {"approval_id": ap.id, "status": ap.status})
    s.commit()
    return svc.approval_view(ap)


@router.get("/approvals")
def pending_for_cosigner(cosigner_id: int, s: Session = Depends(get_session)):
    rows = s.exec(select(BankApproval).join(BankCustomer, BankCustomer.id == BankApproval.customer_id).where(
        BankCustomer.cosigner_id == cosigner_id, BankApproval.status == "pending",
        BankApproval.requires_cosigner == True, BankApproval.cosign == "pending"))  # noqa: E712
    return [svc.approval_view(a) for a in rows]


@router.get("/approvals/{approval_id}")
def get_approval(approval_id: int, s: Session = Depends(get_session)):
    ap = s.get(BankApproval, approval_id)
    if not ap:
        raise HTTPException(404, "approval not found")
    return svc.approval_view(ap)


@router.post("/approvals/{approval_id}/cosign")
def cosign(approval_id: int, body: sc.CosignIn, s: Session = Depends(get_session)):
    ap = s.get(BankApproval, approval_id)
    cust = ap and s.get(BankCustomer, ap.customer_id)
    if not ap or ap.status != "pending" or not ap.requires_cosigner:
        raise HTTPException(404, "no pending approval needing a co-signer")
    if cust.cosigner_id != body.cosigner_id:
        raise HTTPException(403, "not this customer's co-signer")
    if err := _check_pin(s, s.get(BankCustomer, body.cosigner_id), body.pin):
        return err
    ap.cosign = "approved" if body.approve else "declined"
    if not body.approve:
        ap.status = "declined"
    svc.maybe_approve(ap)
    s.add(ap)
    chain.append(s, "mockbank", "cosigned", {"approval_id": ap.id, "cosigner_id": body.cosigner_id, "cosign": ap.cosign})
    s.commit()
    return svc.approval_view(ap)


# ---------- safety lock ----------
@router.post("/security/lock")
def lock(body: sc.LockIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    cust.locked = True
    s.add(cust)
    chain.append(s, "mockbank", "locked", {"customer_id": cust.id, "balance_before": acct.balance, "balance_after": acct.balance})
    s.commit()
    return {"locked": True}


@router.post("/security/unlock")
def unlock(body: sc.UnlockIn, s: Session = Depends(get_session)):
    """Red tier; always needs the co-signer (a locked customer cannot enter a PIN)."""
    cust, acct = svc.get_customer(s, body.customer_id)
    if not cust.locked:
        raise HTTPException(409, "not locked")
    _, ap = svc.gate(s, cust, "unlock", 0.0, {"customer_id": cust.id}, body.approval_token)
    if ap:
        s.commit()
        return _pending(ap)
    cust.locked, cust.failed_pins = False, 0
    s.add(cust)
    chain.append(s, "mockbank", "unlocked", {"customer_id": cust.id, "balance_before": acct.balance, "balance_after": acct.balance})
    s.commit()
    return {"locked": False}
