from datetime import date, datetime, timedelta, timezone

from app.config import settings

CST = timezone(timedelta(hours=8))  # China has no DST, a fixed offset is exact


def now() -> datetime:
    """Naive China-local time. The date part is DEMO_TODAY when set (time of day stays real, so the
    night-time risk rule still behaves). Every stored datetime in this app is naive CST."""
    real = datetime.now(CST).replace(tzinfo=None)
    if not settings.demo_today:
        return real
    return datetime.combine(date.fromisoformat(settings.demo_today), real.time())


def today() -> date:
    """The one place date logic gets 'today' from. Never call datetime.now()/date.today() elsewhere."""
    return now().date()
