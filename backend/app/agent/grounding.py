"""Grounding check: every number and name in a reply must appear in the tool outputs."""


def check_grounding(reply: str, tool_outputs: list[dict]) -> dict:
    """Return {ok: bool, ungrounded: [str]}. A reply with ungrounded numbers/names must not be shown."""
    # TODO: extract numbers (incl. Chinese numerals) and payee/product names; match against flattened tool outputs
    raise NotImplementedError
