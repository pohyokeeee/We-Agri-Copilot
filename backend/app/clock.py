from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))  # China has no DST, a fixed offset is exact


def now() -> datetime:
    """Naive China-local time. Every stored datetime in this app is naive CST."""
    return datetime.now(CST).replace(tzinfo=None)
