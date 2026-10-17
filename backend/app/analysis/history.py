"""Where a recurring purchase falls on the calendar and what was paid in the same window in earlier years."""
import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlmodel import Session, select

from app.models import BankTxn, CalendarEntry


def _month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def _next_window(e: CalendarEntry, today: date) -> tuple[date, date]:
    y = today.year if date(today.year, e.month_from, 1) >= today else today.year + 1
    return date(y, e.month_from, 1), _month_end(y, e.month_to)


def _history(s: Session, account_id: int, e: CalendarEntry, start: date, end: date):
    """Debits of this purchase category inside the same window 1-3 years back, grouped by counterparty."""
    by, last, years = defaultdict(list), defaultdict(float), 0
    for k in (1, 2, 3):
        lo = datetime.combine(start.replace(year=start.year - k), time.min)
        hi = datetime.combine(end.replace(year=end.year - k), time.min) + timedelta(days=1)
        rows = s.exec(select(BankTxn).where(BankTxn.account_id == account_id, BankTxn.direction == "debit",
                                            BankTxn.category == e.typical_purchase, BankTxn.ts >= lo, BankTxn.ts < hi)).all()
        years += bool(rows)
        for t in rows:
            by[t.counterparty].append(t.amount)
            if k == 1:
                last[t.counterparty] += t.amount
    return by, last, years
