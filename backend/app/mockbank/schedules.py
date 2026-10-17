"""Conditional payments: "pay each supplier when the honey is delivered". Creating them moves no money; each is a
schedule row waiting for its condition. The whole batch is one approval (yellow, raised to red by the tier engine)."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db import get_session
from app.mockbank import service as svc
from app.mockbank.numerals import amount_digits, amount_zh
from app.models import BankPayee, BankSchedule

router = APIRouter(prefix="/bank", tags=["schedules (simulated)"])


class ScheduleItem(BaseModel):
    payee_id: int
    amount: float = Field(gt=0)  # one payment
    times: int = Field(1, ge=1, le=12)  # how many payments (e.g. Aug and Sep)
    run_on: date
    condition: str = Field("on_delivery", max_length=40)


class ScheduleBatchIn(BaseModel):
    customer_id: int = 1
    purpose: str = Field("", max_length=40)
    items: list[ScheduleItem] = Field(min_length=1, max_length=20)
    approval_token: str | None = None


def payload_of(body: ScheduleBatchIn) -> dict:
    """What an approval token is bound to. Amounts as float(round(x, 2)) so 4250 and 4250.0 hash alike."""
    return {"purpose": body.purpose, "items": [
        {"payee_id": i.payee_id, "amount": float(round(i.amount, 2)), "times": i.times, "run_on": i.run_on.isoformat(),
         "condition": i.condition} for i in body.items]}


@router.post("/schedules")
def create_schedules(body: ScheduleBatchIn, s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, body.customer_id)
    payload = payload_of(body)
    payees = [s.get(BankPayee, i["payee_id"]) for i in payload["items"]]
    if any(p is None or p.customer_id != cust.id for p in payees):
        raise HTTPException(404, "payee not found")
    total = round(sum(i["amount"] * i["times"] for i in payload["items"]), 2)
    tier, ap, used = svc.gate(s, cust, "schedule", total, payload, body.approval_token,
                              payee_known=all(svc.payee_known(p) for p in payees), balance=acct.balance,
                              usual_amount=svc.usual_amount(s, acct.id))
    if ap:
        s.commit()
        readback = (f"安排送货时付款：共{len({p.id for p in payees})}家供应商，合计 {amount_digits(total)} 元（{amount_zh(total)}）。"
                    "现在不转钱，送货时才转，对吗？")
        return JSONResponse(status_code=202, content={**svc.approval_view(ap), "readback_zh": readback})
    batch = uuid.uuid4().hex[:8]
    for i in payload["items"]:
        for _ in range(i["times"]):
            s.add(BankSchedule(customer_id=cust.id, payee_id=i["payee_id"], amount=i["amount"], run_on=date.fromisoformat(i["run_on"]),
                               condition=i["condition"], batch_id=batch, purpose=body.purpose))
    count = sum(i["times"] for i in payload["items"])
    svc.audit_step(s, "schedules_created", cust.id, ap=used, tier=tier, method=svc.method_of(used) if used else "none",
                   result="scheduled (no money moved)", batch_id=batch, count=count, total=total)
    s.commit()
    return {"status": "scheduled", "batch_id": batch, "count": count, "total": total}


@router.delete("/schedules/{batch_id}")
def cancel_schedules(batch_id: str, customer_id: int = 1, s: Session = Depends(get_session)):
    """Undo of our own batch, so no approval gate; blocked while locked and always audited."""
    cust, _ = svc.get_customer(s, customer_id)
    svc.ensure_unlocked(cust)
    rows = s.exec(select(BankSchedule).where(BankSchedule.customer_id == cust.id, BankSchedule.batch_id == batch_id,
                                             BankSchedule.status == "scheduled")).all()
    if not rows:
        raise HTTPException(404, "no active schedules in this batch")
    for r in rows:
        r.status = "cancelled"
        s.add(r)
    svc.audit_step(s, "schedules_cancelled", cust.id, method="customer", result="cancelled", batch_id=batch_id, count=len(rows))
    s.commit()
    return {"status": "cancelled", "batch_id": batch_id, "count": len(rows)}
