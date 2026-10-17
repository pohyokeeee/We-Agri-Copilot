import re
from datetime import datetime

from sqlmodel import Session, select

from app import clock
from app.models import RuleTax


def period_bounds(period: str) -> tuple[datetime, datetime]:
    """'2026-Q2' -> (2026-04-01, 2026-07-01), end exclusive."""
    m = re.fullmatch(r"(\d{4})-Q([1-4])", period)
    if not m:
        raise ValueError("period must look like 2026-Q2")
    y, q = int(m[1]), int(m[2])
    return datetime(y, 3 * q - 2, 1), (datetime(y + 1, 1, 1) if q == 4 else datetime(y, 3 * q + 1, 1))


def shift_months(d: datetime, n: int) -> datetime:
    total = d.year * 12 + d.month - 1 + n
    return datetime(total // 12, total % 12 + 1, 1)


def latest_period() -> str:
    """Last completed quarter before the demo clock's today (the current quarter is still open)."""
    today = clock.today()
    this_q = datetime(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    prev = shift_months(this_q, -3)
    return f"{prev.year}-Q{(prev.month - 1) // 3 + 1}"


def load_rules(s: Session, ids: list[str]) -> dict[str, RuleTax]:
    """Thresholds and statuses come ONLY from rule_tax rows. Missing row = rule table not seeded."""
    rows = {r.rule_id: r for r in s.exec(select(RuleTax).where(RuleTax.rule_id.in_(ids)))}
    if missing := set(ids) - set(rows):
        raise LookupError(f"rule_tax rows missing: {sorted(missing)}")
    return rows


def rules_view(rules: dict[str, RuleTax], used: set[str]) -> dict:
    return {i: {"status": rules[i].status, "citation_url": rules[i].citation_url} for i in sorted(used)}


def n(x: float) -> str:
    return f"{x:,.0f}"
