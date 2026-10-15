"""Text-to-speech. Every spoken reply starts with the AI label so the listener knows it is not a person."""

AI_LABEL = "元农民助手："


def with_label(text: str) -> str:
    return text if text.startswith(AI_LABEL) else AI_LABEL + text


def synthesize(text: str) -> bytes:
    """Return audio bytes for with_label(text), slow pace, large-volume friendly."""
    spoken = with_label(text)  # noqa: F841
    # TODO: Model Studio TTS call on `spoken`
    raise NotImplementedError
