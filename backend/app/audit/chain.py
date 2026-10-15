"""Append-only hash chain: hash = SHA-256(prev_hash + canonical JSON of the row's content).

Detects edits and mid-chain deletions. A deleted *tail* is not detectable without
anchoring the last hash elsewhere (ponytail: anchor to evidence/ JSONL if needed).
SQLite serialises writers, so the read-last-then-insert below cannot fork the chain.
"""
import hashlib
import json

from sqlmodel import Session, select

from app import clock
from app.models import AgentAudit

GENESIS = "0" * 64


def _digest(prev_hash: str, ts: str, actor: str, event: str, payload: dict) -> str:
    body = json.dumps(
        {"ts": ts, "actor": actor, "event": event, "payload": payload},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


def append(session: Session, actor: str, event: str, payload: dict) -> AgentAudit:
    """Add one audit row in the caller's transaction (caller commits). Payload must be JSON primitives."""
    last = session.exec(select(AgentAudit).order_by(AgentAudit.id.desc())).first()
    prev = last.hash if last else GENESIS
    ts = clock.now().isoformat()
    row = AgentAudit(
        prev_hash=prev, hash=_digest(prev, ts, actor, event, payload),
        ts=ts, actor=actor, event=event, payload=payload,
    )
    session.add(row)
    session.flush()
    return row


def verify_chain(session: Session) -> tuple[bool, int | None]:
    """(True, None) if intact, else (False, id of first broken row)."""
    prev = GENESIS
    for row in session.exec(select(AgentAudit).order_by(AgentAudit.id)):
        if row.prev_hash != prev or row.hash != _digest(prev, row.ts, row.actor, row.event, row.payload):
            return False, row.id
        prev = row.hash
    return True, None
