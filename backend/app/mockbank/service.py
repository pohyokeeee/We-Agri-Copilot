"""Shared bank helpers: PIN hashing, approval gate, daily totals."""
import hashlib
import hmac
import secrets
import statistics
from datetime import datetime, time, timedelta

from fastapi import HTTPException
from sqlmodel import Session, select

from app import clock
from app.audit import chain
from app.models import BankAccount, BankApproval, BankCustomer, BankReserve, BankTxn
from app.risk.tiers import GREEN, classify

TOKEN_TTL = timedelta(minutes=10)
MAX_PIN_FAILS = 3


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
    start = datetime.combine(clock.now().date(), time.min)
    return round(sum(t.amount for t in _transfers(s, account_id) if start <= t.ts < start + timedelta(days=1)), 2)


def usual_amount(s: Session, account_id: int) -> float | None:
    amounts = [t.amount for t in _transfers(s, account_id)]
    return statistics.median(amounts) if amounts else None


def ensure_unlocked(cust: BankCustomer) -> None:
    if cust.locked:
        raise HTTPException(423, "account is locked (safety lock); reads still work")


def approval_view(ap: BankApproval) -> dict:
    return {
        "approval_id": ap.id, "action": ap.action, "payload": ap.payload, "tier": ap.tier,
        "reasons": ap.reasons, "requires_cosigner": ap.requires_cosigner, "pin_ok": ap.pin_ok,
        "cosign": ap.cosign, "status": ap.status, "approval_token": ap.token if ap.status == "approved" else None,
    }


def maybe_approve(ap: BankApproval) -> None:
    if ap.status == "pending" and ap.pin_ok and (not ap.requires_cosigner or ap.cosign == "approved"):
        ap.status, ap.token = "approved", secrets.token_urlsafe(16)


def gate(
    s: Session, cust: BankCustomer, action: str, amount: float, payload: dict,
    token: str | None, **tier_kwargs,
) -> tuple[dict, BankApproval | None]:
    """Returns (tier, None) when the action may run now, or (tier, new_approval) when approval is needed.
    A valid single-use token (bound to action+payload, 10 min) lets a non-green action through."""
    if action != "unlock":
        ensure_unlocked(cust)
    now = clock.now()
    tier = classify(action, now=now, amount=amount, protection_mode=cust.protection_mode, **tier_kwargs)
    if token:
        ap = s.exec(select(BankApproval).where(BankApproval.token == token)).first()
        if (not ap or ap.status != "approved" or ap.customer_id != cust.id or ap.action != action
                or ap.payload != payload or now - ap.created_at > TOKEN_TTL):
            raise HTTPException(403, "invalid or expired approval token")
        ap.status = "used"
        s.add(ap)
        return tier, None
    if tier["final_tier"] == GREEN:
        return tier, None
    unlock = action == "unlock"  # a locked customer cannot enter a PIN: the co-signer is the only way
    ap = BankApproval(
        customer_id=cust.id, action=action, payload=payload, tier=tier["final_tier"], reasons=tier["reasons"],
        requires_cosigner=tier["requires_cosigner"] or unlock, pin_ok=unlock, created_at=now,
    )
    s.add(ap)
    s.flush()
    chain.append(s, "mockbank", "approval_requested", {"approval_id": ap.id, "action": action, "payload": payload,
                                                     "tier": ap.tier, "reasons": ap.reasons})
    return tier, ap


def record_pin_failure(s: Session, who: BankCustomer) -> bool:
    """Count a bad PIN; lock at 3. Returns True if now locked."""
    who.failed_pins += 1
    if who.failed_pins >= MAX_PIN_FAILS:
        who.locked = True
    s.add(who)
    chain.append(s, "mockbank", "pin_failed", {"customer_id": who.id, "failed_pins": who.failed_pins, "locked": who.locked})
    return who.locked
