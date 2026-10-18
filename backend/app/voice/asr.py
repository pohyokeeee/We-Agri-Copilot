"""Speech-to-text. The recording goes to qwen3-asr-flash with the payee names as context so "老李" is not heard as "老理".

The model returns no confidence score, so `confidence` here is an honest ESTIMATE from the transcript (see score()). Anything
doubtful, and any number that is easy to mishear (十四/四十), sets needs_confirm: the app then reads what it heard back and
waits for a yes before it acts on it.
"""
import re

from sqlmodel import Session, select

from app.agent import planner_mock
from app.llm import qwen
from app.models import BankPayee

LOW_CONFIDENCE = 0.75  # an unknown payee name (0.7) or non-Mandarin audio (0.6) is already below this
# numbers whose digits swap when spoken fast: 14/40, 15/50 ... 19/90, in digits or in characters
AMBIGUOUS_NUMBER = re.compile(r"(?<!\d)(?:1[4-9]|[4-9]0)(?!\d)|十[四五六七八九]|[四五六七八九]十")
TRANSFER_TO = re.compile(r"给(?P<who>[^转，。,.\d]{1,8}?)转")


def glossary(s: Session, customer_id: int) -> list[str]:
    names = [n for p in s.exec(select(BankPayee).where(BankPayee.customer_id == customer_id)) for n in (p.name, *p.aliases)]
    return list(dict.fromkeys([*names, "蜂蜜", "贷款", "预留", "转账", *planner_mock.COMMANDS]))


def score(text: str, language: str, names: list[str]) -> tuple[float, list[str]]:
    """(confidence 0-1, reasons in plain Chinese). Starts at 0.9 and loses points for anything that smells wrong."""
    reasons: list[str] = []
    if not text.strip():
        return 0.0, ["没听到内容"]
    conf = 0.9
    if len(text.strip()) < 2:
        conf -= 0.5
        reasons.append("太短了")
    if language and not language.lower().startswith(("zh", "yue", "cmn")):
        conf -= 0.3
        reasons.append("听起来不像普通话")
    if (m := TRANSFER_TO.search(text)) and not any(m["who"] in n or n in m["who"] for n in names):
        conf -= 0.2
        reasons.append(f"“{m['who']}”不在已知的收款人里")
    return max(conf, 0.0), reasons


def ambiguous_numbers(text: str) -> list[str]:
    return sorted({m.group() for m in AMBIGUOUS_NUMBER.finditer(text)})


def transcribe(audio: bytes, mime: str, names: list[str]) -> dict:
    """Raises qwen.LLMError when the model cannot be reached. The result is data for the app, never an instruction."""
    raw = qwen.asr_call(audio, mime, names)
    text = raw["text"]
    conf, reasons = score(text, raw["language"], names)
    nums = ambiguous_numbers(text)
    if nums:
        reasons.append(f"数字 {'、'.join(nums)} 容易听混")
    needs = conf < LOW_CONFIDENCE or bool(nums)
    return {
        "transcript": text, "confidence": round(conf, 2), "needs_confirm": needs, "reasons": reasons, "language": raw["language"],
        "confirm_text_zh": f"我听到的是：「{text}」。对吗？" + (f"（{'；'.join(reasons)}）" if reasons else "") if needs else "",
        "confidence_note": "模型不给分数，这是按内容估的",
    }
