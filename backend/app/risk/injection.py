"""Prompt-injection detector for untrusted text (order notes, product titles, payee notes, merchant names).

Rule based: every matched rule adds its weight (capped at 100). Score >= THRESHOLD means "flag it, log it, engage the safety
lock". A text that scores high only ever causes the lock; it can never cause an action. qwen-flash adds a second score
(the higher of the two counts); with LLM_MOCK=1, no key, or a failed call the rule score is the answer.
"""
import re
from dataclasses import dataclass, field
from typing import Callable

from app.config import settings
from app.llm import qwen
from app.risk.untrusted import Untrusted

THRESHOLD = 60

RULES: list[tuple[re.Pattern, int, str]] = [(re.compile(p, re.I), w, label) for p, w, label in [
    (r"忽略(?:(?:以上|之前|前面|上面)|(?:所有|全部|的|\s)*(?:规则|指令|提示|说明|限制))", 60, "ignore-rules"),
    (r"ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?)", 60, "ignore-previous"),
    (r"system\s*prompt|系统\s*提示", 40, "system-prompt"),
    (r"(?:转账|转钱|汇款|打款)\s*给", 30, "transfer-to"),
    (r"转\s*[\d,，.]+\s*(?:元|块|万)?\s*给", 30, "transfer-amount-to"),
    (r"(?:立即|马上|立刻|现在就)\s*(?:转|汇|打款|付款)", 30, "transfer-now"),
    (r"不要\s*(?:提醒|通知|告诉)|别\s*告诉|无需\s*确认|不用\s*确认|跳过\s*(?:验证|确认)|绕过", 30, "hide-it"),
]]
# amount + account together: the shape of "send this much to that account"
VERB = re.compile(r"转|汇|打款|付款|支付|transfer|send|wire|pay", re.I)
AMOUNT = re.compile(r"(?<!\d)\d{1,3}(?:[,，]\d{3})+(?!\d)|(?<!\d)\d{3,9}(?!\d)|\d+(?:\.\d+)?\s*(?:元|块|万)")
ACCOUNT = re.compile(r"(?<!\d)\d{12,19}(?!\d)|(?<!\d)1[3-9]\d{9}(?!\d)|账号|账户|卡号|account", re.I)
COMBO_WEIGHT = 45

# a callable(text) -> 0..100 that replaces the qwen-flash call (tests set it); None = ask qwen-flash
CLASSIFIER_HOOK: Callable[[str], int] | None = None
MIN_CHARS_FOR_MODEL = 6  # shorter texts cannot carry an instruction worth a model call


@dataclass
class Assessment:
    score: int
    hits: list[str] = field(default_factory=list)
    flagged: bool = False
    method: str = "rules"


def rule_score(text: str) -> Assessment:
    hits, score = [], 0
    for pat, weight, label in RULES:
        if pat.search(text):
            hits.append(label)
            score += weight
    if VERB.search(text) and AMOUNT.search(text) and ACCOUNT.search(text):
        hits.append("amount+account")
        score += COMBO_WEIGHT
    score = min(100, score)
    return Assessment(score, hits, score >= THRESHOLD)


def assess(text: "str | Untrusted") -> Assessment:
    """Score a text. The classifier can only raise the score, never lower what the rules found."""
    raw = text.text if isinstance(text, Untrusted) else text
    a = rule_score(raw)
    # the model only runs when it could change the answer: not for empty or tiny texts, not once the rules already flagged it
    if not settings.llm_mock and not a.flagged and len(raw.strip()) >= MIN_CHARS_FOR_MODEL:
        ml = _model_score(raw)
        if ml > a.score:
            a = Assessment(ml, [*a.hits, "classifier"], ml >= THRESHOLD, "rules+classifier")
    return a


def _model_score(raw: str) -> int:
    """0 when there is no model or it fails: the rule score then stands alone."""
    if CLASSIFIER_HOOK:
        return CLASSIFIER_HOOK(raw)
    if not qwen.enabled():
        return 0
    try:
        return qwen.score_injection(raw)
    except qwen.LLMError:
        return 0
