from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.analysis.compliance import check_compliance
from app.analysis.forecast import forecast_procurement
from app.analysis.policy_match import match_policies
from app.analysis.structures import compare_structures
from app.db import get_session

router = APIRouter(prefix="/analysis", tags=["analysis (information only, not advice)"])


class AnalysisIn(BaseModel):
    customer_id: int = 1
    period: str | None = None  # 'YYYY-Qn'; default = quarter of the latest order


def run(fn, body: AnalysisIn, s: Session):
    try:
        result = fn(s, body.customer_id, body.period)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except LookupError as e:
        raise HTTPException(503, str(e))
    s.commit()  # persists the audit row
    return result


@router.post("/compliance")
def compliance(body: AnalysisIn, s: Session = Depends(get_session)):
    return run(check_compliance, body, s)


@router.post("/structures")
def structures(body: AnalysisIn, s: Session = Depends(get_session)):
    return run(compare_structures, body, s)


class ForecastIn(BaseModel):
    customer_id: int = 1


@router.post("/procurement-forecast")
def procurement_forecast(body: ForecastIn, s: Session = Depends(get_session)):
    """Range forecast + cash gap + a suggested plan. Executes nothing."""
    try:
        result = forecast_procurement(s, body.customer_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    s.commit()  # persists the audit row
    return result


class PolicyMatchIn(BaseModel):
    customer_id: int = 1
    structure: Literal["individual", "个体工商户", "cooperative", "company"] | None = None  # "what if" override, default = declared


@router.post("/policy-match")
def policy_match(body: PolicyMatchIn, s: Session = Depends(get_session)):
    """Which subsidies and loans he MAY qualify for (simulated county). Information only; nothing is submitted anywhere."""
    try:
        result = match_policies(s, body.customer_id, body.structure)
    except LookupError as e:
        raise HTTPException(404, str(e))
    s.commit()  # persists the audit row
    return result
