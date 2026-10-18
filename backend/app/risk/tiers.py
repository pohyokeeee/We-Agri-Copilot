"""Deterministic risk tiers. Pure functions; an LLM never touches this.

Tier only ever goes up: final >= base. `now` is naive China-local time (see app.clock).
"""
from datetime import datetime
from typing import TypedDict

GREEN, YELLOW, RED = "green", "yellow", "red"
_RANK = {GREEN: 0, YELLOW: 1, RED: 2}

DAILY_LIMIT = 1000.0  # CNY, cumulative transfers per day
BASE_TIER = {
    "read": GREEN, "analysis": GREEN,
    "reserve": YELLOW, "reserve_rule": YELLOW, "schedule": YELLOW, "schedule_cancel": YELLOW, "financing_prefill": YELLOW,
    "financing_submit": RED, "unlock": RED,
}  # "transfer" is computed below


class TierResult(TypedDict):
    base_tier: str
    final_tier: str
    reasons: list[str]
    requires_cosigner: bool


def max_tier(a: str, b: str) -> str:
    return a if _RANK[a] >= _RANK[b] else b


def classify(
    action: str,
    *,
    now: datetime,
    amount: float = 0.0,
    payee_known: bool = True,
    daily_total: float = 0.0,  # already transferred today, EXCLUDING this amount
    usual_amount: float | None = None,  # customer's usual transfer size (None = no history)
    balance: float | None = None,
    protection_mode: bool = False,
) -> TierResult:
    reasons: list[str] = []
    if action == "transfer":
        base = YELLOW
        if not payee_known:
            base = RED
            reasons.append("new payee")
        if daily_total + amount > DAILY_LIMIT:
            base = RED
            reasons.append(f"daily total {daily_total + amount:.2f} exceeds {DAILY_LIMIT:.0f}")
    elif action in BASE_TIER:
        base = BASE_TIER[action]
    else:
        raise ValueError(f"unknown action {action!r}")

    final = base
    if base == YELLOW:  # raise rules only apply to yellow
        raises = []
        if not payee_known:
            raises.append("new payee")
        if usual_amount and amount > 2 * usual_amount:
            raises.append(f"amount {amount:.2f} is over 2x usual {usual_amount:.2f}")
        if balance is not None and amount > 0.5 * balance:
            raises.append(f"amount {amount:.2f} is over 50% of balance {balance:.2f}")
        if now.hour >= 23 or now.hour < 6:
            raises.append("night-time (23:00-06:00)")
        if raises:
            final = max_tier(base, RED)
            reasons += raises

    return {
        "base_tier": base,
        "final_tier": final,
        "reasons": reasons,
        "requires_cosigner": protection_mode and final == RED,
    }
