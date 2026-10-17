"""Co-signer endpoints: the daughter sees what her father wants to do, and approves or declines.
Decline or timeout (5 minutes) executes nothing and changes no state."""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app import clock
from app.db import get_session
from app.mockbank import schemas as sc
from app.mockbank import service as svc
from app.models import BankApproval, BankCustomer, CosignRequest

router = APIRouter(prefix="/cosign", tags=["co-signer"])


def _view(c: CosignRequest) -> dict:
    left = max(0, int((c.created_at + svc.COSIGN_TTL - clock.now()).total_seconds()))
    return {"id": c.id, "approval_id": c.approval_id, "customer_id": c.customer_id, "summary_zh": c.summary_zh,
            "reasons": c.reasons, "reasons_zh": svc.reasons_zh(c.reasons), "status": c.status,
            "created_at": c.created_at.isoformat(), "seconds_left": left if c.status == "pending" else 0}


def _pending_request(s: Session, request_id: int, cosigner_id: int) -> tuple[CosignRequest, BankApproval]:
    svc.expire_stale(s)
    c = s.get(CosignRequest, request_id)
    if not c:
        raise HTTPException(404, "co-sign request not found")
    if s.get(BankCustomer, c.customer_id).cosigner_id != cosigner_id:
        raise HTTPException(403, "not this customer's co-signer")
    if c.status != "pending":
        s.commit()  # keep an expiry we just recorded
        raise HTTPException(409, f"request is {c.status}")
    return c, s.get(BankApproval, c.approval_id)


@router.get("/pending")
def pending(cosigner_id: int, s: Session = Depends(get_session)):
    svc.expire_stale(s)
    s.commit()
    rows = s.exec(select(CosignRequest).join(BankCustomer, BankCustomer.id == CosignRequest.customer_id).where(
        BankCustomer.cosigner_id == cosigner_id, CosignRequest.status == "pending").order_by(CosignRequest.created_at))
    return [_view(c) for c in rows]


@router.post("/{request_id}/approve")
def approve(request_id: int, body: sc.CosignApproveIn, s: Session = Depends(get_session)):
    c, ap = _pending_request(s, request_id, body.cosigner_id)
    if err := svc.verify_pin(s, s.get(BankCustomer, body.cosigner_id), body.pin):
        return err
    c.status, c.decided_at, ap.cosign = "approved", clock.now(), "approved"
    svc.maybe_approve(ap)
    s.add_all([c, ap])
    svc.audit_step(s, "cosign_approved", c.customer_id, ap=ap, method="cosign", result="approved",
                   cosigner_id=body.cosigner_id, cosign_request_id=c.id)
    s.commit()
    return _view(c)


@router.post("/{request_id}/decline")
def decline(request_id: int, body: sc.CosignDeclineIn, s: Session = Depends(get_session)):
    c, ap = _pending_request(s, request_id, body.cosigner_id)  # declining needs no PIN: refusing is always safe
    c.status, c.decided_at, ap.cosign, ap.status = "declined", clock.now(), "declined", "declined"
    s.add_all([c, ap])
    svc.audit_step(s, "cosign_declined", c.customer_id, ap=ap, method="cosign", result="declined",
                   cosigner_id=body.cosigner_id, cosign_request_id=c.id)
    s.commit()
    return _view(c)
