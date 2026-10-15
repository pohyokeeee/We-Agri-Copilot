"""CLI: python -m app.audit.verify"""
import sys

from sqlmodel import Session

from app.audit.chain import verify_chain
from app.db import engine


def main() -> int:
    with Session(engine) as s:
        ok, broken = verify_chain(s)
    print("audit chain OK" if ok else f"audit chain BROKEN at row id {broken}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
