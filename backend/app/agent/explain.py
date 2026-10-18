"""Spoken replies. The deterministic template is always the truth; qwen-plus may only rephrase it more simply.

Every reply passes the grounding checker (each number, and each known name, must be in this turn's tool outputs) and the
wording checker. A rephrase that fails is regenerated ONCE with the problem pointed out; if that fails too, or the model is
down, or LLM_MOCK=1, the template is used. The exact bank read-back (digits and numerals) is never rephrased.
"""
import json
import logging

from app.agent.grounding import check_grounding, check_wording
from app.config import settings
from app.llm import qwen

log = logging.getLogger("explain")
MAX_CHARS = 120


def _messages(template: str, outputs, problem: str) -> list[dict]:
    facts = json.dumps(outputs, ensure_ascii=False, default=str)[:3000]
    msgs = [
        {"role": "system", "content": "你在对一位年纪大、识字不多的农户说话。把『原话』改成更短、更口语的中文，最多两句。"
                                      "只能用『事实』里出现过的数字和名字，不许加新的数字或名字，不许给建议，不许说免税或申报。只输出改好的话。"},
        {"role": "user", "content": f"事实：{facts}\n原话：{template}"},
    ]
    if problem:
        msgs.append({"role": "user", "content": problem})
    return msgs


def speak(template: str, outputs, known_names=()) -> tuple[str, str]:
    """(text to say, source). source: 'template' | '<model>' | '<model> (regenerated)' | 'template (fallback: ...)'."""
    if not template.strip() or not qwen.enabled():
        return template, "template"
    problem = ""
    for attempt in (1, 2):
        try:
            text = qwen.chat(_messages(template, outputs, problem), settings.llm_planner).strip()
        except qwen.LLMError as e:
            return template, f"template (fallback: {e})"
        g, w = check_grounding(text, outputs, known_names), check_wording(text)
        if text and len(text) <= MAX_CHARS and g["ok"] and w["ok"]:
            return text, settings.llm_planner + (" (regenerated)" if attempt == 2 else "")
        problem = f"上一次不合格：不能出现这些数字或名字 {g['ungrounded']}；不能用这些说法 {w['violations']}；要短（不超过{MAX_CHARS}字）。请重写。"
        log.warning("rephrase rejected (attempt %s): %s %s", attempt, g["ungrounded"], w["violations"])
    return template, "template (fallback: the rephrase failed the grounding or wording check)"
