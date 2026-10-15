"""OpenAI-compatible client for Alibaba Model Studio (Qwen). Plans and explains; never decides numbers.

LLM_MOCK=1 returns a fixed string and makes no network call. Responses are cached on disk by prompt hash.
"""
import hashlib
import json
from pathlib import Path

from app.config import settings

MOCK_REPLY = "[mock llm reply]"


def _key(model: str, messages: list[dict]) -> str:
    return hashlib.sha256(json.dumps([model, messages], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def chat(messages: list[dict], model: str | None = None) -> str:
    """model defaults to QWEN_PLANNER; pass settings.qwen_classifier for cheap classification calls."""
    model = model or settings.qwen_planner
    if settings.llm_mock:
        return MOCK_REPLY
    cache = Path(settings.llm_cache_dir) / f"{_key(model, messages)}.txt"
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    from openai import OpenAI  # lazy: tests and mock mode need no key

    client = OpenAI(api_key=settings.dashscope_api_key, base_url=settings.dashscope_base_url)
    text = client.chat.completions.create(model=model, messages=messages).choices[0].message.content or ""
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(text, encoding="utf-8")
    return text
