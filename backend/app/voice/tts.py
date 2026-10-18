"""Text-to-speech. Every clip starts with the spoken AI label so the listener knows it is not a person.

Clips are cached on disk by a hash of (model, voice, labelled text): a line played once, or warmed beforehand, is instant.
"""
import hashlib
from pathlib import Path

from app.config import settings
from app.llm import qwen

AI_LABEL = "元农民助手："


def with_label(text: str) -> str:
    return text if text.startswith(AI_LABEL) else AI_LABEL + text


def _stem(labelled: str) -> str:
    return hashlib.sha256(f"{settings.qwen_tts}|{settings.tts_voice}|{labelled}".encode()).hexdigest()[:32]


def synthesize(text: str) -> tuple[str, str, bool]:
    """(file name, the text actually spoken, was it cached). Raises qwen.LLMError if there is no cached clip and no model."""
    labelled = with_label(text.strip())
    folder = Path(settings.tts_cache_dir)
    stem = _stem(labelled)
    for ext in ("wav", "mp3"):
        if (folder / f"{stem}.{ext}").exists():
            return f"{stem}.{ext}", labelled, True
    if not qwen.enabled():
        raise qwen.LLMError("text-to-speech is off (LLM_MOCK=1 or no key)")
    audio = qwen.tts_call(labelled)
    ext = "wav" if audio[:4] == b"RIFF" else "mp3"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{stem}.{ext}").write_bytes(audio)
    return f"{stem}.{ext}", labelled, False
