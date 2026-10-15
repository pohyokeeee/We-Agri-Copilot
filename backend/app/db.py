from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings


def make_engine(url: str):
    kw: dict = {"connect_args": {"check_same_thread": False}}
    if url in ("sqlite://", "sqlite:///:memory:"):
        kw["poolclass"] = StaticPool  # one shared connection so :memory: survives
    return create_engine(url, **kw)


engine = make_engine(settings.database_url)


def init_db(eng=None) -> None:
    import app.models  # noqa: F401  (registers tables)

    eng = eng or engine
    if eng.url.database and eng.url.database != ":memory:":
        Path(eng.url.database).parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(eng)


def get_session():
    with Session(engine) as session:
        yield session
