"""Loan products: full cost (with and without an interest subsidy) and pre-filled applications.

An application is a DRAFT built from the sales record (yellow: read back, confirm). Submitting it is red (PIN, and the
co-signer in protection mode). "Submitted" means handed to the Mock Bank (simulated); nothing goes to any government system.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import clock
from app.agent.grounding import assert_wording
from app.analysis.common import n, shift_months
from app.analysis.policy_match import build_profile, interest_subsidy_for
from app.analysis.reconcile import reconcile_range
from app.db import get_session
from app.mockbank import service as svc
from app.mockbank.numerals import amount_digits, amount_zh
from app.models import BankAccount, BankCustomer, BankProduct, BankTxn, FinancingApplication, RulePolicy

router = APIRouter(prefix="/bank", tags=["financing (simulated)"])
SUBSIDY_NOTE = "补贴只抵利息，不抵手续费；补贴以审核为准。"
DEFAULT_DOCS = ["身份证", "近12个月银行流水", "经营证明"]


def cost_options(s: Session, amount: float, term: int | None = None, subsidy: RulePolicy | None = None) -> list[dict]:
    """Every product's FULL cost (interest + fees). With an interest subsidy the net cost is shown next to it, never instead.
    Simple interest, repaid at the end. `fees` on a product is a fraction of the amount."""
    out = []
    for p in s.exec(select(BankProduct).order_by(BankProduct.id)):
        months = term or p.term_months
        interest, fee = round(amount * p.apr * months / 12, 2), round(amount * p.fees, 2)
        total = round(interest + fee, 2)
        row = {
            "product_id": p.id, "name": p.name, "amount": amount, "term_months": months, "apr": p.apr, "fee_rate": p.fees,
            "interest": interest, "fee": fee, "total_cost": total, "total_repay": round(amount + total, 2),
            "within_limit": amount <= p.eligibility.get("max_amount", float("inf")),
            "subsidy_amount": None, "cost_after_subsidy": None, "total_repay_after_subsidy": None, "subsidy_policy_id": None,
        }
        text = (f"{p.name}：借{n(amount)}元，{months}个月，年利率{p.apr:.2%}；利息约{n(interest)}元，手续费{n(fee)}元，"
                f"合计成本{n(total)}元，到期共还{n(amount + total)}元。")
        if subsidy:
            sub = round(min(interest * subsidy.benefit_params["rate"], subsidy.benefit_params["cap"]), 2)
            row.update(subsidy_amount=sub, cost_after_subsidy=round(total - sub, 2),
                       total_repay_after_subsidy=round(amount + total - sub, 2), subsidy_policy_id=subsidy.policy_id)
            text += f"如果拿到利息补贴{n(sub)}元，成本约{n(total - sub)}元。"
        row["text_zh"] = text + "额度和条件以银行审核为准。"
        out.append(row)
    return out


@router.get("/products/financing")
def financing_costs(amount: float = Query(gt=0), term: int | None = Query(None, ge=1, le=60), customer_id: int = 1,
                    s: Session = Depends(get_session)):
    cust, acct = svc.get_customer(s, customer_id)
    found = interest_subsidy_for(s, cust, acct, amount)
    pol = found[0] if found else None
    options = cost_options(s, amount, term, pol)
    assert_wording([o["text_zh"] for o in options])
    svc.audit_step(s, "financing_costs_viewed", cust.id, method="none", result="shown", amount=amount, term_months=term,
                   subsidy_policy_id=pol.policy_id if pol else None)
    s.commit()
    return {"amount": amount, "term_months": term, "options": options, "note_zh": SUBSIDY_NOTE,
            "subsidy": {"policy_id": pol.policy_id, "name": pol.name, **pol.benefit_params, "benefit": pol.benefit,
                        "summary_zh": found[1]["summary_zh"]} if pol else None}


# ---------- applications ----------
class ApplicationIn(BaseModel):
    customer_id: int = 1
    product_id: int
    amount: float = Field(gt=0)
    term_months: int | None = Field(None, ge=1, le=60)
    approval_token: str | None = None


class SubmitIn(BaseModel):
    customer_id: int = 1
    approval_token: str | None = None


def _view(a: FinancingApplication, product: BankProduct) -> dict:
    return {"application_id": a.id, "status": a.status, "product": product.name, "amount": a.amount, "term_months": a.term_months,
            "prefill": a.prefill, "submitted_to": "模拟银行（演示数据），没有发给任何政府系统" if a.status == "submitted" else None}


def build_prefill(s: Session, cust: BankCustomer, acct: BankAccount, product: BankProduct, amount: float, term: int) -> dict:
    """Everything the form can be filled with from data we already hold. What we do not hold is listed in needs_from_you."""
    today = clock.today()
    start, end = shift_months(datetime(today.year, today.month, 1), -12), datetime(today.year, today.month, 1)
    year = reconcile_range(s, cust.id, start, end)
    profile = build_profile(s, cust, acct, amount, today=today)
    payouts = sum(t.amount for t in s.exec(select(BankTxn).where(
        BankTxn.account_id == acct.id, BankTxn.channel == "platform_payout", BankTxn.ts >= start, BankTxn.ts < end)))
    sales = sum(year["by_class"].values())
    docs = s.exec(select(RulePolicy).where(RulePolicy.kind == "bank_product", RulePolicy.name == product.name)).first()
    return {
        "applicant": cust.name.split(" (")[0], "region": profile["region"], "structure": profile["structure"],
        "activity": profile["activity"], "operating_months": profile["operating_months"],
        "sales_12m": {**year["by_class"], "total": round(sales, 2)}, "payouts_12m": round(payouts, 2),
        "avg_monthly_sales": round(sales / 12, 2), "product": product.name, "amount": amount, "term_months": term,
        "purpose": "收购蜂蜜周转资金", "documents": docs.documents if docs else DEFAULT_DOCS,
        "needs_from_you": ["身份证号码（本应用不保存，办理时现场出示）", "经营证明"],
    }


def _app(s: Session, application_id: int, customer_id: int) -> tuple[FinancingApplication, BankProduct]:
    a = s.get(FinancingApplication, application_id)
    if not a or a.customer_id != customer_id:
        raise HTTPException(404, "application not found")
    return a, s.get(BankProduct, a.product_id)


@router.post("/financing/applications")
def create_draft(body: ApplicationIn, s: Session = Depends(get_session)):
    """Yellow. Without a token: 202 + a read-back to confirm. With the confirmed token: the draft is created."""
    cust, acct = svc.get_customer(s, body.customer_id)
    product = s.get(BankProduct, body.product_id)
    if not product:
        raise HTTPException(404, "product not found")
    if body.amount > product.eligibility.get("max_amount", float("inf")):
        raise HTTPException(422, f"amount is above this product's limit ({product.eligibility['max_amount']:,})")
    amount, term = float(round(body.amount, 2)), body.term_months or product.term_months
    payload = {"product_id": product.id, "amount": amount, "term_months": term}
    tier, ap, used = svc.gate(s, cust, "financing_prefill", 0.0, payload, body.approval_token, balance=acct.balance)
    if ap:
        s.commit()
        readback = (f"为您预填一份贷款申请草稿：{product.name}，借 {amount_digits(amount)} 元（{amount_zh(amount)}），{term}个月。"
                    "现在只是草稿，不会发出，对吗？")
        return JSONResponse(status_code=202, content={**svc.approval_view(ap), "readback_zh": readback})
    a = FinancingApplication(customer_id=cust.id, product_id=product.id, amount=amount, term_months=term,
                             prefill=build_prefill(s, cust, acct, product, amount, term), created_at=clock.now())
    s.add(a)
    s.flush()
    svc.audit_step(s, "application_drafted", cust.id, ap=used, tier=tier, method=svc.method_of(used) if used else "none",
                   result="draft created", application_id=a.id, product=product.name, amount=amount)
    s.commit()
    return _view(a, product)


@router.get("/financing/applications/{application_id}")
def get_application(application_id: int, customer_id: int = 1, s: Session = Depends(get_session)):
    a, product = _app(s, application_id, customer_id)
    return _view(a, product)


@router.post("/financing/applications/{application_id}/submit")
def submit_application(application_id: int, body: SubmitIn, s: Session = Depends(get_session)):
    """Red: needs the PIN and, in protection mode, the co-signer. No token -> 202 and nothing changes."""
    cust, acct = svc.get_customer(s, body.customer_id)
    a, product = _app(s, application_id, cust.id)
    if a.status != "draft":
        raise HTTPException(409, f"application is {a.status}")
    payload = {"application_id": a.id, "product_id": a.product_id, "amount": a.amount}
    tier, ap, used = svc.gate(s, cust, "financing_submit", 0.0, payload, body.approval_token, balance=acct.balance)
    if ap:
        s.commit()
        return JSONResponse(status_code=202, content=svc.approval_view(ap))
    a.status, a.submitted_at = "submitted", clock.now()
    s.add(a)
    svc.audit_step(s, "application_submitted", cust.id, ap=used, tier=tier, method=svc.method_of(used),
                   result="submitted to Mock Bank (simulated)", application_id=a.id, amount=a.amount)
    s.commit()
    return _view(a, product)


@router.delete("/financing/applications/{application_id}")
def withdraw_application(application_id: int, customer_id: int = 1, s: Session = Depends(get_session)):
    """Undo of our own draft or submission, so no approval gate; blocked while locked and always audited."""
    cust, _ = svc.get_customer(s, customer_id)
    svc.ensure_unlocked(cust)
    a, product = _app(s, application_id, cust.id)
    if a.status == "withdrawn":
        raise HTTPException(409, "already withdrawn")
    was, a.status = a.status, "withdrawn"
    s.add(a)
    svc.audit_step(s, "application_withdrawn", cust.id, method="customer", result=f"withdrawn (was {was})", application_id=a.id)
    s.commit()
    return _view(a, product)
