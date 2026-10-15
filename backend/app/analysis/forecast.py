"""Pre-procurement forecast, cash gap and plan inputs."""
from sqlmodel import Session


def forecast_procurement(session: Session, customer_id: int, target_month: str) -> dict:
    """Forecast next harvest-season purchases from last year's supplier payments.

    Returns {low, expected, high, assumptions: [...], cash_available, cash_gap_range}. Always a range plus
    explicit assumptions, never a single number.
    """
    # TODO: seasonality from bank_txn (supplier_honey Aug-Sep), minus reserves, pension and receivables
    raise NotImplementedError
