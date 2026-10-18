"""Reply guards: grounding (numbers and names must come from this turn's tool outputs) and wording (information, never advice)."""
import re

from app import trace

BANNED = ("你应该", "您应该", "建议你", "建议您", "免税")  # advice / exemption claims ("建议你注册" is covered)
FILING = ("申报", "报税", "汇算", "代办", "代为", "提交", "filing")  # anything about filing
# "免征" etc. is fine as a rule statement, but not as a claim about the user ("您免征增值税")
CLAIM = re.compile(r"[你您].{0,6}(免征|免税|不用交税|不必交税|不需要交税)")

_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_ZH = re.compile(r"[零一二三四五六七八九十百千万亿两]{2,}")  # 2+ characters: single ones are "一下", "一家", "两位"...
_DIGIT = {c: i for i, c in enumerate("零一二三四五六七八九")} | {"两": 2}
_UNIT = {"十": 10, "百": 100, "千": 1000}


def zh_to_number(s: str) -> float | None:
    """四万七千二百 -> 47200, 十二 -> 12, 一百零五 -> 105. None if it is not a well-formed numeral."""
    total = section = num = 0
    for ch in s:
        if ch in _DIGIT:
            num = _DIGIT[ch]
        elif ch in _UNIT:
            section += (num or 1) * _UNIT[ch]
            num = 0
        elif ch == "万":
            total += (section + num or 1) * 10_000
            section = num = 0
        elif ch == "亿":
            total = (total + section + num or 1) * 100_000_000
            section = num = 0
        else:
            return None
    return float(total + section + num)


def _walk(x, nums: set[float], strings: list[str]) -> None:
    if isinstance(x, bool):
        return
    if isinstance(x, (int, float)):
        nums.update({round(float(x), 2), float(round(x))})
        if 0 < x <= 1:  # 0.386 may be spoken as 39%
            nums.update({round(x * 100, 2), float(round(x * 100))})
    elif isinstance(x, str):
        strings.append(x)
        nums.update(round(float(m.group().replace(",", "").rstrip(".")), 2) for m in _NUM.finditer(x))
        nums.update(round(v, 2) for m in _ZH.finditer(x) if (v := zh_to_number(m.group())) is not None)
    elif isinstance(x, dict):
        for k, v in x.items():
            _walk(k, nums, strings)
            _walk(v, nums, strings)
    elif isinstance(x, (list, tuple, set)):
        for v in x:
            _walk(v, nums, strings)


def numbers_in(x) -> set[float]:
    """Every number in a structure or text: digits, with or without commas, and multi-character Chinese numerals."""
    nums: set[float] = set()
    _walk(x, nums, [])
    return nums


def check_grounding(reply: str, tool_outputs, known_names: tuple[str, ...] | list[str] = ()) -> dict:
    """{ok, ungrounded}. Every number in the reply (small whole numbers up to 10 excepted: "一下", "3 件事") must appear in
    this turn's tool outputs, and a known payee or product name may only be mentioned if the outputs mention it too.
    Limits: it cannot catch an invented name that is in no list. A reply with ungrounded content must not be shown."""
    allowed: set[float] = set()
    strings: list[str] = []
    _walk(tool_outputs, allowed, strings)
    haystack = " ".join(strings)
    bad: list[str] = []
    for m in _NUM.finditer(reply):
        tok = m.group().rstrip(",.")
        v = float(tok.replace(",", ""))
        if not (v <= 10 and v == int(v)) and round(v, 2) not in allowed:
            bad.append(tok)
    for m in _ZH.finditer(reply):
        v = zh_to_number(m.group())
        if v is not None and v > 10 and round(v, 2) not in allowed:
            bad.append(m.group())
    bad += [n for n in known_names if n and n in reply and n not in haystack]
    return {"ok": not bad, "ungrounded": bad}


def check_wording(text: str) -> dict:
    """{ok, violations}. Strict by design: a false positive only means rewording a rule-style sentence."""
    bad = [w for w in (*BANNED, *FILING) if w in text]
    if m := CLAIM.search(text):
        bad.append(m.group(0))
    return {"ok": not bad, "violations": bad}


def assert_wording(texts: list[str]) -> None:
    """Raise if any text breaks the wording rules; used on every feature-① output before it leaves the server."""
    for t in texts:
        if not (r := check_wording(t))["ok"]:
            raise ValueError(f"wording check failed {r['violations']}: {t[:40]}")
    trace.note_wording(len(texts))  # recorded in the audit rows of this request
