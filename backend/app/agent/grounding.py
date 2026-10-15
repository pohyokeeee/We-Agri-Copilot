"""Reply guards: grounding (numbers/names must come from tools) and wording (information, never advice)."""
import re

BANNED = ("你应该", "您应该", "建议你", "建议您", "免税")  # advice / exemption claims ("建议你注册" is covered)
FILING = ("申报", "报税", "汇算", "代办", "代为", "提交", "filing")  # anything about filing
# "免征" etc. is fine as a rule statement, but not as a claim about the user ("您免征增值税")
CLAIM = re.compile(r"[你您].{0,6}(免征|免税|不用交税|不必交税|不需要交税)")


def check_grounding(reply: str, tool_outputs: list[dict]) -> dict:
    """Return {ok: bool, ungrounded: [str]}. A reply with ungrounded numbers/names must not be shown."""
    # TODO: extract numbers (incl. Chinese numerals) and payee/product names; match against flattened tool outputs
    raise NotImplementedError


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
