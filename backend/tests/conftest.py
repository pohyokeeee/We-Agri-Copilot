from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app import clock
from app.db import get_session, make_engine
from app.main import app
from app.mockbank.service import hash_pin
from app.models import BankAccount, BankCustomer, BankPayee

NOON = datetime(2026, 7, 10, 12, 0)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: NOON)


@pytest.fixture
def engine():
    import app.models  # noqa: F401

    eng = make_engine("sqlite://")
    SQLModel.metadata.create_all(eng)
    return eng


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


@pytest.fixture
def world(engine):
    """Wang (id 1, protection on, co-signer id 2, balance 10,000), known payee 1, new payee 2."""
    with Session(engine) as s:
        s.add(BankCustomer(id=2, name="daughter", pin_hash=hash_pin("654321")))
        s.add(BankCustomer(id=1, name="wang", pin_hash=hash_pin("123456"), protection_mode=True, cosigner_id=2))
        s.add(BankAccount(id=1, customer_id=1, balance=10_000.0))
        s.add(BankPayee(id=1, customer_id=1, name="李国强", aliases=["老李"], first_paid_at=datetime(2023, 1, 1)))
        s.add(BankPayee(id=2, customer_id=1, name="新人", first_paid_at=None))
        s.commit()
    return engine


@pytest.fixture
def client(world):
    def _session():
        with Session(world) as s:
            yield s

    app.dependency_overrides[get_session] = _session
    yield TestClient(app)  # no `with`: skips lifespan, so the real data/app.db is never touched
    app.dependency_overrides.clear()
