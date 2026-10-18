import secrets
from difflib import SequenceMatcher
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app import clock, trace
from app.analysis import reconcile as recon
from app.audit import chain
from app.db import get_session
from app.mockbank import schemas as sc
from app.mockbank import service as svc
from app.mockbank.plan import plan_transfers
from app.models import BankApproval, BankCustomer, BankPayee, BankReserve, BankTxn, CosignRequest

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
    """Fuzzy search on name/aliases/phone/note: substring hit = 1.0, else best similarity >= 0.5 on name/aliases.
    0, 1 or several candidates; if anything matches exactly, only the exact matches are returned."""
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
            out.append({**p.model_dump(), "known": svc.payee_known(p), "score": round(score, 2)})
    if q and any(d["score"] == 1.0 for d in out):  # an exact hit is not ambiguous: drop look-alikes (老李 vs 老赵)
        out = [d for d in out if d["score"] == 1.0]
    return sorted(out, key=lambda d: -d["score"])


@router.get("/payouts")
def payouts(customer_id: int = 1, s: Session = Depends(get_session)):
    _, acct = svc.get_customer(s, customer_id)
    return s.exec(select(BankTxn).where(BankTxn.account_id == acct.id, BankTxn.channel == "platform_payout")
                  .order_by(BankTxn.ts.desc())).all()


# ---------- state changes (tiered) ----------
def _payee(s: Session, cust: BankCustomer, payee_id: int) -> BankPayee:
    payee = s.get(BankPayee, payee_id)
    if not payee or payee.customer_id != cust.id:
        raise HTTPException(404, "payee not found")
    return payee


@router.post("/transfers/readback")
def transfer_readback(body: sc.ReadbackIn, s: Session = Depends(get_session)):
    """The sentence read back to the customer before anything happens. A template, never an LLM."""
    cust, _ = svc.get_customer(s, body.customer_id)
    payee = _payee(s, cust, body.payee_id)
    return {"text_zh": svc.readback_zh(payee.name, body.spoken_as, body.amount, body.purpose),
            "payee_id": payee.id, "payee_name": payee.name, "amount": body.amount, "purpose": body.purpose}


@router.post("/transfers/plan")
def transfers_plan(body: sc.PlanIn, s: Session = Depends(get_session)):
    """Pay like last year: one item per supplier with its tier. Nothing is executed."""
    cust, acct = svc.get_customer(s, body.customer_id)
    result = plan_transfers(s, cust, acct, body.category, body.purpose)
    s.commit()
    return result


