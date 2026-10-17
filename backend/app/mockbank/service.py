"""Shared bank helpers: PIN hashing, the approval state machine, audit steps, daily totals.

Approval rules (the tier engine decides the tier, this file only enforces what each tier needs):
  green  -> executes at once
  yellow -> the customer confirms the read-back
  red    -> confirm + PIN, and in protection mode a co-signer's approval too
Approval grants a single-use token bound to sha256(payer, action, payload); it expires 5 minutes after it is granted.
"""
import hashlib
import hmac
import json
import secrets
import statistics
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app import clock
from app.audit import chain
from app.mockbank.numerals import amount_digits, amount_zh
from app.models import BankAccount, BankApproval, BankCustomer, BankPayee, BankReserve, BankTxn, CosignRequest
from app.risk.tiers import GREEN, RED, classify

TOKEN_TTL = timedelta(minutes=5)
COSIGN_TTL = timedelta(minutes=5)  # a co-sign request nobody answers in this time expires, nothing executes
NEW_PAYEE_DAYS = 365  # a payee first paid less than a year ago still counts as new
MAX_PIN_FAILS = 3
REASON_ZH = [("new payee", "新的收款人"), ("daily total", "当天累计转账超过1000元"), ("2x usual", "金额超过平时转账的2倍"),
             ("50% of balance", "金额超过余额的一半"), ("night", "夜间（23:00-06:00）")]


def hash_pin(pin: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', pin.encode(), salt.encode(), 100_000).hex()}"


def check_pin(pin: str, stored: str) -> bool:
    return hmac.compare_digest(hash_pin(pin, stored.split("$")[0]), stored)


def get_customer(s: Session, customer_id: int) -> tuple[BankCustomer, BankAccount]:
    cust = s.get(BankCustomer, customer_id)
    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).first()
    if not cust or not acct:
        raise HTTPException(404, "customer not found")
    return cust, acct


def reserved_total(s: Session, customer_id: int) -> float:
    rows = s.exec(select(BankReserve).where(BankReserve.customer_id == customer_id, BankReserve.status == "active"))
    return round(sum(r.amount for r in rows), 2)


def _transfers(s: Session, account_id: int):
    return s.exec(select(BankTxn).where(
        BankTxn.account_id == account_id, BankTxn.direction == "debit", BankTxn.channel == "transfer"))


def daily_total(s: Session, account_id: int) -> float:
    start = datetime.combine(clock.today(), time.min)
    return round(sum(t.amount for t in _transfers(s, account_id) if start <= t.ts < start + timedelta(days=1)), 2)


def usual_amount(s: Session, account_id: int) -> float | None:
    amounts = [t.amount for t in _transfers(s, account_id)]
    return statistics.median(amounts) if amounts else None


def ensure_unlocked(cust: BankCustomer) -> None:
    if cust.locked:
        raise HTTPException(423, "account is locked (safety lock); reads still work")


def payee_known(p: BankPayee | None, today: date | None = None) -> bool:
    """False for a payee never paid or first paid within the last year (the tier engine then says "new payee")."""
    today = today or clock.today()
    return bool(p and p.first_paid_at and p.first_paid_at.date() <= today - timedelta(days=NEW_PAYEE_DAYS))


def reasons_zh(reasons: list[str]) -> list[str]:
    return list(dict.fromkeys(next((z for k, z in REASON_ZH if k in r), r) for r in reasons))


# ---------- plain-language text, deterministic (never LLM) ----------
def readback_zh(name: str, spoken_as: str | None, amount: float, purpose: str) -> str:
    who = f"{spoken_as}（{name}）" if spoken_as and spoken_as != name else name
    tail = f"，{purpose}" if purpose else ""
    return f"给{who}转 {amount_digits(amount)} 元（{amount_zh(amount)}）{tail}，对吗？"


def _short(cust: BankCustomer) -> str:
    return cust.name.split(" (")[0]


