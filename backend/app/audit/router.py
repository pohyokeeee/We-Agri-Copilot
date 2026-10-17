"""Judge console endpoints: recent traces, one trace step by step, and the audit-chain check. Read-only."""
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.audit.chain import verify_report
from app.db import get_session
from app.mockbank.service import reasons_zh
from app.models import AgentAudit

trace_router = APIRouter(prefix="/trace", tags=["trace (judge console)"])
audit_router = APIRouter(prefix="/audit", tags=["audit"])

SCAN = 2000  # ponytail: /trace/recent groups the newest 2,000 audit rows; index payload.trace_id if that is not enough
EVENT_ZH = {
    "approval_requested": "申请审批", "confirmed": "本人确认", "cancelled": "本人取消", "pin_verified": "密码正确",
    "pin_failed": "密码错误", "cosign_requested": "请家人确认", "cosign_approved": "家人同意", "cosign_declined": "家人拒绝",
    "cosign_expired": "家人确认超时", "token_rejected": "凭证被拒绝", "transfer_executed": "转账已执行", "transfer_plan": "付款计划",
    "reserve_created": "已预留", "reserve_released": "已释放预留", "locked": "安全锁已锁", "unlocked": "安全锁已解",
    "orders_imported": "导入订单", "income_reconciled": "对账", "income_statement": "收入报表", "compliance_checked": "合规检查",
    "structures_compared": "经营方式对比", "procurement_forecast": "采购预测", "policy_match": "补贴匹配",
    "financing_costs_viewed": "借款成本", "application_drafted": "贷款草稿", "application_submitted": "贷款申请已发出",
    "application_withdrawn": "贷款申请已撤回", "seeded": "演示数据",
}
ACTION_ZH = {"transfer": "转账", "reserve": "预留", "unlock": "解除安全锁", "financing_prefill": "预填贷款申请",
             "financing_submit": "发出贷款申请"}
# the status a trace shows is decided by its LAST event
DONE = {"transfer_executed", "reserve_created", "reserve_released", "locked", "unlocked", "orders_imported", "income_reconciled",
        "income_statement", "compliance_checked", "structures_compared", "procurement_forecast", "policy_match",
        "financing_costs_viewed", "application_drafted", "application_submitted", "application_withdrawn", "transfer_plan", "seeded"}
STATUS_ZH = {"token_rejected": "被拒绝", "cosign_declined": "家人拒绝", "cancelled": "已取消", "cosign_expired": "已超时",
             "cosign_approved": "已批准，待执行", "pin_failed": "密码错误"}
SHOWN_ELSEWHERE = {"trace_id", "endpoint", "wording_check", "balance_before", "balance_after", "tier_base", "tier_final", "reasons",
                   "method", "result", "utterance", "dag"}


def mask(x):
    """Account and phone numbers never leave in full: any run of 8+ digits keeps only its last 4."""
    if isinstance(x, dict):
        return {k: mask(v) for k, v in x.items()}
    if isinstance(x, list):
        return [mask(v) for v in x]
    if isinstance(x, str):
        return re.sub(r"\d{8,}", lambda m: "*" * (len(m[0]) - 4) + m[0][-4:], x)
    return x


def _status(last: AgentAudit) -> str:
    if last.event == "pin_failed":
        return "已锁定" if last.payload.get("result") == "locked" else STATUS_ZH["pin_failed"]
    return "已完成" if last.event in DONE else STATUS_ZH.get(last.event, "等待中")


def _summary(rows: list[AgentAudit]) -> str:
    for r in rows:
        if r.payload.get("action") in ACTION_ZH:
            amount = (r.payload.get("payload") or {}).get("amount")
            return ACTION_ZH[r.payload["action"]] + (f" {amount:g} 元" if amount else "")
    return EVENT_ZH.get(rows[0].event, rows[0].event)


def _step(i: int, r: AgentAudit) -> dict:
    p = r.payload
    return {
        "seq": i, "row_id": r.id, "ts": r.ts, "actor": r.actor, "event": r.event, "event_zh": EVENT_ZH.get(r.event, r.event),
        "tool": r.event, "endpoint": p.get("endpoint"),
        "tier_base": p.get("tier_base") or None, "tier_final": p.get("tier_final") or None,
        "reasons": p.get("reasons", []), "reasons_zh": reasons_zh(p.get("reasons", [])),
        "approval": {"method": p.get("method"), "result": p.get("result")} if p.get("method") or p.get("result") else None,
        "wording_check": p.get("wording_check"), "balance_before": p.get("balance_before"), "balance_after": p.get("balance_after"),
        "utterance": p.get("utterance"), "dag": p.get("dag"),
        "detail": mask({k: v for k, v in p.items() if k not in SHOWN_ELSEWHERE}),
        "prev_hash": r.prev_hash, "hash": r.hash,
    }


def _trace_rows(s: Session, trace_id: str) -> list[AgentAudit]:
    return s.exec(select(AgentAudit).where(AgentAudit.payload["trace_id"].as_string() == trace_id).order_by(AgentAudit.id)).all()


@trace_router.get("/recent")
def recent(limit: int = Query(20, ge=1, le=100), s: Session = Depends(get_session)):
    groups: dict[str, list[AgentAudit]] = {}
    for r in s.exec(select(AgentAudit).order_by(AgentAudit.id.desc()).limit(SCAN)):
        if tid := r.payload.get("trace_id"):
            groups.setdefault(tid, []).append(r)  # newest first, so dict order = most recently active first
    out = []
    for tid, rows in list(groups.items())[:limit]:
        rows.reverse()
        out.append({"trace_id": tid, "summary_zh": _summary(rows), "status": _status(rows[-1]), "steps": len(rows),
                    "started_at": rows[0].ts, "last_at": rows[-1].ts, "endpoint": rows[0].payload.get("endpoint")})
    return out


@trace_router.get("/{trace_id}")
def one_trace(trace_id: str, s: Session = Depends(get_session)):
    rows = _trace_rows(s, trace_id)
    if not rows:
        raise HTTPException(404, "trace not found")
    steps = [_step(i, r) for i, r in enumerate(rows, 1)]
    return {"trace_id": trace_id, "summary_zh": _summary(rows), "status": _status(rows[-1]), "started_at": rows[0].ts,
            "utterance": next((x["utterance"] for x in steps if x["utterance"]), None),
            "dag": next((x["dag"] for x in steps if x["dag"]), None), "steps": steps}


@audit_router.get("/verify")
def verify(s: Session = Depends(get_session)):
    return verify_report(s)
