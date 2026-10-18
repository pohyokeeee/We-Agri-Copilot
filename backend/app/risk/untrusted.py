"""Text that came from outside: platform order notes, product titles, payee notes, merchant names.

An Untrusted value is NOT a str and has no numeric conversion, so it cannot silently become an amount, a payee or a tool
argument: float(x), x + 1, f"{x}", json.dumps(x) and "pay " + x all fail or print a placeholder. Code that really needs the
words (to show them, or to score them) must say so with .text. Planner and payment tools refuse it with ensure_trusted().
"""
import re
from dataclasses import dataclass


class UntrustedInput(TypeError):
    """Untrusted text reached a place where only the user's own words or the bank's own data may go."""


@dataclass(frozen=True)
class Untrusted:
    text: str
    source: str = ""  # e.g. "order LS-N0007 note"

    def __str__(self) -> str:
        return "【不可信文本】"

    __repr__ = __str__

    def excerpt(self, n: int = 60) -> str:
        """A short, control-character-free piece for a log line or a judge's screen. Display only."""
        return re.sub(r"[\x00-\x1f\x7f]", " ", self.text)[:n]


def ensure_trusted(x, where: str = "") -> None:
    """Raise UntrustedInput if an Untrusted value is anywhere inside x (strings, numbers, dicts, lists, tuples)."""
    if isinstance(x, Untrusted):
        raise UntrustedInput(f"不可信文本不能用在这里{('：' + where) if where else ''}")
    if isinstance(x, dict):
        for k, v in x.items():
            ensure_trusted(k, where)
            ensure_trusted(v, where)
    elif isinstance(x, (list, tuple, set)):
        for v in x:
            ensure_trusted(v, where)