def summary_zh(s: Session, cust: BankCustomer, ap: BankApproval) -> str:
    p = ap.payload
    if ap.action == "transfer":
        payee = s.get(BankPayee, p["payee_id"])
        tail = f"，用途：{p['purpose']}" if p.get("purpose") else ""
        return f"{_short(cust)}要转 {amount_digits(p['amount'])} 元（{amount_zh(p['amount'])}）给{payee.name if payee else '未知收款人'}{tail}"
    if ap.action == "unlock":
        return f"{_short(cust)}的账户被安全锁锁住了，要解除安全锁"
    return f"{_short(cust)}要{ap.action}：{amount_digits(p.get('amount', 0))} 元"


# ---------- audit: every step records tiers, reasons, method/result and balances ----------
def audit_step(s: Session, event: str, customer_id: int, *, ap: BankApproval | None = None, tier: dict | None = None,
               method: str = "", result: str = "", balance_before: float | None = None,
               balance_after: float | None = None, **extra) -> None:
    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).first()
    before = balance_before if balance_before is not None else (acct.balance if acct else None)
    if ap:
        base, final, reasons = ap.tier_base, ap.tier, ap.reasons
    elif tier:
        base, final, reasons = tier["base_tier"], tier["final_tier"], tier["reasons"]
    else:
        base = final, reasons = "", []
        base, final = "", ""
    chain.append(s, "mockbank", event, {
        "customer_id": customer_id, "approval_id": ap.id if ap else None, "tier_base": base, "tier_final": final,
        "reasons": reasons, "method": method, "result": result, "balance_before": before,
        "balance_after": before if balance_after is None else balance_after, **extra})


def method_of(ap: BankApproval) -> str:
    return "+".join(["confirm", *(["pin"] if ap.tier == RED and ap.action != "unlock" else []),
                     *(["cosign"] if ap.requires_cosigner else [])])


# ---------- approval state machine ----------
def action_hash(customer_id: int, action: str, payload: dict) -> str:
    """Binds a token to exactly one request. Callers pass amounts as float(round(x, 2)) so 800 and 800.0 hash alike."""
    body = json.dumps({"payer": customer_id, "action": action, "payload": payload}, sort_keys=True,
                      separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode()).hexdigest()


def next_step(ap: BankApproval) -> str:
    if ap.status != "pending":
        return "ready" if ap.status == "approved" else ap.status
    if not ap.confirmed:
        return "confirm"
    if ap.tier == RED and ap.action != "unlock" and not ap.pin_ok:
        return "pin"
    return "cosign" if ap.requires_cosigner and ap.cosign != "approved" else "ready"


def approval_view(ap: BankApproval) -> dict:
    return {
        "approval_id": ap.id, "action": ap.action, "payload": ap.payload, "tier": ap.tier, "tier_base": ap.tier_base,
        "reasons": ap.reasons, "reasons_zh": reasons_zh(ap.reasons), "requires_cosigner": ap.requires_cosigner,
        "requires_pin": ap.tier == RED and ap.action != "unlock", "confirmed": ap.confirmed, "pin_ok": ap.pin_ok,
        "cosign": ap.cosign, "status": ap.status, "next": next_step(ap),
        "approval_token": ap.token if ap.status == "approved" else None,
    }


def maybe_approve(ap: BankApproval) -> None:
    if (ap.status == "pending" and ap.confirmed and (ap.tier != RED or ap.pin_ok)
            and (not ap.requires_cosigner or ap.cosign == "approved")):
        ap.status, ap.token, ap.token_at = "approved", secrets.token_urlsafe(16), clock.now()


def request_cosign(s: Session, cust: BankCustomer, ap: BankApproval) -> CosignRequest:
    cr = CosignRequest(customer_id=cust.id, approval_id=ap.id, action_hash=ap.action_hash, reasons=ap.reasons,
                       summary_zh=summary_zh(s, cust, ap), created_at=clock.now())
    ap.cosign = "pending"
    s.add_all([cr, ap])
    s.flush()
    audit_step(s, "cosign_requested", cust.id, ap=ap, method="cosign", result="pending", cosign_request_id=cr.id)
    return cr


