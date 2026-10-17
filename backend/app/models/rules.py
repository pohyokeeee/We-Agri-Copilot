from datetime import date

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class RuleTax(SQLModel, table=True):
    __tablename__ = "rule_tax"
    rule_id: str = Field(primary_key=True)
    scope: str  # VAT | IIT | EIT | surtax | admin | reporting
    applies_to: dict = Field(default_factory=dict, sa_column=Column(JSON))
    rate_or_threshold: dict = Field(default_factory=dict, sa_column=Column(JSON))
    effective_from: date | None = None
    effective_to: date | None = None
    citation_url: str = "TODO"
    status: str = "recall"  # verified | recall
    notes: str = ""


class RulePolicy(SQLModel, table=True):
    __tablename__ = "rule_policy"
    policy_id: str = Field(primary_key=True)
    name: str
    region: str
    kind: str  # subsidy | interest_subsidy | guarantee | bank_product
    eligibility: dict = Field(default_factory=dict, sa_column=Column(JSON))
    benefit: str = ""
    documents: list = Field(default_factory=list, sa_column=Column(JSON))
    deadline: date | None = None
    citation_url: str = "TODO"
    last_checked: date | None = None
    simulated: bool = True
    where_to_go: str = ""
    benefit_params: dict = Field(default_factory=dict, sa_column=Column(JSON))  # numbers behind the benefit text, e.g. subsidy rate and cap


class CalendarEntry(SQLModel, table=True):
    """When a recurring purchase happens. typical_purchase is the bank_txn.category its history is read from."""
    __tablename__ = "calendar"
    id: int | None = Field(default=None, primary_key=True)
    activity: str
    month_from: int  # 1-12
    month_to: int  # >= month_from (no year wrap)
    typical_purchase: str