@router.post("/transfers")
def transfer(body: sc.TransferIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    payee = _payee(s, cust, body.payee_id)
    amount = float(round(body.amount, 2))
    payload = {"payee_id": payee.id, "amount": amount, "purpose": body.purpose}
    tier, ap, used = svc.gate(
        s, cust, "transfer", amount, payload, body.approval_token,
        payee_known=svc.payee_known(payee), daily_total=svc.daily_total(s, acct.id),
        usual_amount=svc.usual_amount(s, acct.id), balance=acct.balance,
    )
    if ap:
        s.commit()
        return _pending(ap)
    available = acct.balance - svc.reserved_total(s, cust.id)
    if amount > available:
        raise HTTPException(409, f"insufficient available funds ({available:.2f})")  # rolls back token use
    before = acct.balance
    acct.balance = round(before - amount, 2)
    now = clock.now()
    s.add(BankTxn(account_id=acct.id, ts=now, amount=amount, direction="debit", counterparty=payee.name,
                  channel="transfer", category="supplier", note_untrusted=body.purpose))
    payee.first_paid_at = payee.first_paid_at or now
    svc.audit_step(s, "transfer_executed", cust.id, ap=used, tier=tier, method=svc.method_of(used) if used else "none",
                   result="executed", balance_before=before, balance_after=acct.balance, payee_id=payee.id, amount=amount, purpose=body.purpose)
    s.commit()
    return {"status": "executed", "balance_before": before, "balance_after": acct.balance, "payee": payee.name,
            "amount": amount, "purpose": body.purpose}


@router.post("/reserves")
def create_reserve(body: sc.ReserveIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    payload = {"label": body.label, "amount": body.amount}
    payload["amount"] = float(round(body.amount, 2))
    tier, ap, used = svc.gate(s, cust, "reserve", body.amount, payload, body.approval_token, balance=acct.balance)
    if ap:
        s.commit()
        return _pending(ap)
    if body.amount > acct.balance - svc.reserved_total(s, cust.id):
        raise HTTPException(409, "insufficient available funds to reserve")
    r = BankReserve(customer_id=cust.id, label=body.label, amount=body.amount, created_at=clock.now())
    s.add(r)
    s.flush()
    svc.audit_step(s, "reserve_created", cust.id, ap=used, tier=tier, method=svc.method_of(used) if used else "none",
                   result="created", reserve_id=r.id, **payload)
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
def import_orders(body: sc.OrdersImportIn, platform: Literal["marketplace", "livestream"], customer_id: int = 1,
                  s: Session = Depends(get_session)):
    """Idempotent by order id. Not gated: platform data, not money movement (also allowed while locked).
    Notes and titles are untrusted: one that reads like an instruction is flagged and engages the safety lock."""
    cust, _ = svc.get_customer(s, customer_id)
    try:
        result = svc.import_orders_guarded(s, cust, platform, body.csv)
    except ValueError as e:
        raise HTTPException(422, str(e))
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
def _approval(s: Session, approval_id: int) -> BankApproval:
    svc.expire_stale(s)  # a co-sign request nobody answered in 5 minutes dies here
    ap = s.get(BankApproval, approval_id)
    if not ap:
        raise HTTPException(404, "approval not found")
    trace.adopt(ap.trace_id)  # every later step of an approval joins the trace it started in
    return ap


@router.get("/approvals/{approval_id}")
def get_approval(approval_id: int, s: Session = Depends(get_session)):
    ap = _approval(s, approval_id)
    s.commit()  # persists an expiry
    return svc.approval_view(ap)


@router.post("/approvals/{approval_id}/confirm")
def confirm_approval(approval_id: int, s: Session = Depends(get_session)):
    """The customer says "yes" to the read-back. Yellow is then approved; red goes on to PIN (and co-sign)."""
    ap = _approval(s, approval_id)
    cust, _ = svc.get_customer(s, ap.customer_id)
    svc.ensure_unlocked(cust)
    if ap.status != "pending":
        raise HTTPException(409, f"approval is {ap.status}")
    ap.confirmed = True
    svc.maybe_approve(ap)
    s.add(ap)
    svc.audit_step(s, "confirmed", cust.id, ap=ap, method="confirm", result=ap.status)
    s.commit()
    return svc.approval_view(ap)


@router.post("/approvals/{approval_id}/cancel")
def cancel_approval(approval_id: int, s: Session = Depends(get_session)):
    """"不对，取消": nothing executes, nothing changes."""
    ap = _approval(s, approval_id)
    if ap.status != "pending":
        raise HTTPException(409, f"approval is {ap.status}")
    ap.status = "declined"
    s.add(ap)
    for cr in s.exec(select(CosignRequest).where(CosignRequest.approval_id == ap.id, CosignRequest.status == "pending")):
        cr.status, cr.decided_at = "declined", clock.now()
        s.add(cr)
    svc.audit_step(s, "cancelled", ap.customer_id, ap=ap, method="customer", result="cancelled")
    s.commit()
    return svc.approval_view(ap)


@router.post("/auth/mfa/challenge")
def mfa_challenge(body: sc.MfaChallengeIn, s: Session = Depends(get_session)):
    ap = _approval(s, body.approval_id)
    if ap.status != "pending" or not ap.confirmed or ap.tier != "red":
        raise HTTPException(409, "a PIN is only asked for a confirmed red approval")
    ap.challenge = secrets.token_hex(4)
    s.add(ap)
    s.commit()
    return {"approval_id": ap.id, "challenge": ap.challenge, "method": "pin6"}


@router.post("/auth/mfa/verify")
def mfa_verify(body: sc.MfaVerifyIn, s: Session = Depends(get_session)):
    ap = _approval(s, body.approval_id)
    if ap.status != "pending" or not ap.challenge or not secrets.compare_digest(ap.challenge, body.challenge):
        raise HTTPException(404, "no matching pending challenge")
    cust = s.get(BankCustomer, ap.customer_id)
    if err := svc.verify_pin(s, cust, body.pin):
        return err
    ap.pin_ok = True
    s.add(ap)
    svc.audit_step(s, "pin_verified", cust.id, ap=ap, method="pin", result="ok")
    if ap.requires_cosigner and ap.cosign == "none":
        svc.request_cosign(s, cust, ap)  # the co-signer is only asked once the customer's own PIN is right
    svc.maybe_approve(ap)
    s.commit()
    return svc.approval_view(ap)


# ---------- safety lock ----------
@router.post("/security/lock")
def lock(body: sc.LockIn, s: Session = Depends(get_session)):
    cust, _ = svc.get_customer(s, body.customer_id)
    svc.engage_lock(s, cust, "manual")
    s.commit()
    return {"locked": True}


@router.get("/security/status")
def security_status(customer_id: int = 1, s: Session = Depends(get_session)):
    """For the app's warning card. Open while locked: reads are always allowed."""
    cust, _ = svc.get_customer(s, customer_id)
    return {"locked": cust.locked, "reason": cust.lock_reason if cust.locked else "", "message_zh": svc.lock_message(cust) if cust.locked else ""}


@router.post("/security/unlock")
def unlock(body: sc.UnlockIn, s: Session = Depends(get_session)):
    """Red tier; always needs the co-signer (a locked customer cannot enter a PIN)."""
    cust, acct = svc.get_customer(s, body.customer_id)
    if not cust.locked:
        raise HTTPException(409, "not locked")
    tier, ap, used = svc.gate(s, cust, "unlock", 0.0, {"customer_id": cust.id}, body.approval_token)
    if ap:
        s.commit()
        return _pending(ap)
    cust.locked, cust.failed_pins, cust.lock_reason = False, 0, ""
    s.add(cust)
    svc.audit_step(s, "unlocked", cust.id, ap=used, tier=tier, method=svc.method_of(used) if used else "none", result="unlocked")
    s.commit()
    return {"locked": False}
