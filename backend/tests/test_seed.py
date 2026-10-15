from sqlmodel import Session, select

from app.audit.chain import verify_chain
from app.db import make_engine
from app.models import BankAccount, BankTxn, RulePolicy, RuleTax
from seed.seed import seed


def test_seed_is_idempotent_and_consistent():
    eng = make_engine("sqlite://")
    a, b = seed(eng), seed(eng)
    assert a == b
    assert 0.36 < a["resale_share"] < 0.41  # ~38% of sales are resold neighbours' honey
    with Session(eng) as s:
        assert len(s.exec(select(RuleTax)).all()) == 11 and len(s.exec(select(RulePolicy)).all()) == 5
        assert verify_chain(s) == (True, None)
        acct = s.get(BankAccount, 1)
        txns = s.exec(select(BankTxn)).all()
        net = sum(t.amount if t.direction == "credit" else -t.amount for t in txns)
        assert abs(acct.balance - (a["opening"] + net)) < 0.01 and acct.balance > 0
        assert len([t for t in txns if t.income_class == "pension"]) == 12
