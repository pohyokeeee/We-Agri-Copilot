from sqlmodel import select

from app.audit.chain import GENESIS, append, verify_chain
from app.models import AgentAudit


def test_append_links_rows_and_verifies(session):
    assert verify_chain(session) == (True, None)  # empty chain is fine
    a = append(session, "t", "one", {"x": 1})
    b = append(session, "t", "two", {"y": [1, 2.5, "中"]})
    session.commit()
    assert a.prev_hash == GENESIS and b.prev_hash == a.hash
    assert verify_chain(session) == (True, None)


def test_tampered_payload_detected(session):
    append(session, "t", "one", {"amount": 10})
    victim = append(session, "t", "two", {"amount": 20})
    append(session, "t", "three", {"amount": 30})
    session.commit()
    row = session.get(AgentAudit, victim.id)
    row.payload = {"amount": 2}
    session.add(row)
    session.commit()
    assert verify_chain(session) == (False, victim.id)


def test_deleted_middle_row_detected(session):
    append(session, "t", "one", {})
    mid = append(session, "t", "two", {})
    last = append(session, "t", "three", {})
    session.commit()
    session.delete(session.get(AgentAudit, mid.id))
    session.commit()
    assert verify_chain(session) == (False, last.id)
    assert len(session.exec(select(AgentAudit)).all()) == 2