def expire_stale(s: Session) -> None:
    """Co-sign requests nobody answered within 5 minutes expire; the approval dies with them. Caller commits."""
    now = clock.now()
    for cr in s.exec(select(CosignRequest).where(CosignRequest.status == "pending")).all():
        if now - cr.created_at > COSIGN_TTL:
            cr.status, cr.decided_at = "expired", now
            ap = s.get(BankApproval, cr.approval_id)
            if ap.status == "pending":
                ap.status, ap.cosign = "expired", "expired"
                s.add(ap)
            s.add(cr)
            audit_step(s, "cosign_expired", cr.customer_id, ap=ap, method="cosign", result="expired", cosign_request_id=cr.id)


def gate(
    s: Session, cust: BankCustomer, action: str, amount: float, payload: dict,
    token: str | None, **tier_kwargs,
) -> tuple[dict, BankApproval | None, BankApproval | None]:
    """Returns (tier, new_approval, used_approval). (tier, None, None) = run now (green). (tier, new, None) = needs
    approval. (tier, None, used) = a valid token was presented and is now spent."""
    if action != "unlock":
        ensure_unlocked(cust)
    now = clock.now()
    tier = classify(action, now=now, amount=amount, protection_mode=cust.protection_mode, **tier_kwargs)
    h = action_hash(cust.id, action, payload)
    if token:
        ap = s.exec(select(BankApproval).where(BankApproval.token == token)).first()
        why = ("unknown token" if not ap else "token already used" if ap.status == "used"
               else "approval is not granted" if ap.status != "approved" or ap.customer_id != cust.id
               else "request differs from what was approved" if ap.action_hash != h or ap.action != action
               else "token expired" if now - ap.token_at > TOKEN_TTL else "")
        if why:
            audit_step(s, "token_rejected", cust.id, ap=ap, tier=tier, method="token", result=f"rejected: {why}", action=action)
            s.commit()  # keep the audit row although the request fails
            raise HTTPException(403, f"approval token rejected: {why}")
        ap.status = "used"
        s.add(ap)
        return tier, None, ap
    if tier["final_tier"] == GREEN:
        return tier, None, None
    unlock = action == "unlock"  # a locked customer cannot enter a PIN: the co-signer is the only way
    ap = BankApproval(
        customer_id=cust.id, action=action, payload=payload, action_hash=h, tier_base=tier["base_tier"],
        tier=tier["final_tier"], reasons=tier["reasons"], requires_cosigner=tier["requires_cosigner"] or unlock,
        confirmed=unlock, pin_ok=unlock, created_at=now,
    )
    s.add(ap)
    s.flush()
    audit_step(s, "approval_requested", cust.id, ap=ap, method="none", result="pending", action=action, payload=payload)
    if unlock:
        request_cosign(s, cust, ap)
    return tier, ap, None


def record_pin_failure(s: Session, who: BankCustomer) -> bool:
    """Count a bad PIN; lock at 3. Returns True if now locked."""
    who.failed_pins += 1
    if who.failed_pins >= MAX_PIN_FAILS:
        who.locked = True
    s.add(who)
    audit_step(s, "pin_failed", who.id, method="pin", result="locked" if who.locked else "wrong PIN", failed_pins=who.failed_pins)
    return who.locked


def verify_pin(s: Session, who: BankCustomer, pin: str):
    """None if the PIN is right; else a JSONResponse (the failure is committed so the counter and lock persist)."""
    if who.locked:
        raise HTTPException(423, "account is locked")
    if check_pin(pin, who.pin_hash):
        who.failed_pins = 0
        s.add(who)
        return None
    locked = record_pin_failure(s, who)
    s.commit()
    return JSONResponse(status_code=423 if locked else 401,
                        content={"detail": "locked after 3 wrong PINs" if locked else "wrong PIN", "locked": locked})
