"""Mock-bank tables. Money is float CNY rounded to 2dp.
ponytail: float money is fine for a simulated ledger; switch to integer fen before any real use.
Enum-ish columns are plain str (SQLite), allowed values listed in comments.
"""
from datetime import date

from pydantic import NaiveDatetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class BankCustomer(SQLModel, table=True):
    __tablename__ = "bank_customer"
    id: int | None = Field(default=None, primary_key=True)
    name: str
    phone: str = ""
    device_id: str = ""
    pin_hash: str = ""
    protection_mode: bool = False
    cosigner_id: int | None = Field(default=None, foreign_key="bank_customer.id")
    failed_pins: int = 0
    locked: bool = False


class BankAccount(SQLModel, table=True):
    __tablename__ = "bank_account"
    id: int | None = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="bank_customer.id", index=True)
    balance: float = 0.0


class BankPayee(SQLModel, table=True):
    __tablename__ = "bank_payee"
    id: int | None = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="bank_customer.id", index=True)
    name: str
    aliases: list = Field(default_factory=list, sa_column=Column(JSON))
    phone: str = ""
    note: str = ""
    first_paid_at: NaiveDatetime | None = None  # None => never paid => "new payee"


class BankTxn(SQLModel, table=True):
    __tablename__ = "bank_txn"
    id: int | None = Field(default=None, primary_key=True)
    account_id: int = Field(foreign_key="bank_account.id", index=True)
    ts: NaiveDatetime = Field(index=True)
    amount: float
    direction: str  # credit | debit
    counterparty: str = ""
    channel: str = ""  # transfer | platform_payout | card_payment | pension | other
    category: str = ""
    income_class: str = "other"  # own_produce | resale | pension | subsidy | other
    source_order_id: str | None = None
    note_untrusted: str = ""


class PlatformOrder(SQLModel, table=True):
    __tablename__ = "platform_order"
    id: str = Field(primary_key=True)
    platform: str  # marketplace | livestream
    ts: NaiveDatetime = Field(index=True)
    product: str
    qty: int
    amount: float
    buyer_note_untrusted: str = ""
    imported_at: NaiveDatetime


class BankReserve(SQLModel, table=True):
    """Earmark: balance is unchanged, but available = balance - active reserves."""
    __tablename__ = "bank_reserve"
    id: int | None = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="bank_customer.id", index=True)
    label: str = ""
    amount: float
    status: str = "active"  # active | released
    created_at: NaiveDatetime


class BankSchedule(SQLModel, table=True):
    __tablename__ = "bank_schedule"
    id: int | None = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="bank_customer.id", index=True)
    payee_id: int = Field(foreign_key="bank_payee.id")
    amount: float
    run_on: date
    condition: str = ""  # e.g. "balance >= 20000"; evaluated by deterministic code
    status: str = "scheduled"  # scheduled | cancelled | done


class BankProduct(SQLModel, table=True):
    __tablename__ = "bank_product"
    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str  # agri_loan | ...
    apr: float
    fees: float = 0.0
    term_months: int
    eligibility: dict = Field(default_factory=dict, sa_column=Column(JSON))


class BankApproval(SQLModel, table=True):
    """Pending/granted approval for a non-green action. Token is single-use, bound to action+payload."""
    __tablename__ = "bank_approval"
    id: int | None = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="bank_customer.id", index=True)
    action: str
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    tier: str
    reasons: list = Field(default_factory=list, sa_column=Column(JSON))
    requires_cosigner: bool = False
    challenge: str = ""
    pin_ok: bool = False
    cosign: str = "pending"  # pending | approved | declined
    status: str = "pending"  # pending | approved | declined | used
    token: str | None = Field(default=None, index=True)
    created_at: NaiveDatetime
