from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app import clock
from app.config import settings
from app.db import get_session, make_engine
from app.main import app
from app.mockbank.service import hash_pin
from app.models import BankAccount, BankCustomer, BankPayee

NOON = datetime(2026, 7, 25, 12, 0)  # = default DEMO_TODAY
REAL_NOW = clock.now  # the unpatched demo-clock function, for tests of the clock itself


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: NOON)


@pytest.fixture(autouse=True)
def offline_qwen(tmp_path, monkeypatch):
    """Tests never reach the network, whatever .env says: mock mode, no key, private caches. Tests of the live paths turn a
    key and LLM_MOCK=0 on themselves and replace the network seams (qwen._complete, asr_call, tts_call)."""
    monkeypatch.setattr(settings, "llm_mock", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "")
    monkeypatch.setattr(settings, "llm_provider", "dashscope")  # whatever .env says; provider tests switch it themselves
    monkeypatch.setattr(settings, "groq_api_key", "")
    monkeypatch.setattr(settings, "llm_cache_dir", str(tmp_path / "llm_cache"))
    monkeypatch.setattr(settings, "tts_cache_dir", str(tmp_path / "tts_cache"))


@pytest.fixture(autouse=True)
def isolated_checkpoints(tmp_path, monkeypatch):
    """Each test gets its own LangGraph checkpoint database (plan ids repeat between tests)."""
    from app.agent import graph

    monkeypatch.setattr(settings, "checkpoint_db", str(tmp_path / "checkpoints.db"))
    graph._savers.clear()


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


@pytest.fixture
def seeded(engine):
    """Full Uncle Wang seed data in the in-memory DB, with a client wired to it."""
    from seed.seed import seed

    seed(engine)

    def _session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = _session
    yield TestClient(app), engine
    app.dependency_overrides.clear()
